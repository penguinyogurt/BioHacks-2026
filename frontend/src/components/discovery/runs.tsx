import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/lib/auth'
import { reportFilename } from '@/lib/agent-api'
import { SAMPLE_PATIENT, rank, CANDIDATES } from '@/lib/pipeline'
import { buildReportPdf } from '@/lib/report-pdf'
import { listReports, pdfLink, type SavedReport } from '@/lib/reports-db'
import { useRun, type CompletedRun } from '@/lib/run-store'

const SERIF = '"Times New Roman", Times, serif'

/** Same rule as the PDF's title (backend/agent/report_pdf.py `_title`), from "Limb onset, ALSFRS-R 39/48". */
function paperTitle(headline = '') {
  const onset = headline.split(',')[0].trim().toLowerCase()
  const site = onset.endsWith('onset') ? `${onset.replace(' onset', '-onset')} ` : ''
  return `Patient-specific drug repurposing candidates for ${site}amyotrophic lateral sclerosis: a multi-agent knowledge-graph and literature analysis`
}

const longDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(d)
const shortDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(d)

/**
 * The report's first page in miniature, laid out like the PDF (report_pdf.py): label, serif
 * title, author, meta line, rule, Abstract, keywords, rule, "1. Introduction".
 */
function PaperThumb({ title, meta, abstract }: { title: string; meta: string; abstract: string }) {
  return (
    <div aria-hidden className="relative mx-3 mt-3 h-52 overflow-hidden rounded-t-md bg-white px-4 pt-3 text-[#1f1f1f] shadow-[0_-4px_12px_rgb(0_0_0/0.06)]" style={{ fontFamily: SERIF }}>
      <p className="text-center text-[5px] font-bold tracking-wide text-[#6b6b6b]">RESEARCH REPORT · PATIENT-SPECIFIC ANALYSIS</p>
      <p className="mt-1 line-clamp-3 text-center text-[8.5px] leading-[1.25] font-bold">{title}</p>
      <p className="mt-1 text-center text-[6.5px]">Addo Labs</p>
      <p className="truncate text-center text-[5px] text-[#6b6b6b] italic">{meta}</p>
      <div className="mt-1.5 border-t border-[#c8c8c8]" />
      <p className="mt-1 text-[6.5px] font-bold">Abstract</p>
      <p className="line-clamp-6 text-justify text-[5.5px] leading-[1.35] hyphens-auto">{abstract}</p>
      <p className="mt-0.5 truncate text-[5px]"><span className="font-bold">Keywords:</span> amyotrophic lateral sclerosis; drug repurposing; knowledge graph; DRKG; focused ultrasound</p>
      <div className="mt-1 border-t border-[#c8c8c8]" />
      <p className="mt-1 text-[6.5px] font-bold">1. Introduction</p>
      <div className="mt-0.5 space-y-[3px]">
        {[100, 96, 99, 70].map((w, i) => (
          <div key={i} className="h-[2.5px] rounded-full bg-[#1f1f1f]/[0.12]" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white" />
    </div>
  )
}

/** Where a card's PDF comes from. Only an unsaved live run still depends on the agent backend. */
type Source =
  | { kind: 'saved'; path: string } // Supabase storage: permanent
  | { kind: 'built'; run: CompletedRun } // simulated run: rebuilt in the browser
  | { kind: 'backend'; url: string } // live run from a signed-out session: only while that backend has it

type Card = {
  key: string
  title: string
  meta: string
  abstract: string
  /** What the card says under the preview: the PDF's file name and when the report was created. */
  filename: string
  created: string
  simulated: boolean
  source: Source | null
}

/** A report PDF in the app's own viewer (the browser's PDF renderer in a panel), with a named download. */
function PdfViewer({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUrl(null)
    setError(null)
    const src = card?.source
    if (!src) return
    let alive = true
    let blob: string | null = null
    const load = async (): Promise<string | null> => {
      if (src.kind === 'saved') return pdfLink(src.path)
      if (src.kind === 'built') {
        const patient = src.run.caseFile?.patient ?? SAMPLE_PATIENT
        return (blob = buildReportPdf({ patient, weights: src.run.weights, date: src.run.date, caseName: src.run.caseName }))
      }
      const r = await fetch(src.url)
      if (!r.ok) throw new Error(String(r.status))
      return (blob = URL.createObjectURL(new Blob([await r.blob()], { type: 'application/pdf' })))
    }
    load()
      .then((u) => {
        if (!alive) return
        if (u) setUrl(u)
        else setError('This PDF isn’t available.')
      })
      .catch(() => {
        if (!alive) return
        setError(
          src.kind === 'backend'
            ? 'This report was never saved (you weren’t signed in), and the agent backend that made it no longer has it.'
            : 'Couldn’t load this PDF. Try again in a moment.',
        )
      })
    return () => {
      alive = false
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [card])

  async function download() {
    if (!card?.source || !url) return
    if (card.source.kind === 'saved') {
      // A signed link that saves under the patient file name, not the storage path.
      const link = await pdfLink(card.source.path, card.filename)
      if (link) window.location.assign(link)
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = card.filename
    a.click()
  }

  return (
    <Sheet open={!!card} onOpenChange={(open) => !open && onClose()}>
      {/* Paper and ink like the app's own top bar (Home.tsx header), not the lighter popover cream. */}
      <SheetContent side="right" className="w-full gap-0 bg-background p-0 data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="flex-row items-center gap-3 border-b border-border bg-background/60 pr-12 backdrop-blur-md">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{card?.filename}</SheetTitle>
            <SheetDescription className="tabular-nums">
              {card?.created}
              {card?.simulated ? ' · Simulated' : ''}
            </SheetDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!url} onClick={download}>
            <Download aria-hidden /> Download
          </Button>
        </SheetHeader>
        <div className="min-h-0 flex-1 bg-muted/40">
          {url ? (
            <iframe src={`${url}#view=FitH`} title={card?.filename ?? 'Report PDF'} className="block h-full w-full bg-white" />
          ) : error ? (
            <p role="alert" className="p-6 text-sm text-destructive">{error}</p>
          ) : (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the PDF…
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Reports: live runs saved to Supabase (any machine, signed in) plus this session's other runs. */
export default function Runs({ onNewRun }: { onNewRun: () => void }) {
  const { runs, reportSave } = useRun()
  const { user, configured } = useAuth()
  const signedIn = configured && !!user
  const [saved, setSaved] = useState<SavedReport[] | null>(null)
  const [viewing, setViewing] = useState<Card | null>(null)

  // Refetch once a new report has been saved, so it shows without a reload.
  useEffect(() => {
    if (!signedIn) return setSaved([])
    let alive = true
    listReports().then((r) => alive && setSaved(r))
    return () => {
      alive = false
    }
  }, [signedIn, user?.id, reportSave.status])

  const savedCards: Card[] = (saved ?? []).map((r) => {
    const created = new Date(r.created_at)
    const name = r.patient?.name ?? r.patient_id ?? 'patient'
    return {
      key: r.id,
      title: paperTitle(r.patient?.headline),
      meta: `Addo Labs, ALS drug-repurposing pipeline · Report ${r.assess_run_id} · ${longDate(created)}`,
      abstract: r.summary ?? '',
      filename: reportFilename(name, r.patient_id ?? ''),
      created: shortDate(created),
      simulated: false,
      source: r.pdf_path ? { kind: 'saved', path: r.pdf_path } : null,
    }
  })

  // Signed in, live runs are already listed from Supabase; only simulated ones are session-only.
  const sessionCards: Card[] = runs
    .filter((r) => !signedIn || r.snapshot.source !== 'live')
    .map((r: CompletedRun): Card => {
      const patient = r.caseFile?.patient ?? SAMPLE_PATIENT
      const live = r.snapshot.source === 'live'
      const top = rank(CANDIDATES, r.weights)[0]
      return {
        key: r.id,
        title: paperTitle(patient.onset),
        meta: `Addo Labs, ALS drug-repurposing pipeline · ${r.date}`,
        abstract: live ? '' : `${top.rationale} ${top.evidence}`,
        filename: reportFilename(patient.label, live ? (r.snapshot.patientId ?? patient.id) : patient.id),
        created: r.date,
        simulated: !live,
        source: live ? (r.snapshot.reportPdf ? { kind: 'backend', url: r.snapshot.reportPdf } : null) : { kind: 'built', run: r },
      }
    })

  const cards = [...savedCards, ...sessionCards]

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        className="mb-3"
        eyebrow="Library / Reports"
        title="Reports"
        description={
          signedIn
            ? 'Drug repurposing reports from completed pipeline runs, saved to your account.'
            : 'Drug repurposing reports from this session. Sign in to keep them across sessions and devices.'
        }
      />
      {signedIn && saved === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading reports…
        </p>
      ) : cards.length === 0 ? (
        <div className="rounded-xl bg-card p-8 ring-1 ring-border backdrop-blur-md">
          <p className="text-muted-foreground">No reports yet.</p>
          <Button className="mt-4" onClick={onNewRun}>Start a discovery run</Button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {cards.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                disabled={!c.source}
                onClick={() => setViewing(c)}
                aria-label={`View ${c.filename}`}
                className="group block w-full overflow-hidden rounded-xl bg-card text-left ring-1 ring-border backdrop-blur-md transition-transform duration-200 ease-out outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <PaperThumb title={c.title} meta={c.meta} abstract={c.abstract} />
                <div className="border-t px-3 py-2.5">
                  <p className="truncate text-sm font-medium" title={c.filename}>{c.filename}</p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums">
                    {c.created}
                    {c.simulated ? ' · Simulated' : ''}
                    {c.source ? '' : ' · PDF unavailable'}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PdfViewer card={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
