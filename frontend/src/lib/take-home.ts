import { jsPDF } from 'jspdf'

/**
 * The take-home test (backend/diagnostics/master-app, served on :8772): facial expressions,
 * passage reading and line tracing. Opened with an Addo Labs link, it saves its results
 * (kind "addo-take-home-v1") straight to Supabase as a 'take_home_test' report
 * (lib/reports-db.ts, lib/take-home-store.tsx). This module scores those results and draws
 * them as a short PDF whenever one is viewed.
 */

/**
 * Where the test runs: this app's own child route, /take-home/ (public/take-home/, synced from
 * backend/diagnostics by `npm run sync:take-home`), so it deploys with the frontend. Facial and
 * speech scoring come from the agent backend's /api/diagnostics. VITE_TAKE_HOME_URL can point
 * at the local launcher (http://127.0.0.1:8772/) instead.
 */
export const TEST_URL = new URL((import.meta.env.VITE_TAKE_HOME_URL as string | undefined) || '/take-home/index.html', window.location.origin).href

/**
 * Pass rules. Facial comes from the test itself (its PASS_THRESHOLD). Speech and tracing are
 * screening defaults chosen for this report (2026-11-08), not clinical cut-offs.
 */
export const SPEECH_PASS = 90 // % of a passage's words read correctly
export const LINE_PASS = 80 // % of the drawn line inside the guide band

type Facial = { summary?: string; threshold?: number; rounds?: ({ expression: string; confidence: number; top: string; passed: boolean } | null)[] }
type Speech = { summary?: string; passages?: { name: string; words: number; errors: number; missing?: boolean }[] }
type Line = { summary?: string; shapes?: { shape: string; accuracy: number; seconds: number }[] }
export type TakeHomePayload = { kind: 'addo-take-home-v1'; completedAt: string; tests: { facial?: Facial; speech?: Speech; line?: Line } }

/** Accept only the shape the suite sends: it arrives from another window or a user's file. */
export function parsePayload(x: unknown): TakeHomePayload | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Partial<TakeHomePayload>
  if (p.kind !== 'addo-take-home-v1' || typeof p.completedAt !== 'string' || !p.tests || typeof p.tests !== 'object') return null
  if (Number.isNaN(new Date(p.completedAt).getTime())) return null
  return p as TakeHomePayload
}

export type ItemRow = { item: string; score: string; pass: boolean | null }
export type TestResult = {
  key: 'facial' | 'speech' | 'line'
  name: string
  completed: boolean
  /** 0–100, or null when the test wasn't completed. */
  accuracy: number | null
  accuracyLabel: string
  passed: number
  total: number
  rule: string
  rows: ItemRow[]
}

const pct = (n: number) => `${n.toFixed(1)}%`
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function score(p: TakeHomePayload): TestResult[] {
  const f = p.tests.facial
  const rounds = (f?.rounds ?? []).filter((r): r is NonNullable<typeof r> => !!r)
  const threshold = f?.threshold ?? 80
  const facial: TestResult = {
    key: 'facial',
    name: 'Facial expressions',
    completed: rounds.length > 0,
    accuracy: mean(rounds.map((r) => r.confidence)),
    accuracyLabel: 'Mean confidence for the requested expression',
    passed: rounds.filter((r) => r.passed).length,
    total: rounds.length,
    rule: `Pass: the model's top prediction is the requested expression, with at least ${threshold}% confidence.`,
    rows: rounds.map((r) => ({
      item: r.expression,
      score: `${pct(r.confidence)}${r.top !== r.expression ? ` (top prediction: ${r.top})` : ''}`,
      pass: r.passed,
    })),
  }

  const passages = (p.tests.speech?.passages ?? []).filter((x) => !x.missing && x.words > 0)
  const wordAcc = (x: { words: number; errors: number }) => Math.max(0, 100 * (1 - x.errors / x.words))
  const words = passages.reduce((n, x) => n + x.words, 0)
  const errors = passages.reduce((n, x) => n + Math.min(x.errors, x.words), 0)
  const speech: TestResult = {
    key: 'speech',
    name: 'Passage reading',
    completed: passages.length > 0,
    accuracy: words ? 100 * (1 - errors / words) : null,
    accuracyLabel: 'Words read correctly, across all passages',
    passed: passages.filter((x) => wordAcc(x) >= SPEECH_PASS).length,
    total: passages.length,
    rule: `Pass: at least ${SPEECH_PASS}% of a passage's words read correctly.`,
    rows: passages.map((x) => ({ item: x.name, score: `${pct(wordAcc(x))} (${x.errors} error${x.errors === 1 ? '' : 's'} in ${x.words} words)`, pass: wordAcc(x) >= SPEECH_PASS })),
  }

  const shapes = p.tests.line?.shapes ?? []
  const line: TestResult = {
    key: 'line',
    name: 'Line tracing',
    completed: shapes.length > 0,
    accuracy: mean(shapes.map((s) => s.accuracy)),
    accuracyLabel: 'Mean share of the line drawn inside the guide',
    passed: shapes.filter((s) => s.accuracy >= LINE_PASS).length,
    total: shapes.length,
    rule: `Pass: at least ${LINE_PASS}% of the drawn line inside the guide.`,
    rows: shapes.map((s) => ({ item: s.shape, score: `${pct(s.accuracy)} in ${s.seconds.toFixed(1)} s`, pass: s.accuracy >= LINE_PASS })),
  }
  return [facial, speech, line]
}

