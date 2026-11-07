/**
 * SAMPLE DATA — deterministic, synthetic. Replace with Supabase queries once
 * capture is wired up. The dashboard shows a "Sample data" badge while this
 * module is the source.
 *
 * Shape of the story: 180 days of at-home sessions. Speech (bulbar) features
 * start drifting first, then typing, then handwriting — a bulbar-onset pattern.
 */

export const IS_SAMPLE = true

export type Modality = 'speech' | 'typing' | 'handwriting'

export const MODALITIES: { key: Modality; label: string; domain: string }[] = [
  { key: 'speech', label: 'Speech', domain: 'Bulbar' },
  { key: 'typing', label: 'Typing', domain: 'Fine motor' },
  { key: 'handwriting', label: 'Handwriting', domain: 'Fine motor' },
]

type FeatureDef = {
  key: string
  modality: Modality
  label: string
  unit: string
  decimals: number
  /** true when a larger value means better function */
  higherIsBetter: boolean
  start: number
  end: number
  sd: number
  onset: number
}

export const FEATURES: FeatureDef[] = [
  { key: 'rate', modality: 'speech', label: 'Speaking rate', unit: 'syll/s', decimals: 2, higherIsBetter: true, start: 4.6, end: 3.95, sd: 0.14, onset: 45 },
  { key: 'ddk', modality: 'speech', label: 'DDK rate (pa-ta-ka)', unit: 'Hz', decimals: 1, higherIsBetter: true, start: 6.3, end: 5.45, sd: 0.18, onset: 50 },
  { key: 'pause', modality: 'speech', label: 'Pause ratio', unit: '%', decimals: 0, higherIsBetter: false, start: 17, end: 24, sd: 1.4, onset: 55 },
  { key: 'mpt', modality: 'speech', label: 'Max phonation time', unit: 's', decimals: 1, higherIsBetter: true, start: 17.2, end: 14.1, sd: 0.8, onset: 60 },
  { key: 'hnr', modality: 'speech', label: 'Harmonics-to-noise', unit: 'dB', decimals: 1, higherIsBetter: true, start: 20.4, end: 18.6, sd: 0.6, onset: 70 },
  { key: 'wpm', modality: 'typing', label: 'Typing speed', unit: 'wpm', decimals: 0, higherIsBetter: true, start: 52, end: 49.8, sd: 2.2, onset: 80 },
  { key: 'flight', modality: 'typing', label: 'Inter-key interval', unit: 'ms', decimals: 0, higherIsBetter: false, start: 182, end: 193, sd: 7, onset: 80 },
  { key: 'dwell', modality: 'typing', label: 'Key hold time', unit: 'ms', decimals: 0, higherIsBetter: false, start: 96, end: 99, sd: 4, onset: 100 },
  { key: 'backspace', modality: 'typing', label: 'Correction rate', unit: '%', decimals: 1, higherIsBetter: false, start: 4.2, end: 4.75, sd: 0.45, onset: 90 },
  { key: 'velocity', modality: 'handwriting', label: 'Stroke velocity', unit: 'cm/s', decimals: 2, higherIsBetter: true, start: 4.9, end: 4.84, sd: 0.15, onset: 120 },
  { key: 'jerk', modality: 'handwriting', label: 'Normalised jerk', unit: '', decimals: 2, higherIsBetter: false, start: 1.0, end: 1.02, sd: 0.04, onset: 120 },
  { key: 'pressure', modality: 'handwriting', label: 'Pressure variability', unit: 'CV', decimals: 3, higherIsBetter: false, start: 0.12, end: 0.123, sd: 0.008, onset: 130 },
  { key: 'spiral', modality: 'handwriting', label: 'Spiral deviation', unit: 'mm', decimals: 2, higherIsBetter: false, start: 1.9, end: 1.96, sd: 0.12, onset: 130 },
]

const DAYS = 180
const BASELINE_DAYS = 28
const TODAY = Date.UTC(2026, 10, 7)
const DAY_MS = 86_400_000

/** Clinician-rated ALSFRS-R at clinic visits (0–48). */
export const CLINIC_VISITS = [
  { day: 8, score: 46 },
  { day: 94, score: 45 },
  { day: 168, score: 44 },
]
export const NEXT_VISIT = Date.UTC(2026, 11, 3)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Session = {
  t: number
  day: number
  values: Record<string, number>
  /** 7-session rolling z vs baseline per modality; negative = worse than baseline */
  z: Record<Modality, number>
  /** Composite motor-function index, personal baseline = 100 */
  mfi: number
  /** Model-estimated ALSFRS-R */
  alsfrs: number
}

