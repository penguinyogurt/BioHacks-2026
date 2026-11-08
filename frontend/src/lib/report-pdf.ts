import { jsPDF } from 'jspdf'
import { CANDIDATES, CRITERIA, EXCLUDED, PROFILES, REFERENCES, rank, type Patient, type Weights } from './pipeline'

/**
 * The research agent's report as a real PDF, so it opens in the browser's own
 * viewer like the case file in step 0. Content is the scripted demo run.
 */

// jsPDF's built-in Helvetica only covers WinAnsi; anything outside it prints as garbage.
const ASCII: Record<string, string> = { '→': '->', '≤': '<=', '≥': '>=', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '×': 'x', 'β': 'beta', 'µ': 'u' }
const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => ASCII[c] ?? '')

export function buildReportPdf({ patient: p, weights, date, caseName }: { patient: Patient; weights: Weights; date: string; caseName?: string | null }): string {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 56
  const width = W - M * 2
  let y = M

  const room = (h: number) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const write = (text: string, { size = 10, bold = false, gap = 4, color = 30, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color)
    const lines: string[] = doc.splitTextToSize(safe(text), width - indent)
    const lh = size * 1.35
    for (const line of lines) {
      room(lh)
      doc.text(line, M + indent, y + size)
      y += lh
    }
    y += gap
  }
  const heading = (text: string) => {
    y += 8
    room(40)
    write(text, { size: 13, bold: true, gap: 6, color: 19 })
  }

  const ranked = rank(CANDIDATES, weights)
  const enabled = CRITERIA.filter((c) => weights[c.key])
  const n = (v: number) => (Number.isNaN(v) ? '-' : String(v))

  write('ADDO LABS · DISCOVERY REPORT', { size: 8, bold: true, color: 110, gap: 6 })
  write(`Alternative therapeutic candidates for ${p.label}`, { size: 20, bold: true, color: 19, gap: 6 })
  write(`${date} · ${p.onset}, ALSFRS-R ${n(p.alsfrs)}/48 · Delivery assumption: MRgFUS blood-brain barrier opening`, { size: 9, color: 100, gap: 2 })
  write(`Case source: ${caseName ?? 'built-in sample patient'} · Simulated run, illustrative outputs`, { size: 9, color: 100, gap: 10 })
  doc.setDrawColor(210).line(M, y, W - M, y)
  y += 6

  heading('Summary')
  write(
    `Most drugs that could act on ALS pathology never reach the motor cortex: the blood-brain barrier excludes nearly all large molecules and most small ones [7]. MR-guided focused ultrasound has opened the barrier safely over motor cortex in people with ALS [1], which makes approved biologics a new search space. Five profile agents proposed ideal-drug profiles for this patient; each was matched against compounds in the DRKG knowledge graph [2] and the strongest matches were ranked for this patient. The top candidate is ${ranked[0].drug} (${ranked[0].overall}/100).`,
  )

  heading('Patient context')
  for (const line of [
    `${n(p.age)}${p.sex}, ${p.onset.toLowerCase()}, ${n(p.monthsSinceDx)} months since diagnosis; slope ${n(p.slope)} pts/month; FVC ${n(p.fvc)}%.`,
    `Genetics: ${p.genetics}.`,
    `Current medication: ${p.medications.join(', ')}. Conditions: ${p.comorbidities.join(', ') || 'none recorded'}.`,
    `${p.location} · Coverage: ${p.coverage}.${p.preferences.length ? ` Preferences: ${p.preferences.join('; ')}.` : ''}`,
  ])
    write(`-  ${line}`, { gap: 2 })

  heading('Method')
  write(`Profiles: ${PROFILES.map((x) => x.name).join(' · ')}. Ranking criteria: ${enabled.map((c) => c.label).join(', ')}${weights.fit ? ' (mechanistic fit weighted x2)' : ''}.`)

  heading('Ranked candidates')
  ranked.forEach((c, i) => {
    room(90)
    write(`${i + 1}. ${c.drug} - ${c.cls}    ${c.overall}/100`, { size: 11, bold: true, color: 19, gap: 2 })
    write(`${PROFILES[c.lane].name} profile · ${c.sizeKDa} kDa · BBB alone: ${c.bbbAlone} · With MRgFUS: ${c.withFus}`, { size: 8.5, color: 100, gap: 4 })
    write(`${c.rationale}${c.cites.length ? ` [${c.cites.join(', ')}]` : ''}`, { gap: 4 })
    for (const [k, v] of [['Evidence', c.evidence], ['Safety', c.safety], ['Cost', c.cost], ['Availability', c.availability], ['Acceptance', c.acceptance]])
      write(`${k}: ${v}`, { size: 9, indent: 12, gap: 1 })
    y += 8
  })

  heading('Excluded for this patient')
  for (const e of EXCLUDED) write(`-  ${e.drug} - ${e.reason}${e.cites.length ? ` [${e.cites.join(', ')}]` : ''}`, { gap: 2 })

  heading('Limitations')
  write('Hypothesis-generating output for discussion with the care team, not a treatment recommendation. Embedding similarity reflects knowledge-graph structure, not demonstrated efficacy. CNS exposure after focused-ultrasound opening has not been measured for these drugs, and any use would need a trial or physician-led protocol.')

  heading('References')
  for (const r of REFERENCES) {
    write(`[${r.n}] ${r.text}`, { size: 9, gap: 0 })
    doc.setFontSize(8).setTextColor(60, 90, 140)
    room(12)
    doc.textWithLink(safe(r.url), M + 14, y + 8, { url: r.url, maxWidth: width - 14 })
    y += 16
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(8).setTextColor(140)
    doc.text(`Addo Labs · ${safe(p.label)} · page ${i} of ${pages}`, W / 2, H - 28, { align: 'center' })
  }

  return URL.createObjectURL(doc.output('blob'))
}
