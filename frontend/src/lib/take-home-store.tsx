import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { createInvite, importTestReport, inviteReport, type SavedReport } from './reports-db'
import { useRun } from './run-store'
import { AGENT_URL } from './agent-api'
import { TEST_URL, parsePayload, score, testId, type TestResult } from './take-home'

/**
 * The take-home test link and its results. Opening or copying the link creates a one-time
 * invite in Supabase; the test app saves its results straight to Supabase with that code
 * (no Addo Labs tab needs to stay open), and this provider watches for the report it produced.
 * Mounted once, inside RunProvider (Home.tsx).
 */

export type TakeHomeStatus = 'idle' | 'creating' | 'waiting' | 'saved' | 'off' | 'error'
export type Received = { id: string; name: string; completedAt: string; results: TestResult[] }

type Store = {
  status: TakeHomeStatus
  message: string | null
  /** The current test link, once created (it carries a one-time code). */
  link: string | null
  last: Received | null
  /** Open the test in a new window with a fresh one-time link. */
  openTest: () => Promise<void>
  /** Copy a fresh one-time link, e.g. to send a patient as a take-home assignment. */
  copyLink: () => Promise<void>
  /** The fallback: import the results file the test offers when it was opened without a link. */
  importFile: (file: File) => Promise<void>
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** The results are kept as JSON; the score is computed whenever they're shown. */
export function receivedFrom(row: SavedReport): Received | null {
  const payload = parsePayload(row.report)
  if (!payload) return null
  return { id: row.assess_run_id, name: row.patient?.name ?? 'Participant', completedAt: payload.completedAt, results: score(payload) }
}

const Ctx = createContext<Store | null>(null)

export function TakeHomeProvider({ children }: { children: ReactNode }) {
  const { caseFile } = useRun()
  const { user, configured } = useAuth()
  const [status, setStatus] = useState<TakeHomeStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [last, setLast] = useState<Received | null>(null)
  const opened = useRef<Window | null>(null)

  // Whose results these are: the uploaded case's patient, else the signed-in user.
  const meta = user?.user_metadata ?? {}
  const name = caseFile?.patient.label || meta.full_name || meta.name || user?.email || 'Participant'

  /** A fresh link: a new invite every time, since each code works once. */
  const freshLink = useCallback(async () => {
    if (!configured || !user || !SUPABASE_URL || !SUPABASE_KEY) {
      setStatus('off')
      setMessage('Sign in so the test can save its results to your account.')
      return null
    }
    setStatus('creating')
    setMessage(null)
    const c = await createInvite(name)
    if (!c) {
      setStatus('error')
      setMessage('Couldn’t create a test link. Try again in a moment.')
      return null
    }
    // In the fragment, which browsers never send to the server. backend: who scores facial + speech.
    const url = `${TEST_URL}#${new URLSearchParams({ code: c, api: SUPABASE_URL, key: SUPABASE_KEY, backend: new URL(AGENT_URL).origin })}`
    setCode(c)
    setLink(url)
    setStatus('waiting')
    return url
  }, [configured, user, name])

  const openTest = useCallback(async () => {
    // Open the window synchronously (popup blockers), then point it at the link once it exists.
    const w = window.open('about:blank', 'addo-take-home')
    opened.current = w
    const url = await freshLink()
    if (w && !w.closed) w.location.href = url ?? TEST_URL // signed out: the test still runs, results download only
  }, [freshLink])

  const copyLink = useCallback(async () => {
    const url = await freshLink()
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Link copied. It works once and expires in 7 days.')
    } catch {
      setMessage('Couldn’t copy automatically; copy the link shown below.')
    }
  }, [freshLink])

  // Watch for the report the current link produces. The test saves it straight to Supabase.
  useEffect(() => {
    if (status !== 'waiting' || !code) return
    let alive = true
    const check = async () => {
      const row = await inviteReport(code)
      if (!alive || !row) return
      setLast(receivedFrom(row))
      setStatus('saved')
      setMessage(null)
    }
    void check()
    const t = setInterval(check, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [status, code])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const payload = parsePayload(JSON.parse(await file.text()))
        if (!payload) throw new Error('not a results file')
        const id = testId(payload.completedAt)
        setLast({ id, name, completedAt: payload.completedAt, results: score(payload) })
        const saved = await importTestReport(id, name, payload, payload.completedAt)
        setStatus(saved.status)
        setMessage(saved.status === 'error' ? saved.message : saved.status === 'off' ? 'Imported, but not saved: sign in to keep it.' : null)
      } catch {
        setStatus('error')
        setMessage('Couldn’t read that file. Choose the results file the test offered at the end.')
      }
    },
    [name],
  )

  return <Ctx.Provider value={{ status, message, link, last, openTest, copyLink, importFile }}>{children}</Ctx.Provider>
}

export function useTakeHome() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTakeHome must be used inside <TakeHomeProvider>')
  return ctx
}
