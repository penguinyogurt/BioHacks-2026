import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Grainient from '@/components/Grainient'
import OverviewDashboard from '@/components/overview-dashboard'
import { AppSidebar, NAVIGATION, type Profile } from '@/components/app-sidebar'
import { Card } from '@/components/ui/card'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'

/** Landing's fully "stained" palette, run slow: calhacks keeps the same background, quieter, once signed in. */
const GRAIN_LIVE: [string, string, string] = ['#0d6c86', '#142450', '#060a14']

/** calhacks-style placeholder copy for views that aren't built yet. */
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

  const section = NAVIGATION.find((g) => g.children.some((c) => c.value === view))
  const label = section?.children.find((c) => c.value === view)?.label ?? 'New assessment'
  const page = VIEWS[view]

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <Grainient colors={GRAIN_LIVE} timeSpeed={0.08} grainAmount={0.06} />
        <div className="absolute inset-0 bg-background/60" />
      </div>

      <TooltipProvider delayDuration={0}>
        <SidebarProvider className="relative h-dvh min-h-0" style={{ '--sidebar-width': '17.5rem' } as React.CSSProperties}>
          <AppSidebar active={view} onSelect={setView} profile={profile} onSignOut={user ? signOut : undefined} />
          <SidebarInset className="min-h-0 overflow-y-auto bg-transparent">
            <div className="sticky top-0 z-10 flex h-14 items-center px-3">
              <SidebarTrigger aria-label="Toggle sidebar" />
            </div>
            <div className="px-4 pb-16 sm:px-8">
              {view === 'overview' ? (
                <OverviewDashboard firstName={firstName} />
              ) : (
                <div className="pt-8 lg:pt-12">
                  <p className="eyebrow mb-8">{section?.label ?? 'Assessments'} / {label}</p>
                  <div aria-live="polite">
                    <h1 className="text-[clamp(2.75rem,8vw,4.5rem)] leading-none font-normal tracking-tight">{page.title}</h1>
                    <p className="mt-6 max-w-xl text-lg text-muted-foreground">{page.description}</p>
                  </div>
                  <Card className="mt-12 max-w-2xl gap-4 [--card-spacing:--spacing(8)]">
                    <div className="px-8">
                      <p className="eyebrow">Coming soon</p>
                      <h2 className="mt-4 text-2xl font-normal">{label}</h2>
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
