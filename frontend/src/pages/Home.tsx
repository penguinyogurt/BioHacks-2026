import { useLayoutEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AsciiBackground } from '@/components/background'
import OverviewDashboard from '@/components/overview-dashboard'
import FusPage from '@/components/fus-page'
import { PageHeader } from '@/components/page-header'
import Runs from '@/components/discovery/runs'
import GraphExplorer from '@/components/graph/graph-explorer'
import { GoContext } from '@/components/discovery/pieces'
import { AnalysisPage, CandidatesPage, CasePage, EmbeddingPage, ProfilesPage } from '@/components/discovery/pages'
import { AppSidebar, ALL_NAV, NAV_GROUPS, NAV_PIPELINE, NAV_SECONDARY, type Profile, type StepStatus } from '@/components/app-sidebar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import type { StageId } from '@/lib/pipeline'
import { RunProvider, useRun } from '@/lib/run-store'
import { TakeHomeProvider } from '@/lib/take-home-store'
import TakeHomePage from '@/components/take-home-page'


/** Placeholder copy for views that aren't built yet. */
const VIEWS: Record<string, { title: string; description: string; placeholder: string }> = {
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

/** Which page shows each pipeline stage. */
const STAGE_VIEW: Record<StageId, string> = {
  analysis: 'analysis',
  profiles: 'profiles',
  embedding: 'embedding',
  research: 'candidates',
}

export default function Home() {
  const { user, loading, configured, signOut } = useAuth()
  // Each step has its own URL (/home/profiles …), so browser back/forward walks the workflow.
  const { view = 'case' } = useParams()
  const navigate = useNavigate()
  const setView = (v: string) => {
    if (v !== view) navigate(`/home/${v}`)
  }

  if (configured && loading) return null
  if (configured && !user) return <Navigate to="/" replace />

  // Without Supabase keys the page still renders, on sample data, so the UI can be worked on.
  const meta = user?.user_metadata ?? {}
  const profile: Profile = user
    ? { name: meta.full_name ?? meta.name ?? user.email ?? 'You', email: user.email ?? '', avatar: meta.avatar_url ?? meta.picture }
    : { name: 'Demo researcher', email: 'Sign-in not configured' }

  return (
    // The user moves between steps, with one exception: a live run follows the
    // orchestrator from analysis to the profile agents when it fans out.
    <RunProvider>
      {/* Inside RunProvider: names test results after the uploaded case's patient. */}
      <TakeHomeProvider>
      <GoContext.Provider value={setView}>
        <Workspace view={view} setView={setView} profile={profile} onSignOut={user ? signOut : undefined} />
      </GoContext.Provider>
    </TakeHomeProvider>
    </RunProvider>
  )
}

function Workspace({ view, setView, profile, onSignOut }: { view: string; setView: (v: string) => void; profile: Profile; onSignOut?: () => void }) {
  const { state, reset } = useRun()
  // Every view shares this one scroll container, so without a reset a page opens at the
  // previous page's scroll position (e.g. the bottom, after a live run moves on by itself).
  const scroller = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [view])

  const select = (v: string) => {
    if (v === 'new-run') {
      reset()
      setView('case')
    } else setView(v)
  }

  const steps: Record<string, StepStatus> = {
    case: state.phase === 'idle' ? 'pending' : 'done',
    ...Object.fromEntries(Object.entries(STAGE_VIEW).map(([stage, v]) => [v, state.stages[stage as StageId]])),
  }
  const label = ALL_NAV.find((n) => n.value === view)?.label ?? 'Patient case'
  const section =
    NAV_GROUPS.find((g) => g.items.some((i) => i.value === view))?.label ??
    (NAV_SECONDARY.some((i) => i.value === view) ? 'Account' : 'Discovery')
  const page = VIEWS[view]
  const isPipeline = NAV_PIPELINE.some((n) => n.value === view)

  return (
    <div className="relative h-dvh w-full overflow-hidden text-foreground">
      {/* The same Gradient ASCII field as the landing, behind the whole workspace. */}
      <div className="fixed inset-0 z-0" aria-hidden>
        <AsciiBackground />
      </div>

      <TooltipProvider delayDuration={0}>
        <SidebarProvider
          className="relative z-10 h-dvh min-h-0 !bg-transparent"
          style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as React.CSSProperties}
        >
          <AppSidebar active={view} onSelect={select} profile={profile} onSignOut={onSignOut} steps={steps} />
          <SidebarInset ref={scroller} className="min-h-0 overflow-y-auto !bg-transparent">
            <header className="sticky top-0 z-10 flex rounded-xl h-(--header-height) shrink-0 items-center gap-2 border-b border-border bg-background/60 backdrop-blur-md">
              <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
                <h1 className="text-base font-medium">{label}</h1>
              </div>
            </header>
            <div className="px-4 pt-6 pb-16 lg:px-6">
              {view === 'case' ? (
                <CasePage go={setView} />
              ) : view === 'analysis' ? (
                <AnalysisPage />
              ) : view === 'profiles' ? (
                <ProfilesPage />
              ) : view === 'embedding' ? (
                <EmbeddingPage />
              ) : view === 'candidates' || view === 'report' ? (
                <CandidatesPage />
              ) : view === 'runs' ? (
                <Runs onNewRun={() => select('new-run')} />
              ) : view === 'graph' ? (
                <GraphExplorer />
              ) : view === 'fus' ? (
                <FusPage />
              ) : view === 'take-home' ? (
                <TakeHomePage />
              ) : view === 'patient' ? (
                <OverviewDashboard />
              ) : page && !isPipeline ? (
                <div className="mx-auto max-w-[1440px] space-y-3 text-sm" aria-live="polite">
                  <PageHeader eyebrow={`${section} / ${label}`} title={page.title} description={page.description} />
                  <Card className="max-w-2xl gap-2 [--card-spacing:--spacing(5)]">
                    <div className="px-5">
                      <p className="eyebrow">Coming soon</p>
                      <h3 className="mt-3 text-lg">{label}</h3>
                      <p className="mt-2 text-muted-foreground">{page.placeholder}</p>
                    </div>
                  </Card>
                </div>
              ) : null}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
