import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp, ChevronRight, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { askReport, type ChatAnswer, type ChatTurn } from '@/lib/agent-api'
import { loadChat, saveChat } from '@/lib/reports-db'
import type { AgentStep } from '@/lib/pipeline'
import { StepRow } from './pieces'

/**
 * Follow-up questions about one finished drug assessment, answered by the orchestrator agent (the one that ranked the
 * drugs; backend/agent/chat.py). It has the patient record and the report in view and can search
 * PubMed and the web; each answer shows its thinking and tool calls as they happen, above the reply.
 *
 * Layout is fixed-size on purpose: the conversation area has one height from the empty state on,
 * with its scrollbar gutter reserved, so streaming steps scroll inside it instead of resizing it.
 */

type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; steps: AgentStep[]; draft: string; answer?: ChatAnswer; error?: string }
type AssistantTurnT = Extract<Turn, { role: 'assistant' }>

const STARTERS = ['Why did the top candidate rank first?', 'Which candidates interact with the current medication?', 'What would an MRgFUS delivery study need to show?']

/** Markdown elements styled to the app's type scale; no typography plugin in this project. */
const MD: Components = {
  p: ({ node: _, ...p }) => <p className="text-pretty" {...p} />,
  h1: ({ node: _, ...p }) => <h3 className="mt-3 font-medium text-balance" {...p} />,
  h2: ({ node: _, ...p }) => <h3 className="mt-3 font-medium text-balance" {...p} />,
  h3: ({ node: _, ...p }) => <h4 className="mt-2 font-medium text-balance" {...p} />,
  h4: ({ node: _, ...p }) => <h4 className="mt-2 font-medium text-balance" {...p} />,
  ul: ({ node: _, ...p }) => <ul className="list-disc space-y-1 pl-5" {...p} />,
  ol: ({ node: _, ...p }) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
  strong: ({ node: _, ...p }) => <strong className="font-medium" {...p} />,
  a: ({ node: _, ...p }) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  blockquote: ({ node: _, ...p }) => <blockquote className="border-l-2 pl-3 text-muted-foreground" {...p} />,
  code: ({ node: _, ...p }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
  pre: ({ node: _, ...p }) => <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0" {...p} />,
  hr: () => <hr className="border-border" />,
  table: ({ node: _, ...p }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs tabular-nums" {...p} />
    </div>
  ),
  th: ({ node: _, ...p }) => <th className="border-b px-2 py-1 text-left font-medium" {...p} />,
  td: ({ node: _, ...p }) => <td className="border-b border-border/60 px-2 py-1 align-top" {...p} />,
}

function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={MD} skipHtml>
        {text}
      </Markdown>
    </div>
  )
}

/** Tool calls and what they returned. The agent's thinking is streamed too, but not shown. */
function Steps({ steps, working }: { steps: AgentStep[]; working: boolean }) {
  const [open, setOpen] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (working) box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [steps.length, working])
  const calls = steps.filter((s) => s.type === 'tool_call').length
  if (!steps.length) return null
  return (
    <div className="rounded-lg ring-1 ring-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-foreground/[0.03]"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="tabular-nums">{calls}</span> tool call{calls === 1 ? '' : 's'}
      </button>
      {open ? (
        <div ref={box} className="max-h-56 overflow-y-auto border-t [scrollbar-gutter:stable]">
          {steps.map((step, i) => <StepRow key={i} item={{ stage: 'research', step }} />)}
        </div>
      ) : null}
    </div>
  )
}

/** While streaming, citations are raw markers; the final answer replaces them with checked, numbered ones. */
const draftText = (s: string) => s.replace(/\[PMID:\s*(\d+)\]/g, '[PMID $1]')

const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Paced reveal. After a tool call the API sends the whole answer in one burst (measured: ~100
 * chunks within 0.1 s), which reads as "appears at once". This shows the text that has arrived at
 * a steady rate: each frame reveals 1/24 of the backlog (minimum 10 characters), so a burst
 * catches up in ~0.5–1.5 s (300–4,000 chars), and genuinely streaming text keeps its pace. Never shows
 * text that hasn't arrived; when the text is replaced (a draft reset, or the final answer with
 * renumbered citations) it continues from the same length.
 */
function useReveal(text: string, instant: boolean) {
  // `instant`: an answer that was already finished when this mounted (a saved conversation) shows whole.
  const [n, setN] = useState(REDUCED || instant ? Infinity : 0)
  const target = useRef(text)
  target.current = text
  useEffect(() => {
    if (REDUCED) return
    if (n > text.length) return setN(text.length)
    if (n === text.length) return
    const id = requestAnimationFrame(() =>
      setN((k) => Math.min(target.current.length, k + Math.max(10, Math.ceil((target.current.length - k) / 24)))),
    )
    return () => cancelAnimationFrame(id)
  }, [n, text])
  return text.slice(0, n)
}

