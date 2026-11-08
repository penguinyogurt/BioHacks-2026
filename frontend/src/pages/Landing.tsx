import { useCallback, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AsciiBackground } from '@/components/background'
import NeuronViewer from '@/components/neuron-viewer'
import { AFTER_SIGN_IN, useAuth } from '@/lib/auth'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function GoogleIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

const BEAM = '#ffd84d'
const INK = '#13293d'

/**
 * Carries a pulse from the axon terminals to the wordmark: a faint guide path,
 * an amber comet travelling down it, and the name lighting up when it lands.
 */
function useSignalToName() {
  const name = useRef<HTMLHeadingElement>(null)
  const guide = useRef<SVGPathElement>(null)
  const comet = useRef<SVGPathElement>(null)

  const fire = useCallback((x: number, y: number) => {
    const h = name.current
    const g = guide.current
    const c = comet.current
    if (!h || !g || !c) return
    const r = h.getBoundingClientRect()
    const tx = r.right - r.width * 0.16 // lands on the top of the last letters
    const ty = r.top + r.height * 0.12
    const dy = ty - y
    const d = `M ${x} ${y} C ${x} ${y + dy * 0.55}, ${tx} ${ty - dy * 0.45}, ${tx} ${ty}`
    g.setAttribute('d', d)
    c.setAttribute('d', d)
    g.style.opacity = '1'
    const len = c.getTotalLength()
    const seg = Math.min(180, len * 0.4)
    c.style.strokeDasharray = `${seg} ${len + seg}`
    // Visible only while travelling: hidden before it leaves the terminals and after it lands.
    c.animate(
      [
        { strokeDashoffset: seg, opacity: 1 },
        { strokeDashoffset: -len, opacity: 1 },
      ],
      { duration: 1300, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
    ).onfinish = () => {
      h.animate(
        [
          { color: INK, textShadow: `0 0 0 ${BEAM}00` },
          { color: '#a8820f', textShadow: `0 0 22px ${BEAM}99`, offset: 0.18 },
          { color: INK, textShadow: `0 0 0 ${BEAM}00` },
        ],
        { duration: 1800, easing: 'ease-out' },
      )
    }
  }, [])

  return { name, guide, comet, fire }
}

export default function Landing() {
  const { user, configured, signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signal = useSignalToName()

  if (user) return <Navigate to={AFTER_SIGN_IN} replace />

  async function onSignIn() {
    setBusy(true)
    setError('')
    const failed = await signInWithGoogle()
    if (failed) {
      setError(failed)
      setBusy(false)
    }
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 z-0">
        <AsciiBackground />
        {/* Clear paper behind the name and sign-in; the ASCII gradient only starts beyond it. */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 40% 20% at 76% 100%, var(--background) 0%, var(--background) 35%, transparent 100%)' }}
        />
      </div>

      {/* The neuron lies across the top of the page: soma left, axon running right to its terminals. */}
      <NeuronViewer
        reducedMotion={reducedMotion}
        onTerminals={signal.fire}
        className="absolute inset-0 z-0"
      />

      {/* From the terminals, the signal carries on down to the name. */}
      <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden>
        <defs>
          <filter id="signal-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path ref={signal.guide} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.25" strokeDasharray="2 6" style={{ opacity: 0, transition: 'opacity 600ms ease-out' }} />
        <path ref={signal.comet} fill="none" stroke={BEAM} strokeWidth="4" strokeLinecap="round" filter="url(#signal-glow)" style={{ opacity: 0 }} />
      </svg>

      <main className="pointer-events-none absolute right-[8vw] bottom-0 z-10 flex flex-col items-end pb-12 text-right md:right-[12vw] md:pb-16 lg:right-[15vw] lg:pb-20">
        <h1 ref={signal.name} className="font-brand text-6xl leading-none tracking-tight md:text-7xl lg:text-8xl">addo labs</h1>
        <p className="font-serif-display mt-1 text-2xl leading-tight text-foreground/75 italic md:text-3xl lg:text-[2.1rem]">
          ALS drug discovery optimization
        </p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={!configured || busy}
          aria-busy={busy}
          className="pointer-events-auto mt-6 flex cursor-pointer items-center gap-2.5 rounded-full bg-foreground py-2.5 pr-5 pl-2.5 text-sm text-background shadow-[0_6px_20px_-8px_rgb(19_41_61/0.6)] transition-[transform,background-color] duration-200 ease-out hover:bg-foreground/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="grid size-7 place-items-center rounded-full bg-background">
            <GoogleIcon />
          </span>
          {busy ? 'Connecting…' : 'Sign in with Google'}
        </button>
        {error ? <p className="mt-3 text-xs text-foreground/70" role="alert">{error}</p> : null}
        {!configured ? <p className="mt-3 text-xs text-foreground/60">Add Supabase keys to .env to enable sign-in.</p> : null}
      </main>
    </div>
  )
}
