import { useEffect, useReducer, useRef, useState } from 'react'
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis, Tooltip, LabelList } from 'recharts'
import { Brain, Check, ChevronRight, Circle, FastForward, Loader2, MessageSquare, Play, RotateCcw, Terminal, Wrench, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  CANDIDATES, CRITERIA, EXCLUDED, MATCHES, PROFILE_POINTS, PROFILES, STAGES, SAMPLE_PATIENT, rank, runDemoPipeline,
  type AgentStep, type DrugProfile, type PipelineEvent, type StageId, type Weights,
} from '@/lib/pipeline'
import { LANE_COLORS } from './lanes'
import { Report } from './report'

export type CompletedRun = { id: string; date: string; weights: Weights; goal: string }

type Status = 'pending' | 'running' | 'done'
type TraceItem = { stage: StageId; lane?: number; step: AgentStep }
type State = {
  phase: 'idle' | 'running' | 'done'
  stages: Record<StageId, Status>
  trace: TraceItem[]
  profiles: DrugProfile[]
  matches: boolean
  candidates: boolean
  report: boolean
}

const initial: State = {
  phase: 'idle',
  stages: { analysis: 'pending', profiles: 'pending', embedding: 'pending', research: 'pending', report: 'pending' },
  trace: [],
  profiles: [],
  matches: false,
  candidates: false,
  report: false,
}

function reducer(s: State, a: PipelineEvent | { type: 'start' } | { type: 'finish' } | { type: 'reset' }): State {
  switch (a.type) {
    case 'reset':
      return initial
    case 'start':
      return { ...initial, phase: 'running' }
    case 'finish':
      return { ...s, phase: 'done' }
    case 'stage':
      return { ...s, stages: { ...s.stages, [a.stage]: a.status } }
    case 'step':
      return { ...s, trace: [...s.trace, { stage: a.stage, lane: a.lane, step: a.step }] }
    case 'profile':
      return { ...s, profiles: [...s.profiles, a.profile].sort((x, y) => x.lane - y.lane) }
    case 'matches':
      return { ...s, matches: true }
    case 'candidates':
      return { ...s, candidates: true }
    case 'report':
      return { ...s, report: true }
  }
}

const STEP_ICON = { thinking: Brain, tool_call: Wrench, tool_result: Terminal, output: MessageSquare }
const STEP_TONE = {
  thinking: 'text-chart-4',
  tool_call: 'text-[#c9732a]',
  tool_result: 'text-[#3f7d4e]',
  output: 'text-foreground',
}

/* ------------------------------------------------------------------ pieces */

