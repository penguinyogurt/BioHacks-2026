import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Download, FileText, Loader2, Play, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { readCasePdf } from '@/lib/case-pdf'
import { buildReportPdf } from '@/lib/report-pdf'
import { PROFILES, SAMPLE_PATIENT, type StageId } from '@/lib/pipeline'
import { useRun } from '@/lib/run-store'
import { AGENT_PATIENT } from '@/lib/agent-api'
import { LANE_COLORS } from './lanes'
import { EmptyStage, PatientCard, STEPS, StageHeader, StepNav, Trace, useGo } from './pieces'
import { DrkgScene } from './drkg-scene'
import { DEFAULT_SRC, useDrkg } from './drkg-data'
import { ProfileGrid } from './profile-card'

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

/**
 * A live run moves on by itself: when `stage` starts, follow it to `view`, `delay` ms after
 * `ready` (e.g. once the DRKG scene has finished drawing). Fires only on that transition,
 * so going back to an earlier page stays put. Once due, the move survives the stage
 * finishing in the meantime (DRKG takes ~2 s, less than some delays).
 */
function useFollow(stage: StageId, view: string, ready = true, delay = 0) {
  const { state } = useRun()
  const go = useGo()
  const status = state.stages[stage]
  const live = state.source === 'live'
  const was = useRef(status)
  const [due, setDue] = useState(false)
  useEffect(() => {
    if (!ready) return
    if (live && was.current === 'pending' && status !== 'pending') setDue(true)
    was.current = status
  }, [live, status, ready])
  useEffect(() => {
    if (!due) return
    const t = setTimeout(() => go(view), delay)
    return () => clearTimeout(t)
    // `go` is a new function every render (Home's setView); `due` makes this fire once anyway.
  }, [due, view, delay])
}

/* -------------------------------------------------------- 01 patient analysis */

