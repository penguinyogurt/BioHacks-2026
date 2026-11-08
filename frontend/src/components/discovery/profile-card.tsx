import { useState, type CSSProperties, type PointerEvent } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PROFILES, type AgentStep, type DrugProfile } from '@/lib/pipeline'
import { useRun, type TraceItem } from '@/lib/run-store'
import { LANE_COLORS } from './lanes'
import { StatusIcon } from './pieces'

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

/** What each agent does, in order. Each trace step fills one phase; the profile itself is the last. */
const PHASES: { type: AgentStep['type'] | 'profile'; label: string }[] = [
  { type: 'thinking', label: 'Hypothesis' },
  { type: 'tool_call', label: 'Open Targets query' },
  { type: 'tool_result', label: 'Target evidence' },
  { type: 'profile', label: 'Profile' },
]

/**
 * The five profile agents, one card each. Everything here is derived from run events
 * (`step` per lane, then `profile`), so a live backend emitting the same events drives it unchanged.
 */
export function ProfileGrid() {
  const { state } = useRun()
  const steps = state.trace.filter((t) => t.stage === 'profiles')
  // Whatever had already happened when this grid mounted renders still, so revisiting the page never replays it.
  const [seen] = useState(() => ({
    started: new Set(steps.map((t) => t.lane)),
    written: new Set(state.profiles.map((p) => p.lane)),
  }))
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <p role="status" className="sr-only">{state.profiles.length} of {PROFILES.length} profiles written</p>
      {PROFILES.map((p) => {
        const mine = steps.filter((t) => t.lane === p.lane)
        const profile = state.profiles.find((x) => x.lane === p.lane)
        const name = profile?.name ?? p.name
        if (!mine.length && !profile) return <Slot key={p.lane} lane={p.lane} name={name} />
        return (
          <AgentCard
            key={p.lane}
            lane={p.lane}
            name={name}
            steps={mine}
            profile={profile}
            running={state.stages.profiles === 'running'}
            enter={!seen.started.has(p.lane) && !seen.written.has(p.lane)}
            reveal={!seen.written.has(p.lane)}
          />
        )
      })}
    </div>
  )
}

function Diamond({ lane, faded }: { lane: number; faded?: boolean }) {
  // Same mark as this profile's point in the DRKG embedding (stage 03).
  return <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rotate-45 rounded-xs', faded && 'opacity-35')} style={{ background: LANE_COLORS[lane] }} />
}

/** Fade-in for content that just arrived, `i` beats behind the first. */
function arrive(on: boolean, i = 0, extra = '') {
  return on
    ? {
        className: cn('animate-in fade-in fill-mode-both duration-500', extra),
        style: { '--tw-ease': EASE_OUT, '--tw-animation-delay': `${i * 60}ms` } as CSSProperties,
      }
    : {}
}

/** Where a card lands before its agent starts. */
function Slot({ lane, name }: { lane: number; name: string }) {
  return (
    <div className="flex min-h-116 flex-col rounded-xl border border-dashed border-border p-4">
      <div className="flex items-start gap-2.5">
        <Diamond lane={lane} faded />
        <h3 className="font-medium text-balance text-muted-foreground">{name}</h3>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">Queued</p>
    </div>
  )
}

function AgentCard({ lane, name, steps, profile, running, enter, reveal }: {
  lane: number
  name: string
  steps: TraceItem[]
  profile?: DrugProfile
  running: boolean
  enter: boolean
  reveal: boolean
}) {
  // Count phases reached, not raw steps: a live backend may emit extra steps of one type.
  const done = PHASES.filter((ph) => (ph.type === 'profile' ? !!profile : steps.some((s) => s.step.type === ph.type))).length
  const color = LANE_COLORS[lane]
  const entrance = arrive(enter, lane, 'duration-300 motion-safe:slide-in-from-bottom-2')

  // Spotlight (after React Bits' SpotlightCard): a lane-colour glow that follows the pointer.
  function track(e: PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`)
  }

  return (
    <article
      aria-label={`${name} agent`}
      onPointerMove={track}
      className={cn('group relative isolate flex min-h-116 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border backdrop-blur-md', entrance.className)}
      style={entrance.style}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(260px circle at var(--x, 50%) var(--y, 0%), ${color}2e, transparent 70%)` }}
      />

      <header className="flex items-start gap-2.5 px-4 pt-4">
        <Diamond lane={lane} />
        <h3 className="min-w-0 flex-1 font-medium leading-snug text-balance">{name}</h3>
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground tabular-nums">
          {profile ? (
            <>
              <Check
                className={cn('size-3.5 text-foreground', reveal && 'animate-in fade-in fill-mode-both delay-300 duration-300 motion-safe:zoom-in-150')}
                style={reveal ? ({ '--tw-ease': EASE_OUT } as CSSProperties) : undefined}
                aria-hidden
              />
              Done
            </>
          ) : (
            `Step ${Math.min(done + (running ? 1 : 0), PHASES.length)} of ${PHASES.length}`
          )}
        </span>
      </header>

      <div className="px-4 pt-3 pb-4">
        {profile ? <Profile profile={profile} reveal={reveal} /> : <Sketch done={done} />}
      </div>

      <Steps lane={lane} steps={steps} done={done} running={running} />
    </article>
  )
}

