// Copy the take-home test pages from backend/diagnostics into public/take-home/, where Vercel (and
// the Vite dev server) serve them as /take-home/. The backend/diagnostics files stay the single
// source; the copies are committed, so Vercel's build needs neither Python nor files outside
// frontend/. Re-run after editing any source page:
//
//   npm run sync:take-home        (from frontend/; needs backend/.venv for the speech passages)
//
// Scoring for the facial and speech tests comes from the backend: /api/diagnostics (backend/diagnostics/api.py).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIAG = resolve(FRONTEND, '../backend/diagnostics')
const OUT = join(FRONTEND, 'public/take-home')

const FILES = [
  ['master-app/diagnostic-ui/index.html', 'index.html'],
  ['master-app/diagnostic-ui/suite.js', 'suite.js'],
  ['facial-test/index.html', 'facial/index.html'],
  ['facial-test/round.js', 'facial/round.js'],
  ['speech-test-good/transcript_only.html', 'speech/index.html'],
  ['line-test/index.html', 'line/index.html'],
]

/** The speech page's passages, which its local server templates in. Stubs keep Vosk/SciPy out of it. */
function passages() {
  const python = [join(DIAG, '../.venv/Scripts/python.exe'), join(DIAG, '../.venv/bin/python')].find(existsSync) ?? 'python3'
  const code = [
    'import json, sys, types',
    "for m in ('vosk', 'scipy', 'scipy.io', 'scipy.signal'): sys.modules[m] = types.ModuleType(m)",
    "sys.modules['vosk'].KaldiRecognizer = sys.modules['vosk'].Model = None",
    "sys.modules['vosk'].SetLogLevel = lambda *a: None",
    "sys.modules['scipy.io'].wavfile = None; sys.modules['scipy.signal'].resample_poly = None",
    `sys.path.insert(0, ${JSON.stringify(join(DIAG, 'speech-test-good'))})`,
    'from passages import PASSAGES',
    'print(json.dumps([list(p[:2]) for p in PASSAGES]))',
  ].join('\n')
  const json = execFileSync(python, ['-c', code], { encoding: 'utf8' }).trim()
  if (JSON.parse(json).length < 1) throw new Error('no passages')
  return json
}

const html = (src) => `<!-- Generated from backend/diagnostics/${src} by frontend/scripts/sync-take-home.mjs. Edit the source, then run npm run sync:take-home. -->\n`
const js = (src) => `// Generated from backend/diagnostics/${src} by frontend/scripts/sync-take-home.mjs. Edit the source, then run npm run sync:take-home.\n`

let speech = null
for (const [src, dest] of FILES) {
  let text = readFileSync(join(DIAG, src), 'utf8')
  if (src.endsWith('transcript_only.html')) {
    if (!text.includes('__PASSAGES__')) throw new Error('speech page no longer has the __PASSAGES__ placeholder')
    text = text.replace('__PASSAGES__', (speech ??= passages()))
  }
  // A doctype must stay first, so the marker goes right after it.
  if (dest.endsWith('.html')) text = /^<!doctype html>/i.test(text) ? text.replace(/^(<!doctype html>)/i, `$1\n${html(src)}`) : html(src) + text
  else text = js(src) + text
  mkdirSync(dirname(join(OUT, dest)), { recursive: true })
  writeFileSync(join(OUT, dest), text)
  console.log(`${src} -> public/take-home/${dest}`)
}

// Both the static website and the standalone Python server use this self-contained PDF exporter.
const { build } = await import('vite')
await build({
  root: FRONTEND,
  configFile: false,
  publicDir: false,
  build: {
    outDir: OUT, emptyOutDir: false, copyPublicDir: false,
    lib: { entry: join(FRONTEND, 'scripts/take-home-pdf.ts'), name: 'TakeHomePdf',
           formats: ['iife'], fileName: () => 'report-pdf.js' },
    rolldownOptions: { external: ['html2canvas', 'dompurify', 'canvg'] },
  },
})