/** "t20261108-061530": a report id that sorts by time, like the backend's run ids. */
export function testId(completedAt: string) {
  const d = new Date(completedAt)
  const two = (n: number) => String(n).padStart(2, '0')
  return `t${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
}

// jsPDF's built-in Helvetica only covers WinAnsi; anything outside it prints as garbage.
const ASCII: Record<string, string> = { '≥': '>=', '≤': '<=', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '·': '-' }
const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => ASCII[c] ?? '')

/** A clean, one-to-two page summary: overview table, then one small table per test. */
export function buildTestPdf(results: TestResult[], { name, id, completedAt }: { name: string; id: string; completedAt: string }): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 56
  const INK = [19, 41, 61] as const // the app's ink navy
  const MUTED = 110
  let y = M

  const room = (h: number) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const text = (s: string, x: number, size: number, { bold = false, color = 30 as number | readonly [number, number, number], align = 'left' as 'left' | 'right' } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size)
    if (typeof color === 'number') doc.setTextColor(color)
    else doc.setTextColor(color[0], color[1], color[2])
    doc.text(safe(s), x, y, { align })
  }
  const rule = (weight = 0.6) => {
    doc.setDrawColor(200).setLineWidth(weight).line(M, y, W - M, y)
  }
  const para = (s: string, size = 9, color = MUTED) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(color)
    for (const line of doc.splitTextToSize(safe(s), W - 2 * M) as string[]) {
      room(size * 1.4)
      doc.text(line, M, y)
      y += size * 1.4
    }
  }
  const result = (pass: boolean | null) => (pass === null ? '-' : pass ? 'PASS' : 'FAIL')

  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(completedAt))
  text('ADDO LABS - TAKE-HOME TEST RESULTS', M, 8, { bold: true, color: MUTED })
  y += 26
  text('Take-home test results', M, 20, { bold: true, color: INK })
  y += 18
  text(`${name} - completed ${when} - ${id}`, M, 9.5, { color: MUTED })
  y += 26

  // ---- overview
  const cols = [M, M + 210, M + 330, M + 420]
  text('Test', cols[0], 9, { bold: true, color: MUTED })
  text('Accuracy', cols[1], 9, { bold: true, color: MUTED })
  text('Passed', cols[2], 9, { bold: true, color: MUTED })
  text('Pass rate', cols[3], 9, { bold: true, color: MUTED })
  y += 8
  rule()
  for (const r of results) {
    y += 18
    text(r.name, cols[0], 11, { bold: true, color: INK })
    if (r.completed) {
      text(pct(r.accuracy ?? 0), cols[1], 11)
      text(`${r.passed} of ${r.total}`, cols[2], 11)
      text(pct(r.total ? (100 * r.passed) / r.total : 0), cols[3], 11)
    } else text('Not completed', cols[1], 11, { color: MUTED })
    y += 8
    rule(0.3)
  }
  y += 26

  // ---- per test
  for (const r of results) {
    room(90)
    text(r.name, M, 13, { bold: true, color: INK })
    y += 14
    para(`${r.accuracyLabel}: ${r.completed ? pct(r.accuracy ?? 0) : 'not completed'}. ${r.rule}`)
    y += 4
    if (r.rows.length) {
      text('Item', M, 9, { bold: true, color: MUTED })
      text('Score', M + 170, 9, { bold: true, color: MUTED })
      text('Result', W - M, 9, { bold: true, color: MUTED, align: 'right' })
      y += 7
      rule()
      for (const row of r.rows) {
        room(20)
        y += 15
        text(row.item, M, 10)
        text(row.score, M + 170, 10)
        text(result(row.pass), W - M, 10, { bold: true, color: row.pass === false ? [176, 52, 34] : INK, align: 'right' })
        y += 6
        rule(0.3)
      }
    }
    y += 24
  }

  room(40)
  para('Screening aid, not a diagnosis. Results depend on camera, microphone and device; repeat the test under similar conditions to compare over time.', 8.5)
  return doc.output('blob')
}
