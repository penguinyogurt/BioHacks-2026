import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import type { CaseFile } from './case-pdf'
import {
  DEMO_LANES, SAMPLE_PATIENT, STAGES, runDemoStage,
  type AgentStep, type DrugProfile, type Lane, type PipelineEvent, type StageId, type Weights,
} from './pipeline'
import { agentAvailable, runLiveAgent, type LiveIds } from './agent-api'
import { clearRun, loadCase, loadRun, saveCase, saveRun, type SavedRun } from './session'
import { saveReport } from './reports-db'

/** Saving a finished live report to Supabase (lib/reports-db.ts). 'off': not signed in / not configured. */
export type ReportSave = { status: 'idle' | 'saving' | 'saved' | 'off' | 'error'; message?: string }

/**
 * One discovery run, shared by every pipeline page (case → analysis → profiles →
 * embedding → candidates → report). The run advances ONE stage at a time: when a
 * stage finishes it pauses until the user starts the next.
 */

export type StageStatus = 'pending' | 'running' | 'done'
export type TraceItem = { stage: StageId; lane?: number; step: AgentStep }
export type CompletedRun = {
  id: string
  date: string
  weights: Weights
  goal: string
  caseName: string | null
  caseFile: CaseFile | null
  /** Final state of every step, so the whole run can be reopened later. */
  snapshot: RunState
}

export type RunState = {
  /** idle: not started · running: a stage is working · paused: waiting for the user · done: report written */
  phase: 'idle' | 'running' | 'paused' | 'done'
  stages: Record<StageId, StageStatus>
  trace: TraceItem[]
  /** live: analysis + profiles come from the research agent on :8001 · simulated: all scripted */
  source: 'live' | 'simulated'
  /** The parallel profile agents: one per brief in a live plan, the five scripted ones otherwise. */
  lanes: Lane[]
  profiles: DrugProfile[]
  error: string | null
  /** Live runs: scene.json for stage 3 (null → the demo scene) and the backend's report PDF for stage 4. */
  sceneSrc: string | null
  /** Live runs: the backend patient record id, e.g. "alex-chen-3f9a1c". */
  patientId: string | null
  reportPdf: string | null
  /** Live runs: the drug-assessment run id, which the report chat (/api/assess/<id>/chat) talks about. */
  assessRunId: string | null
  matches: boolean
  candidates: boolean
  report: boolean
}

const initial: RunState = {
  phase: 'idle',
  stages: { analysis: 'pending', profiles: 'pending', embedding: 'pending', research: 'pending' },
  trace: [],
  source: 'simulated',
  lanes: DEMO_LANES,
  profiles: [],
  error: null,
  sceneSrc: null,
  patientId: null,
  reportPdf: null,
  assessRunId: null,
  matches: false,
  candidates: false,
  report: false,
}

type Action =
  | PipelineEvent
  | { type: 'begin'; source: RunState['source'] }
  | { type: 'fail'; error: string }
  | { type: 'stage-start' }
  | { type: 'stage-end'; last: boolean }
  | { type: 'reset' }
  | { type: 'load'; state: RunState }

function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case 'reset':
      return initial
    case 'load':
      return a.state
    case 'begin':
      return { ...initial, phase: 'running', source: a.source, lanes: a.source === 'live' ? [] : DEMO_LANES }
    case 'fail':
      return {
        ...s,
        phase: 'idle',
        error: a.error,
        stages: Object.fromEntries(Object.entries(s.stages).map(([k, v]) => [k, v === 'running' ? 'pending' : v])) as RunState['stages'],
      }
    case 'lanes':
      return { ...s, lanes: a.lanes }
    case 'patient':
      return { ...s, patientId: a.id }
    case 'scene':
      return { ...s, sceneSrc: a.src, matches: true }
    case 'reportPdf':
      return { ...s, reportPdf: a.url, assessRunId: a.runId, candidates: true }
    case 'stage-start':
      return { ...s, phase: 'running' }
    case 'stage-end':
      return { ...s, phase: a.last ? 'done' : 'paused' }
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

/** The stage the user can start next, if any. */
export function nextStage(s: RunState): StageId | null {
  if (s.phase !== 'paused') return null
  return STAGES.find((x) => s.stages[x.id] === 'pending')?.id ?? null
}

export const DEFAULT_GOAL = 'Drugs that could slow progression or ease bulbar symptoms, given MRgFUS can open the blood–brain barrier.'

type Store = {
  state: RunState
  caseFile: CaseFile | null
  setCaseFile: (f: CaseFile | null) => void
  goal: string
  setGoal: (g: string) => void
  weights: Weights
  setWeights: (w: Weights) => void
  date: string
  runs: CompletedRun[]
  /** Start a new run: patient analysis only. */
  start: () => void
  /** Run the next stage, after the user asks for it. */
  advance: () => void
  /** Finish the stage that's running now. */
  skip: () => void
  reset: () => void
  /** Reopen a finished run on every step page. */
  open: (run: CompletedRun) => void
  /** Id of the reopened run, if one is being viewed. */
  openedId: string | null
  /** Whether the finished live report made it into Supabase. */
  reportSave: ReportSave
}

