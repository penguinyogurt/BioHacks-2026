import { useEffect, useRef, useState } from 'react'
import { CartesianGrid, LabelList, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ArrowRight, Download, FileText, Loader2, Play, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { readCasePdf } from '@/lib/case-pdf'
import { buildReportPdf } from '@/lib/report-pdf'
import { MATCHES, PROFILE_POINTS, PROFILES, SAMPLE_PATIENT } from '@/lib/pipeline'
import { useRun } from '@/lib/run-store'
import { LANE_COLORS } from './lanes'
import { EmptyStage, PatientCard, STEPS, StageHeader, StepNav, Trace } from './pieces'

type Go = (view: string) => void

/* ------------------------------------------------------------ 00 patient case */

function CaseUpload() {
  const { caseFile, setCaseFile, state } = useRun()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const locked = state.phase === 'running'

  async function take(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setCaseFile(await readCasePdf(file))
    } catch {
      setError('Couldn’t read that PDF. Is it password-protected or a scanned image?')
    } finally {
      setBusy(false)
    }
  }

  if (caseFile) {
    return (
      <Card className="gap-3 [--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-normal">
            <FileText className="size-4 text-muted-foreground" aria-hidden /> {caseFile.name}
          </CardTitle>
          <CardAction>
            <Button size="icon-sm" variant="ghost" disabled={locked} onClick={() => setCaseFile(null)} aria-label="Remove case PDF">
              <X />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {caseFile.pages} page{caseFile.pages === 1 ? '' : 's'} · {caseFile.words.toLocaleString()} words
          </p>
          {/* The browser's own PDF viewer: scrolling, zoom, search, page thumbnails and print. */}
          <iframe
            src={`${caseFile.url}#view=FitH`}
            title={`Case PDF: ${caseFile.name}`}
            className="block h-[80vh] w-full rounded-md bg-white ring-1 ring-border"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void take(e.dataTransfer.files[0])
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card px-6 py-10 text-center backdrop-blur-md transition-colors',
        drag ? 'border-[#c9732a] bg-[#c9732a]/5' : 'border-foreground/20',
      )}
    >
      {busy ? <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden /> : <Upload className="size-6 text-muted-foreground" aria-hidden />}
      <div>
        <p className="font-medium">{busy ? 'Reading the profile…' : 'Drop the patient profile PDF'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Stays in your browser</p>
      </div>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void take(e.target.files?.[0])} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>Choose PDF</Button>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}