function AssistantTurn({ turn, working }: { turn: AssistantTurnT; working: boolean }) {
  const tools = turn.steps.filter((s) => s.type !== 'thinking')
  const last = tools[tools.length - 1]
  const status = turn.draft ? 'Writing the answer…' : last ? last.label : 'Reading the patient record and the report…'
  const [saved] = useState(!!turn.answer || !!turn.error)
  const shown = useReveal(turn.answer ? turn.answer.answer : draftText(turn.draft), saved)
  const revealed = !!turn.answer && shown.length === turn.answer.answer.length
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Orchestrator agent</span> · patient record, report and research tools
      </p>
      <Steps steps={tools} working={working} />
      {working ? (
        <p className="flex h-5 items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          <span className="truncate">{status}</span>
        </p>
      ) : null}
      {turn.error ? <p role="alert" className="text-sm text-destructive">{turn.error}</p> : null}
      {shown ? <Answer text={shown} /> : null}
      {turn.answer && revealed ? (
        <>
          {turn.answer.references.length ? (
            <ol className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              {turn.answer.references.map((r) => (
                <li key={r.n} className="flex gap-1.5">
                  <span className="tabular-nums">[{r.n}]</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{r.citation}</a>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function ResearchChat({ runId }: { runId: string }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => () => abort.current?.abort(), [])
  // Always keep the newest content in view: tool calls, the answer as it's revealed, its
  // references. Watching the content's size catches all of them, including the reveal, which
  // happens inside AssistantTurn without changing `turns`.
  useEffect(() => {
    const el = content.current
    if (!el) return
    const follow = new ResizeObserver(() => list.current?.scrollTo({ top: list.current.scrollHeight }))
    follow.observe(el)
    return () => follow.disconnect()
  }, [turns.length > 0])

  // The conversation is saved with its report in Supabase (lib/reports-db.ts): bring it back
  // on open, and save it whenever an answer finishes. Signed out, both are no-ops.
  const loaded = useRef(false)
  useEffect(() => {
    let alive = true
    loadChat<Turn>(runId).then((saved) => {
      if (!alive) return
      if (saved?.length) setTurns((ts) => (ts.length ? ts : saved))
      loaded.current = true
    })
    return () => {
      alive = false
    }
  }, [runId])
  useEffect(() => {
    if (!loaded.current || busy || !turns.length) return
    // Answered or failed exchanges only; a half-written answer isn't worth keeping.
    void saveChat(runId, turns.map((t) => (t.role === 'assistant' ? { ...t, draft: '' } : t)))
  }, [runId, turns, busy])

  /** Replace the assistant turn being written (always the last one). */
  const update = (fn: (t: AssistantTurnT) => AssistantTurnT) =>
    setTurns((ts) => {
      const last = ts[ts.length - 1]
      return last?.role === 'assistant' ? [...ts.slice(0, -1), fn(last)] : ts
    })

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    // Only answered exchanges go back as history; a failed or stopped one is left out.
    const history: ChatTurn[] = []
    turns.forEach((t, i) => {
      const next = turns[i + 1]
      if (t.role === 'user' && next?.role === 'assistant' && next.answer) history.push(t, { role: 'assistant', content: next.answer.answer })
    })
    history.push({ role: 'user', content: q })
    setTurns((ts) => [...ts, { role: 'user', content: q }, { role: 'assistant', steps: [], draft: '' }])
    setDraft('')
    setBusy(true)
    const ctl = (abort.current = new AbortController())
    try {
      const answer = await askReport(
        runId,
        history,
        {
          onStep: (step) => update((t) => ({ ...t, steps: [...t.steps, step] })),
          onDelta: (text) => update((t) => ({ ...t, draft: t.draft + text })),
          onReset: () => update((t) => ({ ...t, draft: '' })),
        },
        ctl.signal,
      )
      update((t) => ({ ...t, answer }))
    } catch (err) {
      const stopped = ctl.signal.aborted
      update((t) => ({ ...t, error: stopped ? 'Stopped.' : `The agent couldn't answer: ${err instanceof Error ? err.message : String(err)}` }))
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(draft)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      ask(draft)
    }
  }

  return (
    <Card className="gap-3 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="text-lg font-normal text-balance">Ask about this report</CardTitle>
        <CardDescription className="text-pretty">
          Answered by the orchestrator agent: the only agent that sees the full patient record. It has this report in context and calls
          PubMed and web search when the report doesn’t settle a question; its queries leave with patient identifiers removed.
          Research aid, not medical advice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={list}
          className="h-[32rem] overflow-y-auto rounded-lg bg-muted/30 p-3 ring-1 ring-border [scrollbar-gutter:stable]"
          aria-live="polite"
        >
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">Ask a follow-up question, or start with one of these:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} type="button" size="sm" variant="outline" className="font-normal" onClick={() => ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={content} className="space-y-4">
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <p key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap text-pretty ring-1 ring-border">{t.content}</p>
                ) : (
                  <AssistantTurn key={i} turn={t} working={busy && i === turns.length - 1} />
                ),
              )}
            </div>
          )}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor="report-chat" className="sr-only">Ask a follow-up question about the report</label>
          <Textarea
            id="report-chat"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask a follow-up question… (Enter to send, Shift+Enter for a new line)"
            className="max-h-40 min-h-10 resize-none"
            maxLength={8000}
          />
          {busy ? (
            <Button type="button" size="icon" variant="outline" aria-label="Stop the answer" onClick={() => abort.current?.abort()}>
              <Square aria-hidden />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send question" disabled={!draft.trim()}>
              <ArrowUp aria-hidden />
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
