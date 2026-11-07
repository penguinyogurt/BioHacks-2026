import type { Pipeline, Stage } from "@/lib/contract";
import { pipelineResult } from "@/lib/pipeline";
import { STAGES, SOURCES, buildStats } from "@/lib/provenance";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContractError } from "@/components/ContractError";
import { Suspense, lazy, useCallback, useState } from "react";
import { Panel } from "@/components/Panel";
import { SectionNav } from "@/components/SectionNav";
import { Reveal } from "@/components/Reveal";
import { Hero } from "@/components/Hero";
import { KeyFigures } from "@/components/KeyFigures";
import { PatientPanel } from "@/components/PatientPanel";
import { FunnelRun } from "@/components/FunnelRun";
import { CandidatesSection } from "@/components/CandidatesSection";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { GraveyardPartition } from "@/components/GraveyardPartition";
import { PipelineProvenance } from "@/components/PipelineProvenance";
import { ValidationPanel } from "@/components/ValidationPanel";
import { num } from "@/lib/utils";

/**
 * Split out of the main bundle. three + the r3f runtime is the single
 * heaviest thing here and it is pure decoration, so loading it inline pushed
 * everything behind it — the funnel run didn't start until 5.3s after
 * navigation because the shader was compiling ahead of it. Lazy, the page is
 * interactive immediately and the texture fades in behind it.
 */
const Dither = lazy(() =>
  import("@/components/Dither").then((m) => ({ default: m.Dither })),
);

export default function App() {
  if (!pipelineResult.ok) {
    return <ContractError problems={pipelineResult.problems} />;
  }
  return <Report data={pipelineResult.data} />;
}

/**
 * Hooks can't live behind the early return in App, so the report body is its
 * own component. That keeps a contract failure a real screen, not a crash.
 */
function Report({ data }: { data: Pipeline }) {
  const generated = new Date(data.meta.generated_at);

  /**
   * The funnel's "see them" links. The token makes a repeat request distinct
   * from the previous one, so clicking the same stage twice still scrolls.
   */
  const [requestedView, setRequestedView] = useState<
    { view: "bbb" | "patient_filter" | "trial_history"; token: number } | undefined
  >();

  const showCuts = useCallback((stage: Stage) => {
    if (stage !== "bbb" && stage !== "patient_filter" && stage !== "trial_history") {
      return;
    }
    setRequestedView({ view: stage, token: Date.now() });
    document
      .getElementById("candidates-heading")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="relative min-h-dvh">
        {/* Pushed well past the component's own defaults, which are tuned to
            stay legible under body text. Here it doesn't have to be: every
            section sits in a glass Panel whose backdrop-blur softens the
            texture under the words, so the dither can carry real contrast in
            the gaps between panels — which is where you actually see it. */}
        <Suspense fallback={null}>
          <Dither
            waveColor={[0.052, 0.044, 0.088]}
            waveAmplitude={0.36}
            waveFrequency={2.6}
            waveSpeed={0.016}
            pixelSize={4}
            colorNum={4}
          />
        </Suspense>

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>

        {data.meta.sample && (
          <p className="fixed top-3 right-3 z-40 rounded-md border border-cut-rule bg-cut-soft/80 px-2.5 py-1.5 text-sm leading-tight font-medium text-ink backdrop-blur-md">
            Sample data — not pipeline output
          </p>
        )}

        <SectionNav />

        <Hero data={data} />

        {/* Order is load-bearing. The funnel is the argument and it autoplays,
            so it comes first; the patient panel then answers the question it
            raises, and still precedes the ranked list. */}
        {/* Three acts, not eight equal boxes. Every panel was the same width,
            padding and heading size, so the knowledge graph weighed exactly
            what the metrics list did and the page read as a stack rather than
            an argument. Grouping also opens real gaps between the acts, which
            is where the dither is actually visible. */}
        <main id="main" className="mx-auto max-w-[76rem] space-y-16 px-6 pb-20">
          {/* The claim: what we did, and to whom. */}
          <div className="space-y-6">
            <Panel className="p-7">
              <KeyFigures data={data} />
            </Panel>

            <Panel className="p-8">
              <FunnelRun funnel={data.funnel} onShowCuts={showCuts} />
            </Panel>

            {data.patient_profile && (
              <Reveal>
                <Panel className="p-8">
                  <PatientPanel profile={data.patient_profile} />
                </Panel>
              </Reveal>
            )}
          </div>

          {/* The evidence: why these drugs, and what each one carries. */}
          <div className="space-y-6">
            <Reveal>
              <Panel className="p-8">
                <KnowledgeGraph candidates={data.candidates} />
              </Panel>
            </Reveal>

            <Reveal>
              <Panel className="p-8">
                <CandidatesSection
                  candidates={data.candidates}
                  requestedView={requestedView}
                />
              </Panel>
            </Reveal>
          </div>

          {/* The proof: including the parts that don't flatter us. */}
          <div className="space-y-6">
            <Reveal>
              <Panel className="p-7">
                <GraveyardPartition entries={data.graveyard} />
              </Panel>
            </Reveal>

            <Reveal>
              <Panel className="p-7">
                <ValidationPanel validation={data.validation} />
              </Panel>
            </Reveal>

            <Reveal>
              <Panel className="p-7">
                <PipelineProvenance
                  stages={STAGES}
                  sources={SOURCES}
                  stats={buildStats(data)}
                />
              </Panel>
            </Reveal>
          </div>
        </main>

        <footer className="mx-auto max-w-[76rem] px-6 pb-10">
          <p className="text-xs leading-normal text-ink-faint">
            {num(data.meta.n_input)} approved substances screened · generated{" "}
            <span className="readout">
              {generated.toISOString().slice(0, 16).replace("T", " ")} UTC
            </span>{" "}
            · research prototype, not clinical advice.
          </p>
        </footer>
      </div>
    </TooltipProvider>
  );
}
