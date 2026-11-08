import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { loadNames, useDrkg } from '@/components/discovery/drkg-data'
import { cn } from '@/lib/utils'
import { buildSearch, edgeNbr, edgeRel, loadEntity, loadIds, loadIndex, loadNamesExtra, type EntityGraph, type GraphIndex } from './graph-data'
import { TypeGlyph } from '@/components/discovery/drkg-legend'
import { GraphCanvas, typeHex, type ColorBy } from './graph-canvas'
import { GraphSearch } from './graph-search'
import { GraphInspector, type Suggestion } from './graph-inspector'

const fmt = (n: number) => n.toLocaleString('en-US')
const LABELLED_NEIGHBOURS = 8
const PER_TYPE = 2 // canvas labels per neighbour type, so a hub's genes and drugs aren't all crowded out by one anatomy island

const STARTS: { id: string; label: string; note: string }[] = [
  { id: 'Disease::MESH:D000690', label: 'ALS', note: 'disease' },
  { id: 'Compound::DB00740', label: 'Riluzole', note: 'approved' },
  { id: 'Compound::DB12243', label: 'Edaravone', note: 'approved' },
  { id: 'Gene::6647', label: 'SOD1', note: 'gene' },
  { id: 'Gene::23435', label: 'TARDBP', note: 'TDP-43' },
]