function build(): Session[] {
  const r = mulberry32(2026)
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
  const raw: { t: number; day: number; values: Record<string, number> }[] = []
  for (let day = 0; day < DAYS; day++) {
    if (r() > 0.86 && day < DAYS - 1) continue // missed days; always have today
    const values: Record<string, number> = {}
    for (const f of FEATURES) {
      const p = Math.min(1, Math.max(0, (day - f.onset) / (DAYS - f.onset))) ** 1.3
      values[f.key] = f.start + (f.end - f.start) * p + gauss() * f.sd
    }
    raw.push({ t: TODAY - (DAYS - 1 - day) * DAY_MS, day, values })
  }

  const base = raw.filter((s) => s.day < BASELINE_DAYS)
  const stats = Object.fromEntries(
    FEATURES.map((f) => {
      const xs = base.map((s) => s.values[f.key])
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
      return [f.key, { mean, sd }]
    }),
  )

  const featureZ = (v: number, f: FeatureDef) => ((v - stats[f.key].mean) / stats[f.key].sd) * (f.higherIsBetter ? 1 : -1)

  return raw.map((s, i) => {
    const window = raw.slice(Math.max(0, i - 6), i + 1)
    const z = {} as Record<Modality, number>
    for (const m of MODALITIES) {
      const fs = FEATURES.filter((f) => f.modality === m.key)
      const per = fs.map((f) => window.reduce((a, w) => a + featureZ(w.values[f.key], f), 0) / window.length)
      z[m.key] = per.reduce((a, b) => a + b, 0) / per.length
    }
    const avg = (z.speech + z.typing + z.handwriting) / 3
    return { ...s, z, mfi: 100 + 3 * avg, alsfrs: Math.min(48, 46 + 0.55 * avg) }
  })
}

export const SESSIONS = build()

export const BASELINE = Object.fromEntries(
  FEATURES.map((f) => {
    const xs = SESSIONS.filter((s) => s.day < BASELINE_DAYS).map((s) => s.values[f.key])
    return [f.key, xs.reduce((a, b) => a + b, 0) / xs.length]
  }),
) as Record<string, number>

export type Status = 'flag' | 'watch' | 'stable'
export const statusOf = (z: number): Status => (z <= -2 ? 'flag' : z <= -1 ? 'watch' : 'stable')
export const STATUS_LABEL: Record<Status, string> = { flag: 'Flagged', watch: 'Watch', stable: 'Stable' }

function slopePerMonth(points: { t: number; y: number }[]) {
  const n = points.length
  if (n < 2) return 0
  const mx = points.reduce((a, p) => a + p.t, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  const num = points.reduce((a, p) => a + (p.t - mx) * (p.y - my), 0)
  const den = points.reduce((a, p) => a + (p.t - mx) ** 2, 0)
  return (num / den) * DAY_MS * 30.44
}

export function summarize(rangeDays: number) {
  const period = SESSIONS.filter((s) => s.day >= DAYS - rangeDays)
  const latest = SESSIONS[SESSIONS.length - 1]
  const first = period[0]
  const recent = SESSIONS.slice(-7)

  const alsfrsSlope = slopePerMonth(SESSIONS.filter((s) => s.day >= DAYS - 60).map((s) => ({ t: s.t, y: s.alsfrs })))
  const forecast = Array.from({ length: 7 }, (_, m) => {
    const t = latest.t + m * 30.44 * DAY_MS
    const y = latest.alsfrs + alsfrsSlope * m
    const spread = m === 0 ? 0 : 0.6 + 0.35 * m
    return { t, forecast: y, band: [y - spread, y + spread] as [number, number] }
  })

  const modalities = MODALITIES.map((m) => {
    const z = latest.z[m.key]
    const daysBelow = (() => {
      let n = 0
      for (let i = SESSIONS.length - 1; i >= 0 && SESSIONS[i].z[m.key] <= -1; i--) n++
      return n
    })()
    const features = FEATURES.filter((f) => f.modality === m.key).map((f) => {
      const current = recent.reduce((a, s) => a + s.values[f.key], 0) / recent.length
      const change = (current - BASELINE[f.key]) / BASELINE[f.key]
      const worse = f.higherIsBetter ? change < 0 : change > 0
      return { ...f, baseline: BASELINE[f.key], current, change, worse }
    })
    return { ...m, z, status: statusOf(z), daysBelow, features }
  })

  return {
    period,
    first,
    latest,
    adherence: period.length / rangeDays,
    mfiChange: latest.mfi - first.mfi,
    alsfrsSlope,
    forecast,
    modalities,
  }
}

export const fmtDate = (t: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(t)
export const DAY = DAY_MS
