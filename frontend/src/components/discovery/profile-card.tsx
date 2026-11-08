import { useState, type CSSProperties, type PointerEvent } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type AgentStep, type DrugProfile } from '@/lib/pipeline'
import { useRun, type TraceItem } from '@/lib/run-store'
import { LANE_COLORS } from './lanes'
import { StatusIcon } from './pieces'

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

type Phase = { type: AgentStep['type'] | 'profile'; label: string }

/** What each agent does, in order. Each trace step fills one phase; the profile itself is the last. */
const PHASES: Phase[] = [
  { type: 'thinking', label: 'Hypothesis' },
  { type: 'tool_call', label: 'Open Targets query' },
  { type: 'tool_result', label: 'Target evidence' },
  { type: 'profile', label: 'Profile' },
]

/** A live sub-agent picks its own tools and may call several, so its phases are named generically. */
const LIVE_PHASES: Phase[] = [
  { type: 'thinking', label: 'Brief received' },
  { type: 'tool_call', label: 'Tool calls' },
  { type: 'tool_result', label: 'Evidence returned' },
  { type: 'profile', label: 'Profile' },
]

/** The orchestrator decides how many sub-agents to spawn; the grid fits however many it chose. */
const COLS: Record<number, string> = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5' }

const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]

/**
 * The profile agents, one card each. Everything here is derived from run events
 * (`lanes`, then `step` per lane, then `profile`), so the simulated run and the live agent drive it the same way.
 */