function useReducedMotion() {
  const [reduce, setReduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

/** The whole DRKG as a browsable map: search, select, walk edges, go back. */
export default function GraphExplorer() {
  const { data, error } = useDrkg()
  const reduce = useReducedMotion()

  const [index, setIndex] = useState<GraphIndex | null | undefined>(undefined)
  const [ids, setIds] = useState<string[] | null>(null)
  const [names, setNames] = useState<Record<string, string> | null>(null)
  const [extra, setExtra] = useState<Record<string, string>>({})
  useEffect(() => {
    // all start on mount; each lands independently
    loadIndex().then(setIndex)
    loadIds().then(setIds)
    loadNamesExtra().then(setExtra)
    loadNames().then(setNames, () => setNames({}))
  }, [])

  const n = data?.types.length ?? 0
  const idsOk = ids && ids.length === n ? ids : null
  const searchIndex = useMemo(() => (n && names ? buildSearch(n, names, extra, idsOk) : null), [n, names, extra, idsOk])
  const labelOf = useCallback((row: number) => searchIndex?.label[row] ?? names?.[row] ?? '', [searchIndex, names])
  const idRow = useMemo(() => (ids ? new Map(ids.map((id, i) => [id, i])) : null), [ids])

  /* history: Esc pushes `null`, so Back restores what was cleared */
  const [hist, setHist] = useState<{ list: (number | null)[]; pos: number }>({ list: [null], pos: 0 })
  const selected = hist.list[hist.pos]
  const go = useCallback((row: number | null) => {
    setHist((h) => (h.list[h.pos] === row ? h : { list: [...h.list.slice(0, h.pos + 1), row], pos: h.pos + 1 }))
  }, [])
  const step = useCallback((d: number) => setHist((h) => ({ ...h, pos: Math.min(h.list.length - 1, Math.max(0, h.pos + d)) })), [])

  const [relFilter, setRelFilter] = useState<number | null>(null)
  const [showKnn, setShowKnn] = useState(false)
  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [only, setOnly] = useState<Set<number>>(() => new Set())

  const [entity, setEntity] = useState<{ row: number; graph: EntityGraph | null } | null>(null)
  useEffect(() => {
    setRelFilter(null)
    if (selected === null || !index) return
    let live = true
    loadEntity(selected, index).then(
      (graph) => live && setEntity({ row: selected, graph }),
      () => live && setEntity({ row: selected, graph: null }), // shard missing or corrupt
    )
    return () => {
      live = false
    }
  }, [selected, index])
  const graph = entity && entity.row === selected ? entity.graph : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if (e.altKey && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault() // Alt+Left is the browser's own Back
        step(e.key === 'ArrowLeft' ? -1 : 1)
      } else if (e.key === 'Escape' && !typing && !e.defaultPrevented) go(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, step])

  /* what the canvas draws for the selection */
  const neighbours = useMemo(() => {
    if (!graph) return null
    const s = new Set<number>()
    for (const e of graph.edges) if (relFilter === null || edgeRel(e) === relFilter) s.add(edgeNbr(e))
    return Uint32Array.from(s)
  }, [graph, relFilter])
  const knn = showKnn && graph ? graph.knnRows : null
  const labels = useMemo(() => {
    if (selected === null) return []
    const deg = data?.degree
    const types = data?.types
    const anatomy = data?.scene.types.findIndex((t) => t.name === 'Anatomy') ?? -1
    const top = neighbours ? Array.from(neighbours).filter((r) => r !== selected) : []
    if (deg) top.sort((a, b) => deg[b] - deg[a])
    // round-robin by type: at most PER_TYPE each, anatomy only if room is left
    const per = new Map<number, number>()
    const picked: number[] = []
    for (const pass of [0, 1])
      for (const r of top) {
        if (picked.length >= LABELLED_NEIGHBOURS) break
        const t = types ? types[r] : 0
        if ((t === anatomy) !== (pass === 1) || (per.get(t) ?? 0) >= PER_TYPE) continue
        per.set(t, (per.get(t) ?? 0) + 1)
        picked.push(r)
      }
    const near = knn ? Array.from(knn.subarray(0, 4)) : []
    return [selected, ...picked, ...near].map((row) => ({ row, text: labelOf(row) || `Entity ${row}` }))
  }, [selected, neighbours, knn, data, labelOf])

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = []
    for (const s of STARTS) {
      const row = idRow?.get(s.id) ?? (data && s.id === data.scene.als.id ? data.scene.als.row : undefined)
      if (row !== undefined) out.push({ row, label: s.label, note: s.note })
    }
    return out
  }, [idRow, data])

  const typeList = data?.scene.types ?? []
  const toggleType = (i: number) =>
    setOnly((o) => {
      const next = new Set(o)
      if (!next.delete(i)) next.add(i)
      return next.size === typeList.length ? new Set() : next
    })

  const aside = useRef<HTMLElement>(null)
  useEffect(() => {
    aside.current?.scrollTo({ top: 0 }) // newer Chrome returns a Promise: never hand it to React as a cleanup
  }, [selected])

  const stats = `${fmt(index?.entities ?? 97238)} entities · ${fmt(index?.triples ?? 5874261)} triples · ${fmt(index?.relations.length ?? 107)} relations · ${fmt(typeList.length || 13)} types`

  return (
    <div className="flex h-[calc(100dvh-var(--header-height)-5.5rem)] min-h-[34rem] flex-col gap-3" style={{ colorScheme: 'light' }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="rounded-lg bg-card px-3 py-1.5 ring-1 ring-border backdrop-blur-md">
          <h2 className="text-lg font-medium text-balance">The whole knowledge graph</h2>
          <p className="text-sm text-foreground/75 tabular-nums">{stats}</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={colorBy}
            onValueChange={(v) => v && setColorBy(v as ColorBy)}
            aria-label="Colour points by"
            className="bg-card/90"
          >
            <ToggleGroupItem value="type" className="px-2.5 text-xs">Colour by type</ToggleGroupItem>
            <ToggleGroupItem value="cluster" className="px-2.5 text-xs" disabled={!data?.clusters}>
              By island
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center">
            <Button variant="outline" size="icon-sm" className="rounded-r-none bg-card/90" aria-label="Back (Alt+Left)" title="Back (Alt+←)" disabled={hist.pos === 0} onClick={() => step(-1)}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="-ml-px rounded-l-none bg-card/90"
              aria-label="Forward (Alt+Right)"
              title="Forward (Alt+→)"
              disabled={hist.pos === hist.list.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative isolate min-w-0 flex-1 overflow-hidden rounded-xl bg-card ring-1 ring-border backdrop-blur-md">
          {data ? (
            <GraphCanvas
              className="absolute inset-0"
              data={data}
              colorBy={colorBy}
              only={only}
              selected={selected}
              neighbours={neighbours}
              knn={knn}
              labels={labels}
              reduce={reduce}
              labelOf={labelOf}
              onSelect={go}
            />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              {error ? (
                <span>DRKG layout unavailable ({error}). Run frontend/scripts/drkg_scene.py.</span>
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading 97,238 DRKG entities…
                </>
              )}
            </div>
          )}

          {data ? (
            <>
              <div className="absolute top-3 left-3 z-20 w-[min(26rem,calc(100%-1.5rem))]">
                <GraphSearch
                  index={searchIndex}
                  ids={idsOk}
                  degree={data.degree}
                  types={data.types}
                  typeNames={typeList.map((t) => t.name)}
                  only={only}
                  onPick={go}
                />
              </div>

              {/* legend + type filter in one: glyph, colour, name, count; collapses while something is selected */}
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              <details
                open={selected === null}
                key={selected === null ? 'open' : 'closed'}
                className="pointer-events-auto w-56 rounded-lg bg-card/90 p-1.5 shadow-xs ring-1 ring-border backdrop-blur-sm"
              >
                <summary className="flex cursor-pointer list-none items-baseline justify-between rounded-md px-1.5 pt-0.5 pb-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <h3 className="eyebrow">Types · {only.size ? `${only.size} shown` : 'click to isolate'}</h3>
                  {only.size ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault() // inside <summary>: don't also collapse the legend
                        setOnly(new Set())
                      }}
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      All
                    </button>
                  ) : null}
                </summary>
                <ul>
                  {typeList.map((t, i) => {
                    const on = only.size === 0 || only.has(i)
                    return (
                      <li key={t.name}>
                        <button
                          type="button"
                          aria-pressed={only.has(i)}
                          onClick={() => toggleType(i)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            only.has(i) && 'bg-accent font-medium',
                          )}
                        >
                          <span className={cn('flex w-3 justify-center', !on && 'opacity-30')}>
                            <TypeGlyph type={t.name} color={colorBy === 'type' ? typeHex(i) : 'var(--foreground)'} size={11} />
                          </span>
                          <span className={cn('min-w-0 flex-1 truncate', !on && 'text-muted-foreground')}>{t.name}</span>
                          <span className="text-muted-foreground tabular-nums">{fmt(t.count)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </details>
              <p className="rounded-md bg-card/90 px-2 py-1 backdrop-blur-sm text-xs leading-snug text-pretty text-muted-foreground">
                Islands: k-means of 400-d TransE vectors, not distance-preserving · drag to rotate, scroll to zoom, right-drag to pan
              </p>
              </div>
            </>
          ) : null}
        </div>

        <aside ref={aside} className="w-[20rem] shrink-0 overflow-y-auto rounded-xl bg-card ring-1 ring-border backdrop-blur-md xl:w-[23rem]" aria-label="Entity details">
          {data ? (
            <GraphInspector
              row={selected}
              data={data}
              index={index ?? null}
              ids={idsOk}
              entity={graph}
              graphMissing={index === null || (entity?.row === selected && !entity.graph)}
              labelOf={labelOf}
              relFilter={relFilter}
              onRelFilter={setRelFilter}
              showKnn={showKnn}
              onShowKnn={setShowKnn}
              onNavigate={go}
              suggestions={suggestions}
            />
          ) : null}
        </aside>
      </div>
    </div>
  )
}
