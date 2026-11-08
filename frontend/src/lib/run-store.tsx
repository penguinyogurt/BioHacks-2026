import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import type { CaseFile } from './case-pdf'
import {
  SAMPLE_PATIENT, STAGES, runDemoStage,
  type AgentStep, type DrugProfile, type PipelineEvent, type StageId, type Weights,
} from './pipeline'

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
  profiles: DrugProfile[]
  matches: boolean
  candidates: boolean
  report: boolean
}

const initial: RunState = {
  phase: 'idle',
  stages: { analysis: 'pending', profiles: 'pending', embedding: 'pending', research: 'pending' },
  trace: [],
  profiles: [],
  matches: false,
  candidates: false,
  report: false,
}

type Action =
  | PipelineEvent
  | { type: 'begin' }
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
      return { ...initial, phase: 'running' }
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
}

const Ctx = createContext<Store | null>(null)

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [caseFile, setCaseFile] = useState<CaseFile | null>(null)
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [weights, setWeights] = useState<Weights>({ fit: true, safety: true, cost: true, availability: true, acceptance: true })
  const [date, setDate] = useState('')
  const [runs, setRuns] = useState<CompletedRun[]>([])
  const [openedId, setOpenedId] = useState<string | null>(null)
  const runner = useRef<{ cancel: () => void; skip: () => void } | null>(null)
  // Mirror of the reducer, so a finished run can be saved whole without waiting for a render.
  const snap = useRef<RunState>(initial)
  const meta = useRef({ when: '', caseFile: null as CaseFile | null, goal: '', weights })

  useEffect(() => () => runner.current?.cancel(), [])

  const apply = useCallback((a: Action) => {
    snap.current = reducer(snap.current, a)
    dispatch(a)
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
        if (last) {
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
        }
      })
    },
    [apply],
  )

  const start = useCallback(() => {
    runner.current?.cancel()
    const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
    meta.current = { when, caseFile, goal, weights }
    setDate(when)
    setOpenedId(null)
    snap.current = initial
    apply({ type: 'begin' })
    runStage('analysis')
  }, [apply, runStage, caseFile, goal, weights])

  const advance = useCallback(() => {
    const next = nextStage(snap.current)
    if (next) runStage(next)
  }, [runStage])

  const skip = useCallback(() => runner.current?.skip(), [])

  const reset = useCallback(() => {
    runner.current?.cancel()
    runner.current = null
    snap.current = initial
    dispatch({ type: 'reset' })
    setOpenedId(null)
  }, [])

  const open = useCallback((run: CompletedRun) => {
    runner.current?.cancel()
    runner.current = null
    snap.current = run.snapshot
    dispatch({ type: 'load', state: run.snapshot })
    setCaseFile(run.caseFile)
    setGoal(run.goal)
    setWeights(run.weights)
    setDate(run.date)
    setOpenedId(run.id)
  }, [])

  return (
    <Ctx.Provider
      value={{ state, caseFile, setCaseFile, goal, setGoal, weights, setWeights, date, runs, start, advance, skip, reset, open, openedId }}
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