export function ProfileGrid() {
  const { state } = useRun()
  const phases = state.source === 'live' ? LIVE_PHASES : PHASES
  const steps = state.trace.filter((t) => t.stage === 'profiles' && t.lane !== undefined)
  // Whatever had already happened when this grid mounted renders still, so revisiting the page never replays it.
  const [seen] = useState(() => ({
    started: new Set(steps.map((t) => t.lane)),
    written: new Set(state.profiles.map((p) => p.lane)),
  }))
  return (
    <div className={cn('grid gap-3 md:grid-cols-2', COLS[state.lanes.length] ?? 'xl:grid-cols-4')}>
      <p role="status" className="sr-only">{state.profiles.length} of {state.lanes.length} profiles written</p>
      {state.lanes.map((p) => {
        const mine = steps.filter((t) => t.lane === p.lane)
        const profile = state.profiles.find((x) => x.lane === p.lane)
        const name = profile?.name ?? p.name
        if (!mine.length && !profile) return <Slot key={p.lane} lane={p.lane} name={name} criterion={p.criterion} />
        return (
          <AgentCard
            key={p.lane}
            lane={p.lane}
            name={name}
            criterion={p.criterion}
            phases={phases}
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
  return <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rotate-45 rounded-xs', faded && 'opacity-35')} style={{ background: laneColor(lane) }} />
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
function Slot({ lane, name, criterion }: { lane: number; name: string; criterion?: string }) {
  return (
    <div className="flex min-h-116 flex-col rounded-xl border border-dashed border-border p-4">
      <div className="flex items-start gap-2.5">
        <Diamond lane={lane} faded />
        <div className="min-w-0">
          <Criterion lane={lane} criterion={criterion} />
          <h3 className="font-medium text-balance text-muted-foreground">{name}</h3>
        </div>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">Queued</p>
    </div>
  )
}

/** Agent number, plus the criterion the orchestrator assigned it on a live run. */
function Criterion({ lane, criterion }: { lane: number; criterion?: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Agent {lane + 1}
      {criterion ? ` · ${criterion}` : ''}
    </p>
  )
}

function AgentCard({ lane, name, criterion, phases, steps, profile, running, enter, reveal }: {
  lane: number
  name: string
  criterion?: string
  phases: Phase[]
  steps: TraceItem[]
  profile?: DrugProfile
  running: boolean
  enter: boolean
  reveal: boolean
}) {
  // Count phases reached, not raw steps: a live backend may emit extra steps of one type.
  const done = phases.filter((ph) => (ph.type === 'profile' ? !!profile : steps.some((s) => s.step.type === ph.type))).length
  const color = laneColor(lane)
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
        <div className="min-w-0 flex-1">
          <Criterion lane={lane} criterion={criterion} />
          <h3 className="font-medium leading-snug text-balance">{name}</h3>
        </div>
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
            `Step ${Math.min(done + (running ? 1 : 0), phases.length)} of ${phases.length}`
          )}
        </span>
      </header>

      <div className="px-4 pt-3 pb-4">
        {profile ? <Profile profile={profile} reveal={reveal} /> : <Sketch done={done} />}
      </div>

      <Steps lane={lane} phases={phases} steps={steps} done={done} running={running} />
    </article>
  )
}

/** The finished profile. Rendered verbatim from the agent's output. */
function Profile({ profile, reveal }: { profile: DrugProfile; reveal: boolean }) {
  // A live sub-agent returns 1–3 strategies (or none, with its hypothesis saying why).
  if (profile.strategies) {
    if (!profile.strategies.length) return <p {...arrive(reveal, 0)} className={cn('text-xs text-muted-foreground', arrive(reveal, 0).className)}>{profile.hypothesis}</p>
    return (
      <>
        <ol className="space-y-4">
          {profile.strategies.map((x, i) => (
            <li key={i} {...arrive(reveal, i)}>
              <p className="text-[0.9375rem] leading-snug text-pretty">{x.goal}</p>
              {x.targets.length ? <Targets targets={x.targets} /> : null}
            </li>
          ))}
        </ol>
        {profile.constraints.length ? <Constraints constraints={profile.constraints} reveal={reveal} i={profile.strategies.length} /> : null}
      </>
    )
  }
  return (
    <>
      <p {...arrive(reveal, 0)} className={cn('text-[0.9375rem] leading-snug text-pretty', arrive(reveal, 0).className)}>{profile.hypothesis}</p>
      <dl {...arrive(reveal, 1)} className={cn('mt-4 space-y-3 text-sm', arrive(reveal, 1).className)}>
        <div>
          <dt className="text-xs text-muted-foreground">Targets</dt>
          <dd><Targets targets={profile.targets} /></dd>
        </div>
        {profile.modality ? (
          <div>
            <dt className="text-xs text-muted-foreground">Modality</dt>
            <dd className="mt-1">{profile.modality}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">Constraints</dt>
          <dd><ConstraintList constraints={profile.constraints} /></dd>
        </div>
      </dl>
    </>
  )
}

function Targets({ targets }: { targets: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
      {targets.map((t) => (
        <span key={t} className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-medium">{t}</span>
      ))}
    </div>
  )
}

function ConstraintList({ constraints }: { constraints: string[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {constraints.map((c) => (
        <li key={c} className="flex gap-1.5">
          <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-foreground/30" />
          {c}
        </li>
      ))}
    </ul>
  )
}

/** Constraints under a live agent's strategies, as their own labelled block. */
function Constraints({ constraints, reveal, i }: { constraints: string[]; reveal: boolean; i: number }) {
  return (
    <div {...arrive(reveal, i)} className={cn('mt-4 text-sm', arrive(reveal, i).className)}>
      <p className="text-xs text-muted-foreground">Constraints</p>
      <ConstraintList constraints={constraints} />
    </div>
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
function Steps({ lane, phases, steps, done, running }: { lane: number; phases: Phase[]; steps: TraceItem[]; done: number; running: boolean }) {
  const [open, setOpen] = useState(false)
  const color = laneColor(lane)
  return (
    <div className="mt-auto border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-4 py-3 outline-hidden hover:bg-foreground/3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {phases.map((ph, i) => {
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
          {phases.map((ph, i) => (
            <PhaseRow
              key={ph.type}
              label={ph.label}
              items={steps.filter((s) => s.step.type === (ph.type === 'profile' ? 'output' : ph.type))}
              status={i < done ? 'done' : i === done && running ? 'running' : 'pending'}
            />
          ))}
        </ol>
      ) : null}
    </div>
  )
}

/** One step of the agent's work. Opens to show exactly what the agent did. */
function PhaseRow({ label, items, status }: { label: string; items: TraceItem[]; status: 'pending' | 'running' | 'done' }) {
  const [open, setOpen] = useState(false)
  // A live agent can call several tools in one phase: show every one, each under its own label.
  const item = items.length
    ? { step: { content: items.length === 1 ? items[0].step.content : items.map((s) => `${s.step.label}\n${s.step.content}`).join('\n\n') } }
    : undefined
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
