import { useState, type ReactNode } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { DrkgScene } from './drkg-data'
import { LANE_COLORS } from './lanes'

/**
 * The key to the DRKG scene: every visual channel the scene uses, drawn in the
 * scene's own style, plus Overseer-style toggles for clusters and entity types.
 * Light theme only. Collapses to a pill; the open/closed state persists.
 */

type Cluster = { id: number; label: string; size: number; dominantType: string; topTypes?: { name: string; share: number }[]; color?: string }
type Scene = Omit<DrkgScene, 'clusters' | 'meta'> & {
  meta: DrkgScene['meta'] & { degree?: { min: number; median: number; p99: number; max: number } }
  clusters?: Cluster[]
}

/** Muted, equal-lightness cluster hues; golden-angle steps keep neighbours apart. */
export function clusterColor(id: number, cluster?: { color?: string }) {
  return cluster?.color ?? `oklch(0.7 0.085 ${Math.round((id * 137.508 + 200) % 360)})`
}

const INK = 'var(--foreground)'
const NAMED = ['Compound', 'Gene', 'Disease'] as const
const STORE = 'drkg-legend-open'
const fmt = (n: number) => n.toLocaleString('en-US')

/** Entity-type glyph, the same shape the scene draws. */
export function TypeGlyph({ type, size = 12, color = INK }: { type: string; size?: number; color?: string }) {
  const r = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      {type === 'Compound' ? (
        <circle cx={r} cy={r} r={r - 1} fill={color} />
      ) : type === 'Gene' ? (
        <circle cx={r} cy={r} r={r - 1.75} fill="none" stroke={color} strokeWidth={1.5} />
      ) : type === 'Disease' ? (
        <rect x={r - r * 0.55} y={r - r * 0.55} width={r * 1.1} height={r * 1.1} fill={color} transform={`rotate(45 ${r} ${r})`} />
      ) : (
        <circle cx={r} cy={r} r={r * 0.35} fill={color} />
      )}
    </svg>
  )
}