const Ctx = createContext<Store | null>(null)

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [caseFile, setCaseFileState] = useState<CaseFile | null>(null)
  // The upload is kept in the browser, so a reload doesn't lose it (lib/session.ts).
  const setCaseFile = useCallback((f: CaseFile | null) => {
    setCaseFileState(f)
    void saveCase(f)
  }, [])
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [weights, setWeights] = useState<Weights>({ fit: true, safety: true, cost: true, availability: true, acceptance: true })
  const [date, setDate] = useState('')
  const [runs, setRuns] = useState<CompletedRun[]>([])
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [reportSave, setReportSave] = useState<ReportSave>({ status: 'idle' })
  const runner = useRef<{ cancel: () => void; skip: () => void } | null>(null)
  const starting = useRef(false)
  // Bumped by reset/open/resume, so a start still awaiting the health check can't resurrect itself.
  const generation = useRef(0)
  // Mirror of the reducer, so a finished run can be saved whole without waiting for a render.
  const snap = useRef<RunState>(initial)
  const meta = useRef({ when: '', caseFile: null as CaseFile | null, goal: '', weights })

  useEffect(() => () => runner.current?.cancel(), [])

  const apply = useCallback((a: Action) => {
    snap.current = reducer(snap.current, a)
    dispatch(a)
  }, [])

  /** Keep a finished run so it can be reopened from the runs page. */
  const save = useCallback(() => {
    const m = meta.current
    const run: CompletedRun = {
      id: crypto.randomUUID(),
      date: m.when,
      weights: m.weights,
      goal: m.goal,
      caseName: m.caseFile?.name ?? null,
      caseFile: m.caseFile,
      snapshot: snap.current,
    }
    setRuns((r) => [run, ...r])
    setOpenedId(run.id)
  }, [])

  const runStage = useCallback(
    (stage: StageId) => {
      const m = meta.current
      const caseInput = m.caseFile
        ? { name: m.caseFile.name, pages: m.caseFile.pages, words: m.caseFile.words, excerpt: m.caseFile.text.join(' ').slice(0, 220).trim() }
        : null
      apply({ type: 'stage-start' })
      runner.current = runDemoStage(m.caseFile?.patient ?? SAMPLE_PATIENT, caseInput, stage, apply, () => {
        runner.current = null
        const last = stage === STAGES[STAGES.length - 1].id
        apply({ type: 'stage-end', last })
        if (last) save()
      })
    },
    [apply, save],
  )

  /** Run (or resume) the live pipeline, saving its backend ids as they appear so a reload can pick it up. */
  const launch = useCallback(
    (saved: SavedRun) => {
      saveRun(saved)
      let ids = saved.ids
      setReportSave({ status: 'idle' })
      const cancel = runLiveAgent(
        saved.goal,
        apply,
        (error) => {
          runner.current = null
          if (error) return apply({ type: 'fail', error })
          apply({ type: 'stage-end', last: true })
          save()
          // Keep the report beyond this machine's backend: Supabase, under the signed-in user.
          setReportSave({ status: 'saving' })
          void saveReport(ids).then(setReportSave)
        },
        saved.ids,
        (next: LiveIds) => {
          ids = next
          saveRun({ ...saved, ids: next })
        },
        meta.current.caseFile,
      )
      runner.current = { cancel, skip: () => {} }
    },
    [apply, save],
  )

  /** Rebuild an existing live run from the backend's event replay; nothing is re-run. */
  const resume = useCallback(
    (saved: SavedRun, file: CaseFile | null) => {
      generation.current++
      runner.current?.cancel()
      meta.current = { when: saved.when, caseFile: file, goal: saved.goal, weights: saved.weights }
      setDate(saved.when)
      setGoal(saved.goal)
      setWeights(saved.weights)
      setOpenedId(null)
      snap.current = initial
      apply({ type: 'begin', source: 'live' })
      launch(saved)
    },
    [apply, launch],
  )

  // After a reload (or a discarded tab): bring back the case file and the live run, if any.
  // The backend replays every event of a run on connect, so the run rebuilds at once,
  // finished stages and report included, and nothing is started or paid for twice.
  useEffect(() => {
    let alive = true
    void (async () => {
      const file = await loadCase()
      if (!alive) return
      if (file) setCaseFileState(file)
      const saved = loadRun()
      if (!saved?.ids.research || snap.current.phase !== 'idle') return
      resume(saved, file)
    })()
    return () => {
      alive = false
    }
    // Once, on mount: resume() is stable enough, and re-running this would resume twice.
  }, [])

  const start = useCallback(async () => {
    if (starting.current) return
    starting.current = true
    runner.current?.cancel()
    const gen = generation.current
    const live = await agentAvailable()
    starting.current = false
    if (gen !== generation.current) return
    const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
    meta.current = { when, caseFile, goal, weights }
    setDate(when)
    setOpenedId(null)
    snap.current = initial
    apply({ type: 'begin', source: live ? 'live' : 'simulated' })
    clearRun()
    if (!live) return runStage('analysis')
    // A live run goes straight through all four stages: research agents → DRKG → drug assessment.
    launch({ ids: {}, goal, when, weights })
  }, [apply, runStage, launch, caseFile, goal, weights])

  const advance = useCallback(() => {
    const next = nextStage(snap.current)
    if (next) runStage(next)
  }, [runStage])

  const skip = useCallback(() => runner.current?.skip(), [])

  const reset = useCallback(() => {
    clearRun()
    generation.current++
    runner.current?.cancel()
    runner.current = null
    snap.current = initial
    dispatch({ type: 'reset' })
    setOpenedId(null)
  }, [])

  const open = useCallback((run: CompletedRun) => {
    generation.current++
    runner.current?.cancel()
    runner.current = null
    snap.current = run.snapshot
    dispatch({ type: 'load', state: run.snapshot })
    setCaseFileState(run.caseFile)
    setGoal(run.goal)
    setWeights(run.weights)
    setDate(run.date)
    setOpenedId(run.id)
  }, [])

  return (
    <Ctx.Provider
      value={{ state, caseFile, setCaseFile, goal, setGoal, weights, setWeights, date, runs, start, advance, skip, reset, open, openedId, reportSave }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useRun() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRun must be used inside <RunProvider>')
  return ctx
}
