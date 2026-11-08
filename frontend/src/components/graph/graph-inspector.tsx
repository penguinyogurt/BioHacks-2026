import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import type { DrkgData } from '@/components/discovery/drkg-data'
import { cn } from '@/lib/utils'
import { edgeNbr, edgeOut, edgeRel, externalUrl, relCount, relIdx, type EntityGraph, type GraphIndex } from './graph-data'
import { TypeGlyph } from '@/components/discovery/drkg-legend'
import { typeHex } from './graph-canvas'

const fmt = (n: number) => n.toLocaleString('en-US')
const REL_PREVIEW = 8

export type Suggestion = { row: number; label: string; note: string }

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A clickable entity row: glyph + label + detail + number. Every row walks the graph. */
function EntityRow({ row, data, label, detail, value, onClick }: { row: number; data: DrkgData; label: string; detail: React.ReactNode; value: React.ReactNode; onClick: () => void }) {
  const t = data.types[row]
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="grid w-full grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-transform duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
      >
        <TypeGlyph type={data.scene.types[t]?.name ?? ''} color={typeHex(t)} size={11} />
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
      </button>
    </li>
  )
}

export function GraphInspector({
  row,
  data,
  index,
  ids,
  entity,
  graphMissing,
  labelOf,
  relFilter,
  onRelFilter,
  showKnn,
  onShowKnn,
  onNavigate,
  suggestions,
}: {
  row: number | null
  data: DrkgData
  index: GraphIndex | null
  ids: string[] | null
  entity: EntityGraph | null
  graphMissing: boolean
  labelOf: (row: number) => string
  relFilter: number | null
  onRelFilter: (rel: number | null) => void
  showKnn: boolean
  onShowKnn: (on: boolean) => void
  onNavigate: (row: number) => void
  suggestions: Suggestion[]
}) {
  const [copied, setCopied] = useState(false)
  // the clicked row is replaced by the next entity's rows, so keyboard focus moves to the new title
  const title = useRef<HTMLHeadingElement>(null)
  const refocus = useRef(false)
  const walk = (r: number) => {
    refocus.current = true
    onNavigate(r)
  }
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    title.current?.focus({ preventScroll: true })
  }, [row])
  const [allRels, setAllRels] = useState(false)

  const rels = useMemo(() => (entity ? Array.from(entity.relCounts, (e) => ({ rel: relIdx(e), count: relCount(e) })) : []), [entity])
  const nbrs = useMemo(() => {
    if (!entity) return []
    const out: { nbr: number; rel: number; out: boolean }[] = []
    for (const e of entity.edges) if (relFilter === null || edgeRel(e) === relFilter) out.push({ nbr: edgeNbr(e), rel: edgeRel(e), out: edgeOut(e) })
    const deg = data.degree
    if (deg) out.sort((a, b) => deg[b.nbr] - deg[a.nbr])
    return out
  }, [entity, relFilter, data.degree])

  if (row === null)
    return (
      <div className="flex h-full flex-col justify-center px-6 py-8">
        <p className="eyebrow">Start anywhere</p>
        <h2 className="mt-3 text-2xl font-medium text-balance">Every gene, drug and disease DRKG knows, in one map.</h2>
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          Search above, click any point, or start from one of these. Each entity opens its relations, its graph neighbours and its nearest neighbours in the
          400-d embedding.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <li key={s.row}>
              <button
                type="button"
                onClick={() => walk(s.row)}
                className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm shadow-xs ring-1 ring-border transition-transform duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
              >
                <TypeGlyph type={data.scene.types[data.types[s.row]]?.name ?? ''} color={typeHex(data.types[s.row])} size={10} />
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.note}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-muted-foreground">
          <kbd className="rounded border border-border bg-background px-1">/</kbd> search · <kbd className="rounded border border-border bg-background px-1">Alt</kbd>+
          <kbd className="rounded border border-border bg-background px-1">←</kbd>/<kbd className="rounded border border-border bg-background px-1">→</kbd> history ·{' '}
          <kbd className="rounded border border-border bg-background px-1">Esc</kbd> clear
        </p>
      </div>
    )

  const typeIdx = data.types[row]
  const type = data.scene.types[typeIdx]?.name ?? 'Entity'
  const id = ids?.[row] ?? null
  const cluster = data.clusters && data.scene.clusters ? data.scene.clusters[data.clusters[row]] : null
  const degree = data.degree?.[row] ?? null
  const url = id && index ? externalUrl(id, index.externalUrl) : null
  const R = index?.relations
  const relName = (r: number) => R?.[r]?.label || R?.[r]?.name || `relation ${r}`
  const maxCount = rels[0]?.count ?? 1
  const shownRels = allRels ? rels : rels.slice(0, REL_PREVIEW)
  const fullCount = relFilter === null ? (degree ?? 0) : (rels.find((r) => r.rel === relFilter)?.count ?? 0)

  return (
    <div className="pb-6">
      <header className="px-5 pt-5 pb-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TypeGlyph type={type} color={typeHex(typeIdx)} size={11} />
          {type}
          {cluster ? <span className="truncate">· island {cluster.label}</span> : null}
        </p>
        <h2 ref={title} tabIndex={-1} className="mt-2 text-xl leading-tight font-medium text-balance break-words outline-none">{labelOf(row) || `Entity ${row}`}</h2>
        {id ? (
          <div className="mt-2 flex items-center gap-1">
            <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{id}</code>
            <button
              type="button"
              aria-label={copied ? 'Copied' : 'Copy id'}
              onClick={() => {
                navigator.clipboard?.writeText(id).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                }, () => {})
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-background/60 px-3 py-2 ring-1 ring-border">
            <dt className="text-xs text-muted-foreground">Triples touching it</dt>
            <dd className="text-lg font-medium tabular-nums">{degree !== null ? fmt(degree) : '—'}</dd>
          </div>
          <div className="rounded-lg bg-background/60 px-3 py-2 ring-1 ring-border">
            <dt className="text-xs text-muted-foreground">Relation types</dt>
            <dd className="text-lg font-medium tabular-nums">{entity ? rels.length : '—'}</dd>
          </div>
        </dl>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Open source record <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </header>

      {graphMissing ? (
        <Section title="Neighbours">
          <p className="text-sm text-pretty text-muted-foreground">
            Neighbour data isn’t built for this entity yet. Run <code className="font-mono text-xs text-foreground">python frontend/scripts/drkg_graph.py</code> to write{' '}
            <code className="font-mono text-xs">frontend/public/drkg/graph/</code>, then reload.
          </p>
        </Section>
      ) : !entity ? (
        <Section title="Relations">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading neighbours…
          </p>
        </Section>
      ) : (
        <>
          <Section
            title="Relations"
            aside={
              relFilter !== null ? (
                <button type="button" onClick={() => onRelFilter(null)} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Show all
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">click to filter</span>
              )
            }
          >
            <ul className="space-y-0.5">
              {shownRels.map(({ rel, count }) => {
                const on = relFilter === rel
                return (
                  <li key={rel}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onRelFilter(on ? null : rel)}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        on && 'bg-accent ring-1 ring-foreground/20',
                        relFilter !== null && !on && 'opacity-55',
                      )}
                    >
                      <span className="flex items-baseline gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {relName(rel)}{' '}
                          <span className="text-xs text-muted-foreground">
                            · {R?.[rel]?.source} · {R?.[rel]?.head}–{R?.[rel]?.tail}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums">{fmt(count)}</span>
                      </span>
                      <span className="mt-1 block h-1 rounded-full bg-foreground/[0.07]">
                        <span className="block h-full rounded-full bg-foreground/45" style={{ width: `${Math.max(2, (count / maxCount) * 100)}%` }} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {rels.length > REL_PREVIEW ? (
              <button type="button" onClick={() => setAllRels((a) => !a)} className="mt-2 px-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                {allRels ? 'Show fewer' : `Show all ${rels.length} relations`}
              </button>
            ) : null}
          </Section>

          <Section
            title={relFilter === null ? 'Graph neighbours' : `Via ${relName(relFilter)}`}
            aside={
              <span className="text-xs text-muted-foreground tabular-nums">
                showing {fmt(nbrs.length)} of {fmt(fullCount)}
              </span>
            }
          >
            {nbrs.length ? (
              <ul>
                {nbrs.map((n, i) => (
                  <EntityRow
                    key={`${n.nbr}-${n.rel}-${n.out}-${i}`}
                    row={n.nbr}
                    data={data}
                    label={labelOf(n.nbr) || `Entity ${n.nbr}`}
                    detail={
                      <span className="inline-flex items-center gap-1">
                        {n.out ? <ArrowRight className="size-3" aria-label="outgoing" /> : <ArrowLeft className="size-3" aria-label="incoming" />}
                        {data.scene.types[data.types[n.nbr]]?.name} · {relName(n.rel)} · {R?.[n.rel]?.source}
                      </span>
                    }
                    value={data.degree ? fmt(data.degree[n.nbr]) : null}
                    onClick={() => walk(n.nbr)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No stored neighbours for this relation.</p>
            )}
            {index && fullCount > nbrs.length ? (
              <p className="mt-2 px-2 text-xs text-pretty text-muted-foreground">
                The browser copy keeps up to {fmt(index.edgeCap)} edges per entity, spread across its relations; the counts above are the full graph.
              </p>
            ) : null}
          </Section>

          <Section
            title="Embedding neighbours"
            aside={
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Draw
                <Switch size="sm" checked={showKnn} onCheckedChange={onShowKnn} aria-label="Draw embedding neighbours as dashed lines" />
              </label>
            }
          >
            <p className="mb-2 px-2 text-xs text-muted-foreground">Nearest {type.toLowerCase()} entities by true 400-d TransE L2.</p>
            <ul>
              {Array.from(entity.knnRows, (r, i) => (
                <EntityRow
                  key={r}
                  row={r}
                  data={data}
                  label={labelOf(r) || `Entity ${r}`}
                  detail={ids?.[r] ?? type}
                  value={entity.knnDist[i].toFixed(2)}
                  onClick={() => walk(r)}
                />
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