export function CasePage({ go }: { go: Go }) {
  const { state, caseFile, start } = useRun()
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="01 · Patient case"
        title="Start with the patient"
        description="Upload the case file as a PDF. Every later step is grounded in what it contains."
      />
      <div className="grid gap-3 lg:grid-cols-12">
        <div className={cn(caseFile ? 'lg:col-span-6' : 'lg:col-span-12')}>
          <CaseUpload />
        </div>
        {/* The profile only exists once there's a file to parse it from. */}
        {caseFile ? (
          <div className="self-start lg:col-span-6">
            <PatientCard />
          </div>
        ) : null}
      </div>
      <div className="flex justify-end">
        {state.phase === 'running' || state.phase === 'paused' ? (
          <Button variant="outline" onClick={() => go(STEPS.filter((x) => x.stage && state.stages[x.stage] !== 'pending').at(-1)?.view ?? 'analysis')}>
            Run in progress <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button
            onClick={() => {
              start()
              go('analysis')
            }}
            disabled={!caseFile}
          >
            <Play aria-hidden /> {state.phase === 'done' ? 'Start a new run' : 'Run patient analysis'}
          </Button>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------- 01 patient analysis */

export function AnalysisPage() {
  const { state, caseFile } = useRun()
  const summary = state.trace.find((t) => t.stage === 'analysis' && t.step.type === 'output')
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="02 · Patient analysis"
        title="Clinical picture"
        description="The analysis agent summarises the key findings and checks the genetics against NCBI and ClinVar."
      />
      {state.stages.analysis === 'pending' ? (
        <EmptyStage view="analysis" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-5">
            <PatientCard compact />
            {caseFile ? (
              <Card className="gap-2 [--card-spacing:--spacing(4)]">
                <CardContent className="flex items-center gap-3 text-xs">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <span className="truncate">{caseFile.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{caseFile.pages} pp · {caseFile.words.toLocaleString()} words</span>
                </CardContent>
              </Card>
            ) : null}
          </div>
          <div className="space-y-3 lg:col-span-7">
            <Trace stage="analysis" title="Analysis agent" />
            {summary ? (
              <Card className="gap-2 [--card-spacing:--spacing(5)]">
                <CardHeader>
                  <CardTitle className="text-lg font-normal">Patient summary</CardTitle>
                </CardHeader>
                <CardContent><p>{summary.step.content}</p></CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
      <StepNav view="analysis" />
    </div>
  )
}

/* ---------------------------------------------------------- 02 profile agents */

export function ProfilesPage() {
  const { state } = useRun()
  return (
    <div className="mx-auto max-w-[1600px] space-y-3 text-sm">
      <StageHeader
        step="03 · Profile agents"
        title="Five therapeutic hypotheses"
        description="Five agents run in parallel, each defining the drug that would test one disease mechanism in this patient."
      />
      {state.stages.profiles === 'pending' ? (
        <EmptyStage view="profiles" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PROFILES.map((p) => {
            const ready = state.profiles.find((x) => x.lane === p.lane)
            return (
              <div key={p.lane} className="flex flex-col gap-3">
                <div className="rounded-lg border-t-4 bg-card px-4 py-3 ring-1 ring-border backdrop-blur-md" style={{ borderTopColor: LANE_COLORS[p.lane] }}>
                  <p className="text-xs text-muted-foreground">Agent {p.lane + 1}</p>
                  <p className="font-medium">{p.name}</p>
                </div>
                <Trace stage="profiles" lane={p.lane} title="Trace" maxH="max-h-48" />
                <div className={cn('rounded-lg bg-card p-4 ring-1 ring-border backdrop-blur-md transition-opacity', !ready && 'opacity-50')}>
                  {ready ? (
                    <>
                      <p className="text-sm">{ready.hypothesis}</p>
                      <dl className="mt-3 space-y-2 text-xs">
                        <div><dt className="text-muted-foreground">Targets</dt><dd>{ready.targets.join(', ')}</dd></div>
                        <div><dt className="text-muted-foreground">Modality</dt><dd>{ready.modality}</dd></div>
                        <div><dt className="text-muted-foreground">Constraints</dt><dd>{ready.constraints.join('; ')}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden /> Writing profile…</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <StepNav view="profiles" />
    </div>
  )
}

/* ---------------------------------------------------------- 03 DRKG embedding */

export function EmbeddingPage() {
  const { state } = useRun()
  const drugs = MATCHES.map((m) => ({ ...m }))
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="04 · DRKG embedding"
        title="Matching profiles to known drugs"
        description="Each profile is placed in the DRKG knowledge graph and matched to its nearest compounds by cosine similarity."
      />
      {state.stages.embedding === 'pending' ? (
        <EmptyStage view="embedding" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-8">
            <div className={cn('rounded-xl bg-card p-4 ring-1 ring-border backdrop-blur-md transition-opacity', !state.matches && 'opacity-40')}>
              <p className="text-xs text-muted-foreground">DRKG TransE embedding space · 2D projection</p>
              <ChartContainer config={{}} className="aspect-auto h-[22rem] w-full">
                <ScatterChart margin={{ top: 12, right: 32, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 6" />
                  <XAxis type="number" dataKey="x" domain={[-3.5, 3.5]} hide />
                  <YAxis type="number" dataKey="y" domain={[-3.5, 3.5]} hide />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={false}
                    content={({ payload }) => {
                      const d = payload?.[0]?.payload as (typeof drugs)[number] | undefined
                      if (!d?.drug) return null
                      return <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"><strong>{d.drug}</strong> · cosine {d.cosine.toFixed(2)}</div>
                    }}
                  />
                  {PROFILE_POINTS.map((p) => (
                    <Scatter key={`p${p.lane}`} data={[p]} fill={LANE_COLORS[p.lane]} shape="diamond" isAnimationActive={false}>
                      <ZAxis range={[220, 220]} />
                    </Scatter>
                  ))}
                  {state.matches
                    ? PROFILES.map((p) => (
                        <Scatter key={`d${p.lane}`} data={drugs.filter((d) => d.lane === p.lane)} fill={LANE_COLORS[p.lane]} fillOpacity={0.55} isAnimationActive={false}>
                          <LabelList dataKey="drug" position="right" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                        </Scatter>
                      ))
                    : null}
                </ScatterChart>
              </ChartContainer>
              <p className="text-[0.6875rem] text-muted-foreground">◆ profile vector · ● nearest compounds by cosine similarity</p>
            </div>
            <Trace stage="embedding" title="Embedding job" maxH="max-h-56" />
          </div>
          <div className="space-y-3 lg:col-span-4">
            {PROFILES.map((p) => (
              <div key={p.lane} className="rounded-lg bg-card p-3 text-xs ring-1 ring-border backdrop-blur-md">
                <p className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: LANE_COLORS[p.lane] }} /> {p.name}</p>
                {state.matches ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {MATCHES.filter((m) => m.lane === p.lane).map((m) => (
                      <li key={m.drug} className="flex justify-between gap-2"><span>{m.drug}</span><span className="text-muted-foreground tabular-nums">{m.cosine.toFixed(2)}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-muted-foreground">Searching…</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <StepNav view="embedding" />
    </div>
  )
}

/* ------------------------------------------------------ 04 research report */

export function CandidatesPage() {
  const { state, weights, date, caseFile } = useRun()
  const patient = caseFile?.patient ?? SAMPLE_PATIENT
  // The agent's report, as a PDF for the browser's own viewer (same as the case file in step 0).
  const [url, setUrl] = useState<string | null>(null)
  // Each URL is created and revoked by the same effect run, so StrictMode's
  // mount → unmount → mount can't revoke the one the viewer is still showing.
  useEffect(() => {
    if (!state.report) return
    const u = buildReportPdf({ patient, weights, date, caseName: caseFile?.name })
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [state.report, patient, weights, date, caseFile?.name])
  const filename = `Addo report - ${patient.label}.pdf`
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="05 · Research report"
        title="Ranked for this patient"
        description="A research agent weighs evidence, drug interactions, cost, access and treatment burden, then writes a cited report."
      />
      {state.stages.research === 'pending' ? (
        <EmptyStage view="candidates" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="self-start lg:col-span-4">
            <Trace stage="research" title="Research agent" maxH="max-h-[34rem]" />
          </div>
          <div className="lg:col-span-8">
            {url ? (
              <Card className="gap-3 [--card-spacing:--spacing(5)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg font-normal">
                    <FileText className="size-4 text-muted-foreground" aria-hidden /> Research report
                  </CardTitle>
                  <CardAction>
                    <Button asChild size="sm" variant="outline">
                      <a href={url} download={filename}>
                        <Download aria-hidden /> Download PDF
                      </a>
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <iframe
                    src={`${url}#view=FitH`}
                    title={`Research report for ${patient.label}`}
                    className="block h-[80vh] w-full rounded-md bg-white ring-1 ring-border"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="[--card-spacing:--spacing(6)]">
                <CardContent className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Writing the report…</CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
      <StepNav view="candidates" />
    </div>
  )
}
