import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Dither from '@/components/react-bits/Dither'
import OverviewDashboard from '@/components/overview-dashboard'
import { AppSidebar, ALL_NAV, NAV_GROUPS, NAV_SECONDARY, type Profile } from '@/components/app-sidebar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import { DITHER_INK, DITHER_PAPER } from '@/lib/theme'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Placeholder copy for views that aren't built yet. */
const VIEWS: Record<string, { title: string; description: string; placeholder: string }> = {
  assessment: {
    title: 'Ten minutes, three tasks.',
    description: 'A short typing passage, a sustained “ahh” and pa-ta-ka, and an Archimedes spiral.',
    placeholder: 'Guided capture is coming soon. Each session will record keystroke timing, voice, and pen kinematics on this device.',
  },
  trends: {
    title: 'See the slow drift.',
    description: 'Every feature, plotted against your own baseline.',
    placeholder: 'Per-feature trend views are coming soon. The overview already shows domain-level change from baseline.',
  },
  alerts: {
    title: 'Only what persists.',
    description: 'Alerts fire on sustained change, not a single bad day.',
    placeholder: 'Alert history and thresholds are coming soon.',
  },
  typing: {
    title: 'How you type.',
    description: 'Dwell, flight and inter-key timing from everyday typing, never the content.',
    placeholder: 'The typing assessment is coming soon.',
  },
  speech: {
    title: 'How you speak.',
    description: 'Articulation rate, diadochokinesis, phonation time and voice quality.',
    placeholder: 'Speech tasks are coming soon.',
  },
  handwriting: {
    title: 'How you write.',
    description: 'Stroke velocity, jerk, pressure and spiral accuracy.',
    placeholder: 'Handwriting and spiral capture are coming soon.',
  },
  'self-report': {
    title: 'In your own words.',
    description: 'The 12-item ALSFRS-R, self-administered between visits.',
    placeholder: 'The self-report questionnaire is coming soon.',
  },
  reports: {
    title: 'Bring the evidence to the visit.',
    description: 'A summary your neurologist can read in two minutes.',
    placeholder: 'Shareable reports are coming soon.',
  },
  forecast: {
    title: 'Where this is heading.',
    description: 'Projected ALSFRS-R and domain trajectories, with honest uncertainty.',
    placeholder: 'Detailed forecasts are coming soon. The overview shows the six-month ALSFRS-R projection.',
  },
  diary: {
    title: 'What the numbers miss.',
    description: 'Cramps, fatigue, swallowing, falls — logged in a few taps.',
    placeholder: 'The symptom diary is coming soon. Entries will appear alongside your measurements.',
  },
  tapping: {
    title: 'How fast, how steady.',
    description: 'Alternating finger taps on screen: rate, rhythm and fatigue across a 10-second trial.',
    placeholder: 'The finger-tapping task is coming soon.',
  },
  visits: {
    title: 'Every visit, in one place.',
    description: 'Clinician-rated ALSFRS-R, FVC, and notes from each appointment.',
    placeholder: 'Clinic visit records are coming soon.',
  },
  medications: {
    title: 'What you’re taking, and when.',
    description: 'Track riluzole, edaravone and other treatments against your trends.',
    placeholder: 'Medication tracking is coming soon.',
  },
  trials: {
    title: 'Studies you may qualify for.',
    description: 'Open ALS trials matched to your progression and location.',
    placeholder: 'Trial matching is coming soon.',
  },
  devices: {
    title: 'Where your data comes from.',
    description: 'Keyboards, microphones and styluses connected to Motus.',
    placeholder: 'Device management is coming soon.',
  },
  privacy: {
    title: 'Your data, your call.',
    description: 'What is stored, who can see it, and how to export or delete it.',
    placeholder: 'Privacy controls are coming soon.',
  },
  settings: {
    title: 'Make it fit your routine.',
    description: 'Reminders, session length, units and accessibility.',
    placeholder: 'Settings are coming soon.',
  },
  'care-team': {
    title: 'Who sees your data.',
    description: 'Invite your neurologist, clinic nurse, or carer.',
    placeholder: 'Care-team access is coming soon.',
  },
}

export default function Home() {
  const { user, loading, configured, signOut } = useAuth()
  const [view, setView] = useState('overview')

  if (configured && loading) return null
  if (configured && !user) return <Navigate to="/" replace />

  // Without Supabase keys the page still renders, on sample data, so the UI can be worked on.
  const meta = user?.user_metadata ?? {}
  const profile: Profile = user
    ? { name: meta.full_name ?? meta.name ?? user.email ?? 'You', email: user.email ?? '', avatar: meta.avatar_url ?? meta.picture }
    : { name: 'Demo patient', email: 'Sign-in not configured' }
  const firstName = profile.name.split(/\s+/)[0]

  const label = ALL_NAV.find((n) => n.value === view)?.label ?? 'Overview'
  const section =
    NAV_GROUPS.find((g) => g.items.some((i) => i.value === view))?.label ??
    (NAV_SECONDARY.some((i) => i.value === view) ? 'Account' : view === 'assessment' ? 'Assessments' : 'Monitoring')
  const page = VIEWS[view]

  return (
    <div className="relative h-dvh w-full overflow-hidden text-foreground">
      {/* The landing's dither field runs behind the whole workspace. */}
      <div className="fixed inset-0 z-0" aria-hidden>
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

      <TooltipProvider delayDuration={0}>
        <SidebarProvider
          className="relative z-10 h-dvh min-h-0 !bg-transparent"
          style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as React.CSSProperties}
        >
          <AppSidebar active={view} onSelect={setView} profile={profile} onSignOut={user ? signOut : undefined} />
          <SidebarInset className="min-h-0 overflow-y-auto !bg-transparent">
            <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border bg-background/60 backdrop-blur-md">
              <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
                <h1 className="text-base font-medium">{label}</h1>
              </div>
            </header>
            <div className="px-4 pt-6 pb-16 lg:px-6">
              {view === 'overview' ? (
                <OverviewDashboard firstName={firstName} />
              ) : (
                <div className="pt-8 lg:pt-12">
                  <p className="eyebrow mb-8">{section} / {label}</p>
                  <div aria-live="polite">
                    <h2 className="font-brand text-[clamp(2.75rem,7vw,4.5rem)] leading-none">{page.title}</h2>
                    <p className="mt-6 max-w-xl text-lg text-muted-foreground">{page.description}</p>
                  </div>
                  <Card className="mt-12 max-w-2xl gap-4 [--card-spacing:--spacing(8)]">
                    <div className="px-8">
                      <p className="eyebrow">Coming soon</p>
                      <h3 className="mt-4 text-2xl font-medium">{label}</h3>
                      <p className="mt-4 text-muted-foreground">{page.placeholder}</p>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
