import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import Grainient, { type GrainController } from '@/components/Grainient'
import NeuronCanvas from '@/components/NeuronCanvas'
import { AFTER_SIGN_IN, useAuth } from '@/lib/auth'

const PRODUCT = 'Motus'

/** card.io's sweep: grey field → colour as the neuron fires. */
const GRAIN_GREY: [string, string, string] = ['#3d3d3d', '#2a2a2a', '#1c1c1c']
const GRAIN_LIVE: [string, string, string] = ['#0d6c86', '#142450', '#060a14']
const MAX_RIPPLES = 4

function lerpHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function useTyped(text: string, skip: boolean) {
  const [n, setN] = useState(skip ? text.length : 0)
  useEffect(() => {
    if (skip) return
    let i = 0
    let timer = window.setTimeout(function tick() {
      setN(++i)
      if (i < text.length) timer = window.setTimeout(tick, 128)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [text, skip])
  return { shown: text.slice(0, n), done: n >= text.length }
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null)
  const grainRef = useRef<GrainController | null>(null)
  const target = useRef(reducedMotion ? 1 : 0)
  const progress = useRef(target.current)
  const rippleId = useRef(0)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { shown, done } = useTyped(PRODUCT, reducedMotion)
  const { user, configured, signInWithGoogle } = useAuth()

  useEffect(() => {
    let raf = 0
    let painted = -1
    const tick = () => {
      progress.current += (target.current - progress.current) * 0.03
      const p = progress.current
      if (Math.abs(p - painted) > 0.0005) {
        painted = p
        grainRef.current?.setColors(
          lerpHex(GRAIN_GREY[0], GRAIN_LIVE[0], p),
          lerpHex(GRAIN_GREY[1], GRAIN_LIVE[1], p),
          lerpHex(GRAIN_GREY[2], GRAIN_LIVE[2], p),
        )
        rootRef.current?.style.setProperty('--p', p.toFixed(4))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onSpike = useCallback((x: number, y: number) => {
    target.current = Math.min(1, target.current + 0.12)
    const id = ++rippleId.current
    setRipples((r) => [...r, { id, x, y }].slice(-MAX_RIPPLES))
    window.setTimeout(() => setRipples((r) => r.filter((v) => v.id !== id)), 3200)
  }, [])

  async function onAuthClick() {
    setBusy(true)
    setError('')
    const failed = await signInWithGoogle()
    if (failed) {
      setError(failed)
      setBusy(false)
    }
  }

  // calhacks: a signed-in visitor goes straight to the workspace.
  if (user) return <Navigate to={AFTER_SIGN_IN} replace />

  return (
    <div ref={rootRef} className="app">
      <div className="layer grain" aria-hidden>
        <Grainient colors={GRAIN_GREY} controllerRef={grainRef} paused={reducedMotion} />
      </div>

      <div className="layer ripples" aria-hidden>
        {ripples.map((r) => (
          <span key={r.id} className="ripple" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }} />
        ))}
      </div>

      <div className="layer stage">
        <NeuronCanvas progressRef={progress} onSpike={onSpike} reducedMotion={reducedMotion} />
      </div>

      <main className="hero">
        <h1 className="title" aria-label={PRODUCT}>
          <span aria-hidden>{shown}</span>
          <span className="cursor" aria-hidden>|</span>
        </h1>
        <div className={`reveal${done ? ' in' : ''}`}>
          <button className="auth-button" type="button" onClick={onAuthClick} disabled={!configured || busy} aria-busy={busy}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {busy ? 'Connecting…' : 'Sign in with Google'}
          </button>
          {error ? <p className="auth-note" role="alert">{error}</p> : null}
          {!configured ? <p className="auth-note">Add Supabase keys to .env to enable sign-in.</p> : null}
        </div>
      </main>
    </div>
  )
}
