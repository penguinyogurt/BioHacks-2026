import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { askReport, type ChatAnswer, type ChatTurn } from '@/lib/agent-api'
import type { AgentStep } from '@/lib/pipeline'
import { StepRow } from './pieces'

/**
 * Follow-up questions about one finished drug assessment, answered by the agent that ranked the
 * drugs (backend/agent/chat.py). It has the patient record and the report in view and can search
 * PubMed and the web; each answer shows its thinking and tool calls as they happen, above the reply.
 */

type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; steps: AgentStep[]; answer?: ChatAnswer; error?: string }

const STARTERS = ['Why did the top candidate rank first?', 'Which candidates interact with the current medication?', 'What would an MRgFUS delivery study need to show?']

/** The agent answers in light Markdown: paragraphs, "- " bullets and **bold**. Nothing else is rendered. */
function bold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-medium">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length} className="list-disc space-y-1 pl-5">{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^[-*•] /.test(t)) bullets.push(t.slice(2))
    else {
      flush()
      if (t) blocks.push(<p key={blocks.length}>{bold(t.replace(/^#+\s*/, ''))}</p>)
    }
  }
  flush()
  return <div className="space-y-2 text-sm leading-relaxed text-pretty">{blocks}</div>
}

function AssistantTurn({ turn, working }: { turn: Extract<Turn, { role: 'assistant' }>; working: boolean }) {
  const last = turn.steps[turn.steps.length - 1]
  return (
    <div className="space-y-2">
      {turn.steps.length ? (
        <div className="rounded-lg ring-1 ring-border">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
            {turn.steps.length} step{turn.steps.length === 1 ? '' : 's'} · thinking and tool calls
          </p>
          {turn.steps.map((step, i) => <StepRow key={i} item={{ stage: 'research', step }} />)}
        </div>
      ) : null}
      {working ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span className="truncate">{last ? last.label : 'Reading the report and the patient record…'}</span>
        </p>
      ) : null}
      {turn.error ? <p role="alert" className="text-sm text-destructive">{turn.error}</p> : null}
      {turn.answer ? (
        <>
          <Answer text={turn.answer.answer} />
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

  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [turns])

  /** Replace the assistant turn being written (always the last one). */
  const update = (fn: (t: Extract<Turn, { role: 'assistant' }>) => Extract<Turn, { role: 'assistant' }>) =>
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
    setTurns((ts) => [...ts, { role: 'user', content: q }, { role: 'assistant', steps: [] }])
    setDraft('')
    setBusy(true)
    const ctl = (abort.current = new AbortController())
    try {
      const answer = await askReport(runId, history, (step) => update((t) => ({ ...t, steps: [...t.steps, step] })), ctl.signal)
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
          The agent that ranked these drugs answers with the patient record and the report in view. It can search PubMed and the web;
          queries leave with patient identifiers removed. Research aid, not medical advice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div ref={list} className="max-h-[36rem] space-y-4 overflow-y-auto" aria-live="polite">
          {turns.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Button key={s} type="button" size="sm" variant="outline" className="font-normal" onClick={() => ask(s)}>
                  {s}
                </Button>
              ))}
            </div>
          ) : (
            turns.map((t, i) =>
              t.role === 'user' ? (
                <p key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-pretty">{t.content}</p>
              ) : (
                <AssistantTurn key={i} turn={t} working={busy && i === turns.length - 1} />
              ),
            )
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
