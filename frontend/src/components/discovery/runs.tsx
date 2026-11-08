import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SAMPLE_PATIENT, rank, CANDIDATES } from '@/lib/pipeline'
import { useRun } from '@/lib/run-store'
import { useGo } from './pieces'

/** Saved runs as paper previews (Callio Labs' Projects panel, for reports). */
export default function Runs({ onNewRun }: { onNewRun: () => void }) {
  const { runs, open, openedId, state } = useRun()
  const go = useGo()

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-4 rounded-xl bg-card px-5 pt-5 pb-4 ring-1 ring-border backdrop-blur-md">
        <p className="eyebrow">Library / Runs & reports</p>
        <h2 className="font-brand mt-3 text-[clamp(2.25rem,3.6vw,3.25rem)] leading-none">Every run, with its evidence.</h2>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-xl bg-card p-8 ring-1 ring-border backdrop-blur-md">
          <p className="text-muted-foreground">No runs yet in this session.</p>
          <Button className="mt-4" onClick={onNewRun}>Start a discovery run</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {runs.map((r) => {
            const top = rank(CANDIDATES, r.weights)[0]
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  open(r)
                  go('report')
                }}
                className="group overflow-hidden rounded-xl bg-card text-left ring-1 ring-border backdrop-blur-md transition-transform duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98]"
              >
                <div className="relative mx-3 mt-3 h-36 overflow-hidden rounded-t-md bg-white shadow-[0_-4px_12px_rgb(0_0_0/0.06)]">
                  <div className="absolute top-0 right-0 size-5" style={{ background: 'linear-gradient(225deg, #e7e2d8 50%, #f6f3ed 50%)' }} />
                  <p className="px-3 pt-3 text-[11px] leading-snug font-semibold text-foreground/80">
                    Alternative therapeutic candidates for {SAMPLE_PATIENT.label}
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5 px-3">
                    {[90, 70, 82, 55, 75].map((w, i) => (
                      <div key={i} className="h-1 rounded-full bg-foreground/[0.07]" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                </div>
                <div className="border-t px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="size-3.5 text-muted-foreground" aria-hidden /> Top: {top.drug}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{r.caseName ?? 'Sample case'} · {r.date}</p>
                  {r.id === openedId && state.phase === 'done' ? <p className="mt-1 text-[0.6875rem] text-[#a35b1d]">Open in workspace</p> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