function PipelineRail({ stages, profilesDone }: { stages: State['stages']; profilesDone: number }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Pipeline progress">
      {STAGES.map((s, i) => {
        const st = stages[s.id]
        return (
          <li
            key={s.id}
            className={cn(
              'relative rounded-lg border bg-card px-3 py-2.5 backdrop-blur-md transition-colors',
              st === 'running' && 'border-[#c9732a]/60',
              st === 'done' && 'border-foreground/25',
            )}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              {st === 'done' ? (
                <Check className="size-3.5 text-foreground" aria-label="done" />
              ) : st === 'running' ? (
                <Loader2 className="size-3.5 animate-spin text-[#c9732a]" aria-label="running" />
              ) : (
                <Circle className="size-3 opacity-40" aria-label="pending" />
              )}
            </div>
            <p className="mt-1 truncate text-sm font-medium">{s.label}</p>
            <p className="truncate text-[0.6875rem] text-muted-foreground">{s.detail}</p>
            {s.id === 'profiles' ? (
              <div className="mt-2 flex gap-1" aria-hidden>
                {LANE_COLORS.map((c, l) => (
                  <span key={c} className="h-1 flex-1 rounded-full transition-opacity" style={{ background: c, opacity: l < profilesDone ? 1 : st === 'running' ? 0.35 : 0.2 }} />
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function PatientCard({ compact = false }: { compact?: boolean }) {
  const p = SAMPLE_PATIENT
  const rows: [string, string][] = [
    ['Presentation', `${p.age}${p.sex} · ${p.onset} · ${p.monthsSinceDx} mo`],
    ['ALSFRS-R', `${p.alsfrs}/48 · ${p.slope} pts/mo`],
    ['FVC', `${p.fvc}% predicted`],
    ['Genetics', p.genetics],
    ['Medication', p.medications.join(', ')],
    ['Conditions', p.comorbidities.join(', ')],
    ['Location', `${p.location} · ${p.coverage}`],
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

function AgentTrace({ trace, running }: { trace: TraceItem[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [trace.length])
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">Agent trace</span>
        <span className="text-xs text-muted-foreground tabular-nums">{trace.length} steps</span>
      </div>
      <div ref={ref} className="max-h-[26rem] overflow-y-auto">
        {STAGES.map((s) => {
          const items = trace.filter((t) => t.stage === s.id)
          if (!items.length) return null
          return (
            <div key={s.id}>
              <p className="sticky top-0 z-10 border-b bg-background/85 px-3 py-1 text-[0.6875rem] tracking-wide text-muted-foreground uppercase backdrop-blur">{s.label}</p>
              {items.map((it, i) => <StepRow key={i} item={it} />)}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        {running ? <><Loader2 className="size-3 animate-spin text-[#c9732a]" aria-hidden /> Agents are working…</> : 'Run complete.'}
      </div>
    </Card>
  )
}

function ProfileCards({ profiles }: { profiles: DrugProfile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PROFILES.map((p) => {
        const ready = profiles.some((x) => x.lane === p.lane)
        return (
          <div key={p.lane} className={cn('rounded-lg border bg-card p-4 backdrop-blur-md transition-opacity', !ready && 'opacity-40')}>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: LANE_COLORS[p.lane] }} />
              <span className="text-xs text-muted-foreground">Agent {p.lane + 1}</span>
              {!ready ? <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" aria-label="working" /> : null}
            </div>
            <p className="mt-1.5 font-medium">{p.name}</p>
            {ready ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">{p.hypothesis}</p>
                <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Targets</dt><dd>{p.targets.join(', ')}</dd>
                  <dt className="text-muted-foreground">Modality</dt><dd>{p.modality}</dd>
                  <dt className="text-muted-foreground">Constraints</dt><dd>{p.constraints.join('; ')}</dd>
                </dl>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function EmbeddingView() {
  const drugs = MATCHES.map((m) => ({ ...m, kind: 'drug' }))
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
      <div className="rounded-lg border bg-card p-3 backdrop-blur-md">
        <p className="px-1 text-xs text-muted-foreground">DRKG TransE embedding space · 2D projection</p>
        <ChartContainer config={{}} className="aspect-auto h-72 w-full">
          <ScatterChart margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 6" />
            <XAxis type="number" dataKey="x" domain={[-3.5, 3.5]} hide />
            <YAxis type="number" dataKey="y" domain={[-3.5, 3.5]} hide />
            <ZAxis range={[60, 60]} />
            <Tooltip
              cursor={false}
              content={({ payload }) => {
                const d = payload?.[0]?.payload as (typeof drugs)[number] | undefined
                if (!d?.drug) return null
                return (
                  <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">
                    <strong>{d.drug}</strong> · cosine {d.cosine.toFixed(2)}
                  </div>
                )
              }}
            />
            {PROFILE_POINTS.map((p) => (
              <Scatter key={`p${p.lane}`} data={[p]} fill={LANE_COLORS[p.lane]} shape="diamond" isAnimationActive={false}>
                <ZAxis range={[220, 220]} />
              </Scatter>
            ))}
            {PROFILES.map((p) => (
              <Scatter key={`d${p.lane}`} data={drugs.filter((d) => d.lane === p.lane)} fill={LANE_COLORS[p.lane]} fillOpacity={0.55} isAnimationActive={false}>
                <LabelList dataKey="drug" position="right" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              </Scatter>
            ))}
          </ScatterChart>
        </ChartContainer>
        <p className="px-1 text-[0.6875rem] text-muted-foreground">◆ profile vector · ● nearest compounds by cosine similarity</p>
      </div>
      <div className="space-y-3">
        {PROFILES.map((p) => (
          <div key={p.lane} className="rounded-lg border bg-card p-3 text-xs backdrop-blur-md">
            <p className="flex items-center gap-1.5 font-medium">
              <span className="size-2 rounded-full" style={{ background: LANE_COLORS[p.lane] }} /> {p.name}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {MATCHES.filter((m) => m.lane === p.lane).map((m) => (
                <li key={m.drug} className="flex justify-between gap-2">
                  <span>{m.drug}</span>
                  <span className="text-muted-foreground tabular-nums">{m.cosine.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function CandidatesView({ weights, setWeights }: { weights: Weights; setWeights: (w: Weights) => void }) {
  const ranked = rank(CANDIDATES, weights)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 backdrop-blur-md">
        <span className="text-xs text-muted-foreground">Rank by</span>
        {CRITERIA.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-xs" title={c.hint}>
            <Switch checked={weights[c.key]} onCheckedChange={(v) => setWeights({ ...weights, [c.key]: v })} />
            {c.label}
          </label>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card backdrop-blur-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>Delivery</TableHead>
              {CRITERIA.map((c) => (
                <TableHead key={c.key} title={c.label} className={cn('text-right', !weights[c.key] && 'opacity-40')}>{c.short}</TableHead>
              ))}
              <TableHead className="text-right">Overall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((c, i) => (
              <TableRow key={c.drug}>
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: LANE_COLORS[c.lane] }} />
                    <span className="font-medium">{c.drug}</span>
                  </div>
                  <div className="max-w-[14rem] text-xs whitespace-normal text-muted-foreground">{c.cls}</div>
                </TableCell>
                <TableCell className="text-xs whitespace-normal">
                  <div>BBB alone: {c.bbbAlone}</div>
                  <div className="text-[#a35b1d]">MRgFUS: {c.withFus}</div>
                </TableCell>
                {CRITERIA.map((k) => (
                  <TableCell key={k.key} className={cn('text-right tabular-nums', !weights[k.key] && 'opacity-40')}>{c.scores[k.key]}</TableCell>
                ))}
                <TableCell className="text-right">
                  <span className="font-brand text-lg tabular-nums">{c.overall}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg border bg-card px-4 py-3 text-xs backdrop-blur-md">
        <p className="mb-1.5 text-muted-foreground">Excluded for this patient</p>
        <ul className="space-y-0.5">
          {EXCLUDED.map((e) => (
            <li key={e.drug}><strong className="font-medium">{e.drug}</strong> — {e.reason}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- workspace */

const DEFAULT_GOAL =
  'Find approved or late-stage drugs that could slow progression or ease bulbar symptoms for this patient, now that MRgFUS can open the blood–brain barrier over motor cortex.'

export default function DiscoveryWorkspace({ onComplete }: { onComplete: (run: CompletedRun) => void }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [weights, setWeights] = useState<Weights>({ fit: true, safety: true, cost: true, availability: true, acceptance: true })
  const [tab, setTab] = useState('profiles')
  const runner = useRef<{ cancel: () => void; skip: () => void } | null>(null)
  const date = useRef('')

  useEffect(() => () => runner.current?.cancel(), [])

  // Follow the pipeline: switch to each result tab as its stage produces output.
  useEffect(() => {
    if (state.report) setTab('report')
    else if (state.candidates) setTab('candidates')
    else if (state.matches) setTab('embedding')
  }, [state.matches, state.candidates, state.report])

  const start = () => {
    dispatch({ type: 'start' })
    setTab('profiles')
    date.current = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
    runner.current = runDemoPipeline(SAMPLE_PATIENT, dispatch, () => {
      dispatch({ type: 'finish' })
      onComplete({ id: crypto.randomUUID(), date: date.current, weights, goal })
    })
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <div className="rounded-xl bg-card px-5 pt-5 pb-4 ring-1 ring-border backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Discovery / {state.phase === 'idle' ? 'New run' : SAMPLE_PATIENT.label}</p>
            <h2 className="font-brand mt-3 text-[clamp(2.25rem,3.6vw,3.25rem)] leading-none">Find a way across the barrier.</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Five agents profile the ideal drug for this patient, DRKG embeddings find the closest real compounds, and a research
              agent ranks them on what matters to the patient.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-watch/40 bg-watch/10 font-normal text-watch">Simulated run</Badge>
            {state.phase === 'running' ? (
              <Button size="sm" variant="outline" onClick={() => runner.current?.skip()}>
                <FastForward aria-hidden /> Skip to results
              </Button>
            ) : state.phase === 'done' ? (
              <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'reset' })}>
                <RotateCcw aria-hidden /> New run
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <PipelineRail stages={state.stages} profilesDone={state.profiles.length} />

      {state.phase === 'idle' ? (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5"><PatientCard /></div>
          <Card className="gap-4 [--card-spacing:--spacing(5)] lg:col-span-7">
            <CardHeader>
              <CardTitle className="text-lg font-normal">Research goal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={4} className="bg-background/70 text-sm" aria-label="Research goal" />
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Weigh candidates by</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CRITERIA.map((c) => (
                    <label key={c.key} className="flex items-start gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
                      <Switch className="mt-0.5" checked={weights[c.key]} onCheckedChange={(v) => setWeights({ ...weights, [c.key]: v })} />
                      <span>
                        <span className="block text-sm">{c.label}</span>
                        <span className="block text-xs text-muted-foreground">{c.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-xs text-muted-foreground">Delivery assumption: MR-guided focused ultrasound BBB opening (Sunnybrook)</span>
                <Button onClick={start} disabled={!goal.trim()}>
                  <Play aria-hidden /> Run 5 agents
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-4">
            <PatientCard compact />
            <AgentTrace trace={state.trace} running={state.phase === 'running'} />
          </div>
          <div className="lg:col-span-8">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-card backdrop-blur-md">
                <TabsTrigger value="profiles">Profiles <span className="text-muted-foreground tabular-nums">{state.profiles.length}/5</span></TabsTrigger>
                <TabsTrigger value="embedding" disabled={!state.matches}>Embedding</TabsTrigger>
                <TabsTrigger value="candidates" disabled={!state.candidates}>Candidates</TabsTrigger>
                <TabsTrigger value="report" disabled={!state.report}>Report</TabsTrigger>
              </TabsList>
              <TabsContent value="profiles" className="mt-3"><ProfileCards profiles={state.profiles} /></TabsContent>
              <TabsContent value="embedding" className="mt-3"><EmbeddingView /></TabsContent>
              <TabsContent value="candidates" className="mt-3"><CandidatesView weights={weights} setWeights={setWeights} /></TabsContent>
              <TabsContent value="report" className="mt-3">
                <div className="rounded-xl bg-card p-6 ring-1 ring-border backdrop-blur-md">
                  <Report patient={SAMPLE_PATIENT} weights={weights} date={date.current} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  )
}
