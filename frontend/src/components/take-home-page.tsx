import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Link2, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import { useGo } from '@/components/discovery/pieces'
import { AGENT_URL } from '@/lib/agent-api'
import { useTakeHome } from '@/lib/take-home-store'

const TESTS = [
  { name: 'Facial expressions', detail: 'Follow four expression prompts while the camera takes a photo of each.' },
  { name: 'Passage reading', detail: 'Read three short passages aloud. The microphone records which words were recognised.' },
  { name: 'Line tracing', detail: 'Trace five shapes with a mouse or trackpad, from the green dot to the blue dot.' },
]

type Scoring = { facial: boolean; speech: boolean } | 'down' | null

/**
 * Can the backend score the facial and speech tests? The pages themselves are this app's
 * /take-home/ route; only those two need the backend (/api/diagnostics). Line tracing never does.
 */
function useScoring(): Scoring {
  const [s, setS] = useState<Scoring>(null)
  useEffect(() => {
    let alive = true
    const check = () =>
      fetch(`${AGENT_URL}/api/diagnostics/health`, { signal: AbortSignal.timeout(15000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((h) => alive && setS({ facial: !!h.facial, speech: !!h.speech }))
        .catch(() => alive && setS('down'))
    void check()
    const t = setInterval(check, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return s
}

export default function TakeHomePage() {
  const { status, message, link, last, openTest, copyLink, importFile } = useTakeHome()
  const go = useGo()
  const scoring = useScoring()
  const file = useRef<HTMLInputElement>(null)

  const statusText =
    message ??
    {
      idle: null,
      creating: 'Creating your test link…',
      waiting: 'Waiting for results. The test saves them to your account when all three tasks are done; this page updates by itself.',
      saved: 'Saved to Reports, under Test results.',
      off: 'Sign in so the test can save its results.',
      error: 'Something went wrong. Try again.',
    }[status]

  return (
    <div className="mx-auto max-w-[960px] space-y-3 text-sm">
      <PageHeader
        eyebrow="Library / Take-home test"
        title="Take-home test"
        description="Three short tasks to complete at home. The test saves its results to your account, and they appear under Reports."
      />

      <Card className="gap-4 [--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle className="text-lg font-normal">What the test covers</CardTitle>
          <CardDescription>About ten minutes. It uses your camera and microphone; nothing is recorded until you start each task.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-2">
            {TESTS.map((t, i) => (
              <li key={t.name} className="flex gap-3">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
                <span>
                  <span className="font-medium">{t.name}.</span> <span className="text-muted-foreground">{t.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void openTest()}>
              <ExternalLink aria-hidden /> Open the take-home test
            </Button>
            <Button variant="outline" onClick={() => void copyLink()}>
              <Link2 aria-hidden /> Copy test link
            </Button>
            <span className="text-xs text-muted-foreground" role="status">
              {scoring === null
                ? 'Checking the scoring server…'
                : scoring === 'down'
                  ? 'Scoring server unreachable: line tracing still works'
                  : scoring.facial && scoring.speech
                    ? '✓ All three tests can be scored'
                    : `Scoring unavailable for ${[!scoring.facial && 'facial', !scoring.speech && 'speech'].filter(Boolean).join(' and ')}`}
            </span>
          </div>
          {scoring !== null && (scoring === 'down' || !scoring.facial || !scoring.speech) ? (
            <p className="text-xs text-muted-foreground">
              Facial and speech scoring run on the agent backend ({new URL(AGENT_URL).host}). On that server, run the facial and speech tests’{' '}
              <code className="rounded bg-muted px-1 py-0.5">setup.sh</code> into its venv; see <code className="rounded bg-muted px-1 py-0.5">docs/DEPLOY.md</code>.
            </p>
          ) : null}
          {statusText ? (
            <p role="status" className={status === 'error' ? 'text-destructive' : status === 'saved' ? '' : 'text-muted-foreground'}>
              {status === 'creating' || status === 'waiting' ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" aria-hidden /> : null}
              {status === 'saved' ? <Check className="mr-1.5 inline size-3.5" aria-hidden /> : null}
              {statusText}
            </p>
          ) : null}
          {link && status === 'waiting' ? (
            <p className="text-xs text-muted-foreground">
              Test link (works once, expires in 7 days; opens on any device):{' '}
              <span className="break-all select-all text-foreground">{link}</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {last ? (
        <Card className="gap-3 [--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle className="text-lg font-normal">Latest results</CardTitle>
            <CardDescription className="tabular-nums">
              {last.name} · {new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(last.completedAt))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                  <TableHead className="text-right">Passed</TableHead>
                  <TableHead className="text-right">Pass rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {last.results.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    {r.completed ? (
                      <>
                        <TableCell className="text-right tabular-nums">{(r.accuracy ?? 0).toFixed(1)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{r.passed} of {r.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.total ? ((100 * r.passed) / r.total).toFixed(0) : 0}%</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={3} className="text-right text-muted-foreground">Not completed</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              {last.results.map((r) => r.rule).join(' ')} Screening aid, not a diagnosis.
            </p>
            {status === 'saved' ? (
              <Button variant="outline" size="sm" onClick={() => go('runs')}>
                View in Reports
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-2 [--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground">Closed this page during the test? Import the results file it offered at the end.</p>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            <Upload aria-hidden /> Import results file
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