/** The finished profile. Rendered verbatim from the agent's output. */
function Profile({ profile, reveal }: { profile: DrugProfile; reveal: boolean }) {
  return (
    <>
      <p {...arrive(reveal, 0)} className={cn('text-[0.9375rem] leading-snug text-pretty', arrive(reveal, 0).className)}>{profile.hypothesis}</p>
      <dl {...arrive(reveal, 1)} className={cn('mt-4 space-y-3 text-sm', arrive(reveal, 1).className)}>
        <div>
          <dt className="text-xs text-muted-foreground">Targets</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1 text-xs">
            {profile.targets.map((t) => (
              <span key={t} className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-medium">{t}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Modality</dt>
          <dd className="mt-1">{profile.modality}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Constraints</dt>
          <dd>
            <ul className="mt-1 space-y-1">
              {profile.constraints.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-foreground/30" />
                  {c}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </>
  )
}

/** The profile while it's being written: the same form, its lines drawing in as each step lands. */
function Sketch({ done }: { done: number }) {
  const line = (width: string, after: number, i: number) => (
    <span
      key={i}
      className={cn(
        'block h-2 origin-left rounded-full bg-foreground/8 transition-transform duration-500 motion-reduce:transition-none',
        done >= after ? 'scale-x-100' : 'scale-x-0',
      )}
      style={{ width, transitionTimingFunction: EASE_OUT, transitionDelay: `${i * 60}ms` }}
    />
  )
  return (
    <div aria-hidden className="text-xs">
      <div className="space-y-2 pt-1">{['96%', '88%', '58%'].map((w, i) => line(w, 1, i))}</div>
      <p className="mt-5 text-muted-foreground">Targets</p>
      <div className="mt-2 flex gap-1">{['3.25rem', '4rem', '3.5rem'].map((w, i) => line(w, 2, i))}</div>
      <p className="mt-4 text-muted-foreground">Modality</p>
      <div className="mt-2">{line('70%', 3, 0)}</div>
      <p className="mt-4 text-muted-foreground">Constraints</p>
      <div className="mt-2 space-y-2">{['90%', '74%'].map((w, i) => line(w, 3, i + 1))}</div>
    </div>
  )
}

/** Progress bar of the agent's phases; opens to the step-by-step trace. */
function Steps({ lane, steps, done, running }: { lane: number; steps: TraceItem[]; done: number; running: boolean }) {
  const [open, setOpen] = useState(false)
  const color = LANE_COLORS[lane]
  return (
    <div className="mt-auto border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-4 py-3 outline-hidden hover:bg-foreground/3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {PHASES.map((ph, i) => {
          const active = i === done && running
          return (
            <span
              key={ph.type}
              aria-hidden
              className={cn('h-1 flex-1 rounded-full bg-foreground/10 transition-colors duration-300', active && 'motion-safe:animate-pulse')}
              style={i < done ? { background: color } : active ? { background: `${color}59` } : undefined}
            />
          )
        })}
        <span className="sr-only">{open ? 'Hide' : 'Show'} agent steps</span>
        <ChevronDown className={cn('ml-1.5 size-3.5 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <ol className="pb-1.5" aria-label="Agent steps">
          {PHASES.map((ph, i) => (
            <PhaseRow
              key={ph.type}
              label={ph.label}
              item={steps.find((s) => s.step.type === ph.type)}
              status={i < done ? 'done' : i === done && running ? 'running' : 'pending'}
            />
          ))}
        </ol>
      ) : null}
    </div>
  )
}

/** One step of the agent's work. Opens to show exactly what the agent did. */
function PhaseRow({ label, item, status }: { label: string; item?: TraceItem; status: 'pending' | 'running' | 'done' }) {
  const [open, setOpen] = useState(false)
  const body = (
    <>
      <StatusIcon status={status} />
      <span className={cn('flex-1 truncate', status === 'pending' && 'text-muted-foreground')}>{label}</span>
      {item ? <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} aria-hidden /> : null}
    </>
  )
  return (
    <li>
      {item ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs outline-hidden hover:bg-foreground/3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs">{body}</div>
      )}
      {open && item ? (
        <pre className="max-h-40 overflow-y-auto px-4 pb-2 pl-9 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{item.step.content}</pre>
      ) : null}
    </li>
  )
}
