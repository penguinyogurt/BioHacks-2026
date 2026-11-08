import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Dither from '@/components/react-bits/Dither'
import NeuronViewer from '@/components/neuron-viewer'
import { AFTER_SIGN_IN, useAuth } from '@/lib/auth'
import { DITHER_INK, DITHER_PAPER } from '@/lib/theme'

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

export default function Landing() {
  const { user, configured, signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
        <Dither
          waveSpeed={0.02}
          waveFrequency={3}
          waveAmplitude={0.3}
          backgroundColor={DITHER_PAPER}
          waveColor={DITHER_INK}
          colorNum={4}
          pixelSize={2}
          disableAnimation={reducedMotion}
          enableMouseInteraction
          mouseRadius={1.2}
        />
      </div>

      {/* The neuron stands in the right half and spins about its own long axis. */}
      <NeuronViewer reducedMotion={reducedMotion} className="absolute inset-y-0 right-0 z-0 w-full md:w-[62%]" />

      <main className="pointer-events-none absolute bottom-0 left-0 z-10 flex flex-col items-start pb-12 pl-10 md:pb-16 md:pl-16 lg:pb-20 lg:pl-20">
        <h1 className="font-brand text-6xl leading-none tracking-tight md:text-7xl lg:text-8xl">motus</h1>
        <p className="font-serif-display mt-1 text-2xl leading-tight text-foreground/75 italic md:text-3xl lg:text-[2.1rem]">
          early ALS detection, from how you move
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

      {/* CC BY 4.0 attribution for the neuron model (public/models/neuron.LICENSE.txt). */}
      <p className="absolute right-5 bottom-4 z-10 text-[11px] text-foreground/45 [&_a]:underline [&_a]:decoration-foreground/25 [&_a]:underline-offset-2 [&_a:hover]:text-foreground/80">
        <a href="https://sketchfab.com/3d-models/neuron-cell-low-poly-simple-3a09438daf364c3bbd3cce76f1c7afaa" target="_blank" rel="noreferrer">Neuron Cell Low-poly Simple</a>
        {' by '}
        <a href="https://sketchfab.com/vitalik.kucha" target="_blank" rel="noreferrer">vitalik.kucha</a>
        {' · '}
        <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
      </p>
    </div>
  )
}
