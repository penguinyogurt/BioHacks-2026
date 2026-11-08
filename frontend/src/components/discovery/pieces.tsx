import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Brain, Check, ChevronRight, Circle, FastForward, Loader2, MessageSquare, Play, RotateCcw, Terminal, Wrench, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { SAMPLE_PATIENT, type StageId } from '@/lib/pipeline'
import { nextStage, useRun, type TraceItem } from '@/lib/run-store'
import { LANE_COLORS } from './lanes'

export const AMBER = '#c9732a'

/** Navigate to a workspace page (view id). Provided by Home. */
export const GoContext = createContext<(view: string) => void>(() => {})
export const useGo = () => useContext(GoContext)

/** Every step of the flow, in order, with the page that shows it. */
export const STEPS: { view: string; label: string; action: string; stage?: StageId }[] = [
  { view: 'case', label: 'Patient case', action: 'Add the case' },
  { view: 'analysis', label: 'Patient analysis', action: 'Run patient analysis', stage: 'analysis' },
  { view: 'profiles', label: 'Profile agents', action: 'Run profile agents', stage: 'profiles' },
  { view: 'embedding', label: 'DRKG embedding', action: 'Run DRKG embedding', stage: 'embedding' },
  { view: 'candidates', label: 'Research report', action: 'Run research agent', stage: 'research' },
]

const STEP_ICON = { thinking: Brain, tool_call: Wrench, tool_result: Terminal, output: MessageSquare }
const STEP_TONE = { thinking: 'text-chart-4', tool_call: 'text-[#c9732a]', tool_result: 'text-[#3f7d4e]', output: 'text-foreground' }

/** Page header shared by every pipeline page: eyebrow, title, run controls. */
export function StageHeader({ step, title, description }: { step: string; title: string; description?: string }) {
  const { state, skip, reset, runs, openedId } = useRun()
  const opened = runs.find((r) => r.id === openedId)
  return (
    <PageHeader
      eyebrow={`Pipeline / ${step}`}
      title={title}
      description={description}
      actions={
        <>
          {opened ? <Badge variant="outline" className="font-normal">Run · {opened.date}</Badge> : null}
          {state.phase === 'running' ? (
            <Button size="sm" variant="outline" onClick={skip}>
              <FastForward aria-hidden /> Finish this step
            </Button>
          ) : state.phase === 'paused' || state.phase === 'done' ? (
            <Button size="sm" variant="outline" onClick={reset}>
              <RotateCcw aria-hidden /> Clear run
            </Button>
          ) : null}
        </>
      }
    />
  )
}

/**
 * Previous / next step, at the foot of every step page. The pipeline never moves
 * on by itself: when the next step hasn't run yet, Next runs it.
 */
export function StepNav({ view }: { view: string }) {
  const go = useGo()
  const { state, advance } = useRun()
  const i = STEPS.findIndex((s) => s.view === view)
  const prev = STEPS[i - 1]
  const next = STEPS[i + 1]
  const nextStatus = next?.stage ? state.stages[next.stage] : 'pending'
  const canRun = !!next?.stage && nextStage(state) === next.stage
  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Workflow steps">
      {prev ? (
        <Button variant="ghost" onClick={() => go(prev.view)}>
          <ArrowLeft aria-hidden /> {prev.label}
        </Button>
      ) : <span />}
      {next ? (
        canRun ? (
          <Button
            onClick={() => {
              advance()
              go(next.view)
            }}
          >
            <Play aria-hidden /> {next.action}
          </Button>
        ) : (
          <Button variant="outline" disabled={nextStatus === 'pending'} onClick={() => go(next.view)}>
            {next.label} <ArrowRight aria-hidden />
          </Button>
        )
      ) : null}
    </nav>
  )
}

