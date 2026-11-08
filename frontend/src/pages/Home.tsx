import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Dither from '@/components/react-bits/Dither'
import OverviewDashboard from '@/components/overview-dashboard'
import DiscoveryWorkspace, { type CompletedRun } from '@/components/discovery/workspace'
import Runs from '@/components/discovery/runs'
import { AppSidebar, ALL_NAV, NAV_GROUPS, NAV_SECONDARY, type Profile } from '@/components/app-sidebar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import { SAMPLE_PATIENT } from '@/lib/pipeline'
import { DITHER_INK, DITHER_PAPER } from '@/lib/theme'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Placeholder copy for views that aren't built yet. */
const VIEWS: Record<string, { title: string; description: string; placeholder: string }> = {
  graph: {
    title: 'The map behind the matches.',
    description: 'Browse DRKG: genes, compounds, diseases and the relations the embeddings are trained on.',
    placeholder: 'The knowledge-graph explorer is coming soon. Discovery runs already search its compound embeddings.',
  },
  genetics: {
    title: 'What the genes rule in, and out.',
    description: 'Panel results that decide which targeted therapies apply, like SOD1-directed tofersen.',
    placeholder: 'Genetics import is coming soon. The sample patient is panel-negative.',
  },
  medications: {
    title: 'What the patient already takes.',
    description: 'Current therapy, so candidates never duplicate it or interact with it.',
    placeholder: 'Medication management is coming soon. The research agent checks interactions against the current list.',
  },
  visits: {
    title: 'Every visit, in one place.',
    description: 'Clinician-rated ALSFRS-R, FVC, and notes from each appointment.',
    placeholder: 'Clinic visit records are coming soon.',
  },
  diary: {
    title: 'What the numbers miss.',
    description: 'Cramps, fatigue, swallowing, falls — logged in a few taps.',
    placeholder: 'The symptom diary is coming soon.',
  },
  fus: {
    title: 'Opening the barrier, on purpose.',
    description: 'MR-guided focused ultrasound briefly opens the blood–brain barrier over motor cortex so large drugs can reach it.',
    placeholder: 'Delivery planning (target region, session schedule, site availability) is coming soon.',
  },
  trials: {
    title: 'Studies the patient may qualify for.',
    description: 'Open ALS and focused-ultrasound trials matched to the patient and the run’s candidates.',
    placeholder: 'Trial matching is coming soon.',
  },
  'care-team': {
    title: 'Who sees the results.',
    description: 'Share reports with the neurologist, clinic nurse, or carer.',
    placeholder: 'Care-team access is coming soon.',
  },
  sources: {
    title: 'Where the evidence comes from.',
    description: 'NCBI, ClinVar, Open Targets, DRKG and open web search, with their versions.',
    placeholder: 'Data-source settings are coming soon.',
  },
  privacy: {
    title: 'The patient’s data, the patient’s call.',
    description: 'What is stored, who can see it, and how to export or delete it.',
    placeholder: 'Privacy controls are coming soon.',
  },
  settings: {
    title: 'Make it fit your lab.',
    description: 'Models, agent count, ranking defaults and report format.',
    placeholder: 'Settings are coming soon.',
  },
}

export default function Home() {
  const { user, loading, configured, signOut } = useAuth()
  const [view, setView] = useState('discovery')
  const [runs, setRuns] = useState<CompletedRun[]>([])
  const [runKey, setRunKey] = useState(0)

  if (configured && loading) return null
  if (configured && !user) return <Navigate to="/" replace />

  // Without Supabase keys the page still renders, on sample data, so the UI can be worked on.
  const meta = user?.user_metadata ?? {}
  const profile: Profile = user
    ? { name: meta.full_name ?? meta.name ?? user.email ?? 'You', email: user.email ?? '', avatar: meta.avatar_url ?? meta.picture }
    : { name: 'Demo researcher', email: 'Sign-in not configured' }

  // "New discovery run" resets the workspace.
  const select = (v: string) => {
    if (v === 'new-run') {
      setRunKey((k) => k + 1)
      setView('discovery')
    } else setView(v)
  }
  const label = ALL_NAV.find((n) => n.value === view)?.label ?? 'Discovery'
  const section =
    NAV_GROUPS.find((g) => g.items.some((i) => i.value === view))?.label ??
    (NAV_SECONDARY.some((i) => i.value === view) ? 'Account' : 'Discovery')
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
          <AppSidebar active={view} onSelect={select} profile={profile} onSignOut={user ? signOut : undefined} />
          <SidebarInset className="min-h-0 overflow-y-auto !bg-transparent">
            <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border bg-background/60 backdrop-blur-md">
              <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
                <h1 className="text-base font-medium">{label}</h1>
              </div>
            </header>
            <div className="px-4 pt-6 pb-16 lg:px-6">
              {/* Kept mounted so a running discovery survives navigating away. */}
              <div hidden={view !== 'discovery'}>
                <DiscoveryWorkspace key={runKey} onComplete={(run) => setRuns((r) => [run, ...r])} />
              </div>
              {view === 'discovery' ? null : view === 'runs' ? (
                <Runs runs={runs} onNewRun={() => select('new-run')} />
              ) : view === 'patient' ? (
                <OverviewDashboard title={SAMPLE_PATIENT.label} />
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