function Row({ glyph, channel, children }: { glyph: ReactNode; channel: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 py-1">
      <div className="flex items-center gap-1">{glyph}</div>
      <p className="min-w-0 text-xs leading-snug text-pretty">
        <span className="block font-medium">{channel}</span>
        <span className="block text-muted-foreground">{children}</span>
      </p>
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One visibility toggle row: swatch/glyph, label, count, eye. Hidden = strikethrough + eye-off, never colour alone. */
function Toggle({ off, onClick, mark, label, count }: { off: boolean; onClick: () => void; mark: ReactNode; label: string; count: number }) {
  const Icon = off ? EyeOff : Eye
  return (
    <button
      type="button"
      aria-pressed={!off}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className={cn('flex w-3 shrink-0 justify-center', off && 'opacity-30')}>{mark}</span>
      <span className={cn('min-w-0 flex-1 truncate', off && 'text-muted-foreground line-through')} title={label}>
        {label}
      </span>
      <span className="text-muted-foreground tabular-nums">{fmt(count)}</span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={off ? 'Hidden' : 'Visible'} />
    </button>
  )
}

export function DrkgLegend({
  scene,
  hidden,
  onToggleCluster,
  hiddenTypes,
  onToggleType,
  activeLane,
  selectedLane,
  onSelectLane,
  phase,
}: {
  scene: Scene
  hidden: Set<number>
  onToggleCluster: (id: number) => void
  hiddenTypes: Set<number>
  onToggleType: (idx: number) => void
  activeLane: number | null
  selectedLane: number | null
  onSelectLane: (lane: number | null) => void
  phase: string | null
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORE) !== '0'
    } catch {
      return true
    }
  })
  const toggleOpen = () => {
    setOpen(!open)
    try {
      localStorage.setItem(STORE, open ? '0' : '1')
    } catch {
      /* storage unavailable: state just won't persist */
    }
  }

  const clusters = scene.clusters ?? []
  const degree = scene.meta.degree
  const sizeFor = (d: number) => (degree ? 4 + 8 * (Math.log1p(d) / Math.log1p(degree.p99)) : 6)

  // Entity-type toggle groups: the three named shapes, and every remaining type folded into "Other".
  const typeIdx = (name: string) => scene.types.findIndex((t) => t.name === name)
  const otherIdx = scene.types.map((t, i) => (NAMED.includes(t.name as (typeof NAMED)[number]) ? -1 : i)).filter((i) => i >= 0)
  const groups = [
    ...NAMED.map((name) => ({ key: name, label: name, idx: [typeIdx(name)].filter((i) => i >= 0) })),
    { key: 'other', label: 'Other (pathways, side effects…)', idx: otherIdx },
  ].map((g) => ({ ...g, count: g.idx.reduce((s, i) => s + scene.types[i].count, 0), off: g.idx.length > 0 && g.idx.every((i) => hiddenTypes.has(i)) }))
  const toggleGroup = (idx: number[], off: boolean) => idx.forEach((i) => hiddenTypes.has(i) === off && onToggleType(i))
  const anyHidden = hidden.size > 0 || hiddenTypes.size > 0
  const showAll = () => {
    clusters.forEach((c) => hidden.has(c.id) && onToggleCluster(c.id))
    ;[...hiddenTypes].forEach((i) => onToggleType(i))
  }

  const header = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="drkg-legend-body"
      onClick={toggleOpen}
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="text-xs font-medium">Legend</span>
      {open ? null : <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">{phase ?? ''}</span>}
      <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} aria-hidden />
    </button>
  )

  if (!open) {
    return <aside className="w-fit max-w-[280px] overflow-hidden rounded-full bg-card text-card-foreground ring-1 ring-border backdrop-blur-md">{header}</aside>
  }

  return (
    <aside className="flex max-h-full w-[280px] flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-border backdrop-blur-md">
      {header}
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div id="drkg-legend-body">
          <div className="px-4 pt-3 pb-2" aria-live="polite">
            <p className="eyebrow">DRKG · TransE 400-d</p>
            <p className="mt-1.5 truncate text-sm font-medium tabular-nums">{phase ?? 'Ready'}</p>
          </div>
          <Separator />

          <Section title="Profiles">
            <ul className="space-y-0.5">
              {scene.profiles.map((p) => {
                const active = activeLane === p.lane
                const selected = selectedLane === p.lane
                return (
                  <li key={p.lane}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectLane(selected ? null : p.lane)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        selected && 'bg-accent',
                        active || selected ? 'font-semibold' : 'text-muted-foreground',
                      )}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: LANE_COLORS[p.lane] }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {active ? <span className="text-[10px] font-medium uppercase">● now</span> : selected ? <span className="text-[10px] font-medium uppercase">Selected</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
          <Separator />

          <Section title="Visual encoding">
            <Row
              channel="Position"
              glyph={
                <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden>
                  <circle cx="5" cy="9" r="2" fill={INK} opacity=".5" />
                  <circle cx="11" cy="5" r="2" fill={INK} opacity=".5" />
                  <circle cx="22" cy="10" r="2" fill={INK} opacity=".5" />
                </svg>
              }
            >
              <span title={scene.meta.projection ?? undefined}>Clustered embedding projection</span>
            </Row>
            <Row channel="Colour" glyph={[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full" style={{ background: clusterColor(i, clusters[i]) }} />)}>
              Embedding cluster
            </Row>
            <Row channel="Shape" glyph={NAMED.map((t) => <TypeGlyph key={t} type={t} size={11} />)}>
              Entity type
            </Row>
            <Row
              channel="Size"
              glyph={[1, 2, 3].map((i) => <span key={i} className="rounded-full bg-foreground/50" style={{ width: 2 + i * 2.5, height: 2 + i * 2.5 }} />)}
            >
              Node degree (log scale)
            </Row>
            <Row channel="Brightness" glyph={[0.2, 0.55, 1].map((o) => <span key={o} className="size-2.5 rounded-full bg-foreground" style={{ opacity: o }} />)}>
              Proximity to the active query
            </Row>
            {degree ? (
              <div className="mt-2.5 flex items-end justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                {([['min', degree.min], ['median', degree.median], ['p99', degree.p99]] as const).map(([k, d]) => (
                  <div key={k} className="flex flex-col items-center gap-1">
                    <span className="rounded-full bg-foreground/50" style={{ width: sizeFor(d), height: sizeFor(d) }} aria-hidden />
                    <span>
                      {k} {fmt(d)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Section>
          <Separator />

          <Section
            title="Show"
            aside={
              anyHidden ? (
                <button type="button" className="text-[11px] font-medium underline-offset-2 hover:underline" onClick={showAll}>
                  Show all
                </button>
              ) : null
            }
          >
            <p className="mb-1 text-[11px] text-muted-foreground">Entity types</p>
            <ul>
              {groups.map((g) =>
                g.idx.length ? (
                  <li key={g.key}>
                    <Toggle off={g.off} onClick={() => toggleGroup(g.idx, g.off)} mark={<TypeGlyph type={g.key} />} label={g.label} count={g.count} />
                  </li>
                ) : null,
              )}
            </ul>
            {clusters.length ? (
              <>
                <p className="mt-2.5 mb-1 text-[11px] text-muted-foreground tabular-nums">Clusters · {clusters.length}</p>
                <ul>
                  {clusters.map((c) => (
                    <li key={c.id}>
                      <Toggle
                        off={hidden.has(c.id)}
                        onClick={() => onToggleCluster(c.id)}
                        mark={<span className="size-2.5 rounded-full" style={{ background: clusterColor(c.id, c) }} />}
                        label={c.label}
                        count={c.size}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>

          <Separator />
          <p className="px-4 py-3 text-[11px] leading-snug text-pretty text-muted-foreground">
            Layout is a 3-D view of 400-d vectors; rankings use true 400-d L2 distance over {fmt(scene.meta.universe)} compounds.
          </p>
        </div>
      </ScrollArea>
    </aside>
  )
}