export function StatusIcon({ status }: { status: 'pending' | 'running' | 'done' }) {
  if (status === 'done') return <Check className="size-3.5 shrink-0 text-foreground" aria-label="done" />
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-[#c9732a]" aria-label="running" />
  return <Circle className="size-3 shrink-0 opacity-40" aria-label="pending" />
}

/** Shown on a step page before its stage has run: run it, or say what it's waiting for. */
export function EmptyStage({ view }: { view: string }) {
  const { state, advance } = useRun()
  const go = useGo()
  const step = STEPS.find((s) => s.view === view)!
  const prev = STEPS[STEPS.indexOf(step) - 1]
  const ready = !!step.stage && nextStage(state) === step.stage
  return (
    <Card className="items-start gap-3 [--card-spacing:--spacing(8)]">
      <CardContent className="space-y-3">
        <p className="eyebrow">{ready ? 'Ready' : 'Not started'}</p>
        <p className="max-w-lg text-muted-foreground">
          {state.phase === 'idle'
            ? 'Start a run from the patient case.'
            : ready
              ? `${prev.label} is done. Run this step when you’re ready.`
              : `Runs after ${prev.label.toLowerCase()}.`}
        </p>
        {state.phase === 'idle' ? (
          <Button onClick={() => go('case')}>Go to patient case</Button>
        ) : ready ? (
          <Button onClick={advance}>
            <Play aria-hidden /> {step.action}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => go(prev.view)}>
            <ArrowLeft aria-hidden /> {prev.label}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function StepRow({ item }: { item: TraceItem }) {
  const [open, setOpen] = useState(false)
  const Icon = STEP_ICON[item.step.type]
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-foreground/[0.03]">
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
        {item.lane !== undefined ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: LANE_COLORS[item.lane] }} /> : null}
        <Icon className={cn('size-3.5 shrink-0', STEP_TONE[item.step.type])} aria-hidden />
        <span className="truncate text-xs">{item.step.label}</span>
      </button>
      {open ? <pre className="px-3 pb-2 pl-9 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{item.step.content}</pre> : null}
    </div>
  )
}

/** Callio-style agent trace, filtered to one stage (and optionally one lane). */
export function Trace({ stage, lane, title = 'Agent trace', className, maxH = 'max-h-[28rem]' }: { stage: StageId; lane?: number; title?: string; className?: string; maxH?: string }) {
  const { state } = useRun()
  const items = state.trace.filter((t) => t.stage === stage && (lane === undefined || t.lane === lane))
  const running = state.stages[stage] === 'running'
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [items.length])
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length} steps</span>
      </div>
      <div ref={ref} className={cn('overflow-y-auto', maxH)}>
        {items.length ? items.map((it, i) => <StepRow key={i} item={it} />) : <p className="px-4 py-3 text-xs text-muted-foreground">Waiting…</p>}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        {running ? <><Loader2 className="size-3 animate-spin text-[#c9732a]" aria-hidden /> Working…</> : state.stages[stage] === 'done' ? 'Done.' : 'Queued.'}
      </div>
    </Card>
  )
}

/** A parsed value the case file didn't state shows as a dash, never as a number we made up. */
const n = (v: number, unit = '') => (Number.isNaN(v) ? '—' : `${v}${unit}`)

/** Structured patient summary, parsed from the uploaded case PDF. */
export function PatientCard({ compact = false, footer }: { compact?: boolean; footer?: ReactNode }) {
  const { caseFile } = useRun()
  const p = caseFile?.patient ?? SAMPLE_PATIENT
  const rows: [string, string][] = [
    ['Presentation', `${n(p.age)}${p.sex} · ${p.onset} · ${n(p.monthsSinceDx, ' mo')} since diagnosis`],
    ['ALSFRS-R', `${n(p.alsfrs, '/48')} · ${n(p.slope, ' pts/mo')}`],
    ['FVC', `${n(p.fvc, '%')} predicted`],
    ['Genetics', p.genetics],
    ['Medication', p.medications.join(', ')],
    ['Conditions', p.comorbidities.join(', ') || 'None recorded'],
    ['Location', `${p.location} · Coverage: ${p.coverage}`],
  ]
  return (
    <Card className="gap-3 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="text-lg font-normal">{p.label}</CardTitle>
        <CardAction>
          {p.fusEligible ? (
            <Badge variant="outline" className="gap-1 border-[#c9732a]/40 bg-[#c9732a]/10 font-normal text-[#a35b1d]">
              <Zap className="size-3" aria-hidden /> MRgFUS eligible
            </Badge>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className={cn('grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm', compact && 'text-xs')}>
          {(compact ? rows.slice(0, 5) : rows).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {!compact ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {p.preferences.map((x) => (
              <Badge key={x} variant="outline" className="font-normal">{x}</Badge>
            ))}
          </div>
        ) : null}
        {footer}
      </CardContent>
    </Card>
  )
}