export function AnalysisPage() {
  const { state, caseFile } = useRun()
  const live = state.source === 'live'
  const summary = state.trace.find((t) => t.stage === 'analysis' && t.step.type === 'output' && (t.step.label === 'Patient summary' || t.step.label === 'Research plan'))
  // The moment the orchestrator sends its briefs to the sub-agents, follow it to their page.
  useFollow('profiles', 'profiles')
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="02 · Patient analysis"
        title="Clinical picture"
        description={
          live
            ? 'The orchestrator reads the full record, picks the mechanisms and symptoms that matter for this patient, and writes one sanitised brief per sub-agent.'
            : 'The analysis agent summarises the key findings and checks the genetics against NCBI and ClinVar.'
        }
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
            <Trace stage="analysis" title={live ? 'Orchestrator' : 'Analysis agent'} />
            {summary ? (
              <Card className="gap-2 [--card-spacing:--spacing(5)]">
                <CardHeader>
                  <CardTitle className="text-lg font-normal">{summary.step.label}</CardTitle>
                </CardHeader>
                <CardContent><p className="whitespace-pre-line">{summary.step.content}</p></CardContent>
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

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']

export function ProfilesPage() {
  const { state } = useRun()
  const n = state.lanes.length
  const count = COUNT[n] ?? String(n)
  const ranked = state.trace.find((t) => t.step.label === 'Ranked for this patient')
  // Straight to the DRKG page the moment stage 3 starts, so the traversal is watched from its first frame.
  useFollow('embedding', 'embedding')
  return (
    <div className="mx-auto max-w-[1600px] space-y-3 text-sm">
      <StageHeader
        step="03 · Profile agents"
        title={`${count} therapeutic hypotheses`}
        description={`${count} agents run in parallel, each defining the drug that would test one disease mechanism in this patient.`}
      />
      {state.stages.profiles === 'pending' ? (
        <EmptyStage view="profiles" />
      ) : (
        <>
        <ProfileGrid />
        {ranked ? (
          <Card className="gap-2 [--card-spacing:--spacing(5)]">
            <CardHeader>
              <CardTitle className="text-lg font-normal">Ranked for this patient</CardTitle>
            </CardHeader>
            <CardContent><p className="whitespace-pre-line">{ranked.step.content}</p></CardContent>
          </Card>
        ) : null}
        </>
      )}
      <StepNav view="profiles" />
    </div>
  )
}

/* ---------------------------------------------------------- 03 DRKG embedding */

export function EmbeddingPage() {
  const { state } = useRun()
  const live = state.source === 'live'
  // Live: the scene the backend computed from the agents' own target genes. Until it lands, nothing.
  const src = live ? state.sceneSrc : DEFAULT_SRC
  const { data } = useDrkg(src ?? DEFAULT_SRC)
  // Arriving while the stage is still working means the user should watch the traversal draw.
  const [fresh] = useState(state.stages.embedding !== 'done')
  const [focus, setFocus] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(0)
  useEffect(() => {
    if (selected === null) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [selected])
  const profiles = src ? (data?.scene.profiles ?? []) : []
  const placeholder = live ? state.lanes : PROFILES
  // Move on to the report once every profile has been drawn, with a beat to take it in.
  useFollow('research', 'candidates', profiles.length > 0 && revealed >= profiles.length, 3000)
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <StageHeader
        step="04 · DRKG embedding"
        title="Matching profiles to known drugs"
        description="Each profile's target genes are walked through the DRKG graph, then translated into the TransE embedding space (e[gene] − r[target]); the nearest DrugBank compounds by 400-d L2 distance become candidates."
      />
      {state.stages.embedding === 'pending' ? (
        <EmptyStage view="embedding" />
      ) : (
        <div className="space-y-3">
          {src ? (
          <DrkgScene
              key={src}
              src={src}
              status={fresh && state.stages.embedding === 'done' ? 'running' : state.stages.embedding}
              focusLane={focus}
              selectedLane={selected}
              onSelectLane={setSelected}
              onReveal={setRevealed}
              className="h-[38rem]"
            />
          ) : (
            <Card className="h-[38rem] [--card-spacing:--spacing(6)]">
              <CardContent className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Scoring the agents’ target genes against every DrugBank compound in DRKG…
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {(profiles.length ? profiles : placeholder.map((p) => ({ lane: p.lane, name: p.name, matches: [], unresolved: [] }))).map((p, i) => (
              <button
                type="button"
                key={p.lane}
                disabled={revealed <= i}
                aria-pressed={selected === p.lane}
                onClick={() => setSelected((s) => (s === p.lane ? null : p.lane))}
                onMouseEnter={() => revealed > i && setFocus(p.lane)}
                onMouseLeave={() => setFocus(null)}
                className={cn(
                  'block w-full rounded-lg bg-card p-3 text-left text-xs ring-1 ring-border backdrop-blur-md transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                  focus === p.lane && selected === null && 'ring-ring/60',
                  selected === p.lane && 'ring-2 ring-ring',
                  selected !== null && selected !== p.lane && 'opacity-60',
                )}
              >
                <p className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: LANE_COLORS[p.lane % LANE_COLORS.length] }} /> {p.name}</p>
                {revealed > i ? (
                  <>
                    <ul className="mt-1.5 space-y-0.5">
                      {p.matches.map((m) => (
                        <li key={m.id} className="flex items-baseline gap-2">
                          <span className="w-3 text-muted-foreground tabular-nums">{m.rank}</span>
                          <span className="min-w-0 truncate" title={m.name}>{m.name}</span>
                          <span className="shrink-0 text-[0.6875rem] text-muted-foreground" title={m.directEdge ? `Has a DRKG edge to ${m.viaGene}` : `Found by embedding distance from ${m.viaGene} only`}>
                            {m.directEdge ? '↔' : '≈'} {m.viaGene}
                          </span>
                          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{m.distance.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                    {p.unresolved.length ? <p className="mt-1 text-[0.6875rem] text-muted-foreground">No DRKG target edges: {p.unresolved.join(', ')}</p> : null}
                  </>
                ) : (
                  <p className="mt-1.5 text-muted-foreground">Searching…</p>
                )}
              </button>
            ))}
          </div>
          <p className="px-1 text-[0.6875rem] text-muted-foreground">↔ has a DRKG edge to the gene · ≈ found by embedding only · 400-d L2, lower is closer · click a profile to focus it, Esc to clear</p>
          <Trace stage="embedding" title="Embedding job" maxH="max-h-56" />
        </div>
      )}
      <StepNav view="embedding" />
    </div>
  )
}

/* ------------------------------------------------------ 04 research report */

export function CandidatesPage() {
  const { state, weights, date, caseFile } = useRun()
  const live = state.source === 'live'
  const patient = caseFile?.patient ?? SAMPLE_PATIENT
  // The agent's report, as a PDF for the browser's own viewer (same as the case file in step 0).
  const [url, setUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  // Each URL is created and revoked by the same effect run, so StrictMode's
  // mount → unmount → mount can't revoke the one the viewer is still showing.
  useEffect(() => {
    if (!state.report) return
    let u: string | null = null
    let gone = false
    setPdfError(null)
    if (live && state.reportPdf) {
      // The backend's PDF is served as an attachment; fetched as a blob, the browser shows it inline.
      fetch(state.reportPdf)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => {
          if (gone) return
          u = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }))
          setUrl(u)
        })
        .catch((e: Error) => !gone && setPdfError(`Couldn’t load the report PDF (${e.message}). The ranking is in the trace.`))
    } else if (!live) {
      u = buildReportPdf({ patient, weights, date, caseName: caseFile?.name })
      setUrl(u)
    }
    return () => {
      gone = true
      if (u) URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [state.report, state.reportPdf, live, patient, weights, date, caseFile?.name])
  // A live report is about the backend's patient record, not the case parsed in the browser.
  const filename = `Addo report - ${live ? AGENT_PATIENT : patient.label}.pdf`
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
                {pdfError ? (
                  <CardContent className="text-destructive" role="alert">{pdfError}</CardContent>
                ) : (
                  <CardContent className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Writing the report…</CardContent>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      <StepNav view="candidates" />
    </div>
  )
}
