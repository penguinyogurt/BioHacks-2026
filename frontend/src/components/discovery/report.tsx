import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CRITERIA, EXCLUDED, PROFILES, REFERENCES, rank, CANDIDATES, type Patient, type Weights } from '@/lib/pipeline'
import { LANE_COLORS } from './lanes'

function Cite({ ns }: { ns: number[] }) {
  if (!ns.length) return null
  return <sup className="ml-0.5 text-[0.7em] text-muted-foreground">[{ns.join(', ')}]</sup>
}

function ReportBody({ patient, weights, date, caseName }: { patient: Patient; weights: Weights; date: string; caseName?: string | null }) {
  const ranked = rank(CANDIDATES, weights)
  const enabled = CRITERIA.filter((c) => weights[c.key])
  return (
    <article className="report text-sm leading-relaxed">
      <header className="border-b pb-4">
        <p className="eyebrow">Addo Labs · discovery report</p>
        <h1 className="font-brand mt-2 text-3xl leading-tight">Alternative therapeutic candidates for {patient.label}</h1>
        <p className="mt-2 text-muted-foreground">
          {date} · {patient.onset}, ALSFRS-R {patient.alsfrs}/48 · Delivery assumption: MRgFUS blood–brain barrier opening
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Case source: {caseName ?? 'built-in sample patient'}</p>
      </header>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Summary</h2>
        <p className="mt-2">
          Most drugs that could act on ALS pathology never reach the motor cortex: the blood–brain barrier excludes nearly all
          large molecules and most small ones.<Cite ns={[7]} /> MR-guided focused ultrasound has opened the barrier safely over
          motor cortex in people with ALS,<Cite ns={[1]} /> which makes approved biologics a new search space. Five profile agents
          proposed ideal-drug profiles for this patient; each was matched against compounds in the DRKG knowledge graph
          <Cite ns={[2]} /> and the strongest matches were ranked for this patient. The top candidate is{' '}
          <strong>{ranked[0].drug}</strong> ({ranked[0].overall}/100).
        </p>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Patient context</h2>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li>{patient.age}{patient.sex}, {patient.onset.toLowerCase()}, {patient.monthsSinceDx} months since diagnosis; slope {patient.slope} pts/month; FVC {patient.fvc}%.</li>
          <li>Genetics: {patient.genetics}.</li>
          <li>Current medication: {patient.medications.join(', ')}. Conditions: {patient.comorbidities.join(', ')}.</li>
          <li>{patient.location} · {patient.coverage}. Preferences: {patient.preferences.join('; ')}.</li>
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Method</h2>
        <p className="mt-2">
          Profiles: {PROFILES.map((p) => p.name).join(' · ')}. Ranking criteria: {enabled.map((c) => c.label).join(', ')}
          {weights.fit ? ' (mechanistic fit weighted ×2)' : ''}.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Ranked candidates</h2>
        <ol className="mt-3 space-y-4">
          {ranked.map((c, i) => (
            <li key={c.drug} className="break-inside-avoid rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">
                  {i + 1}. {c.drug} <span className="font-normal text-muted-foreground">— {c.cls}</span>
                </h3>
                <span className="tabular-nums">{c.overall}/100</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: LANE_COLORS[c.lane] }} />
                {PROFILES[c.lane].name} profile · {c.sizeKDa} kDa · BBB alone: {c.bbbAlone} · With MRgFUS: {c.withFus}
              </p>
              <p className="mt-2">{c.rationale}<Cite ns={c.cites} /></p>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted-foreground">Evidence</dt><dd>{c.evidence}</dd>
                <dt className="text-muted-foreground">Safety</dt><dd>{c.safety}</dd>
                <dt className="text-muted-foreground">Cost</dt><dd>{c.cost}</dd>
                <dt className="text-muted-foreground">Availability</dt><dd>{c.availability}</dd>
                <dt className="text-muted-foreground">Acceptance</dt><dd>{c.acceptance}</dd>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Excluded for this patient</h2>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {EXCLUDED.map((e) => (
            <li key={e.drug}><strong>{e.drug}</strong> — {e.reason}<Cite ns={e.cites} /></li>
          ))}
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Limitations</h2>
        <p className="mt-2">
          Hypothesis-generating output for discussion with the care team, not a treatment recommendation. Embedding similarity
          reflects knowledge-graph structure, not demonstrated efficacy. CNS exposure after focused-ultrasound opening has not been
          measured for these drugs, and any use would need a trial or physician-led protocol.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="text-base font-semibold">References</h2>
        <ol className="mt-2 space-y-1">
          {REFERENCES.map((r) => (
            <li key={r.n} className="flex gap-2">
              <span className="w-6 shrink-0 text-muted-foreground tabular-nums">[{r.n}]</span>
              <a href={r.url} target="_blank" rel="noreferrer" className="underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground">
                {r.text}
              </a>
            </li>
          ))}
        </ol>
      </section>
    </article>
  )
}

export function Report({ patient, weights, date, caseName }: { patient: Patient; weights: Weights; date: string; caseName?: string | null }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Badge variant="outline" className="border-watch/40 bg-watch/10 font-normal text-watch">Simulated run · illustrative outputs</Badge>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Download aria-hidden /> Save as PDF
        </Button>
      </div>
      <ReportBody patient={patient} weights={weights} date={date} caseName={caseName} />
      {/* Print-only copy outside #root, so the PDF is just the report. */}
      {createPortal(
        <div className="print-only">
          <ReportBody patient={patient} weights={weights} date={date} caseName={caseName} />
        </div>,
        document.body,
      )}
    </div>
  )
}
