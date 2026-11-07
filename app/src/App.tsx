import type { Pipeline } from "@/lib/contract";
import { pipelineResult } from "@/lib/pipeline";
import { useFunnelRun } from "@/hooks/useFunnelRun";
import { STAGES, SOURCES, buildStats } from "@/lib/provenance";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContractError } from "@/components/ContractError";
import { AuroraBackground } from "@/components/AuroraBackground";
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
  const run = useFunnelRun(data.funnel.length);
  const generated = new Date(data.meta.generated_at);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="relative min-h-dvh">
        <AuroraBackground />

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
        <main id="main" className="mx-auto max-w-[84rem] space-y-6 px-6 pb-20">
          <Panel className="p-7">
            <KeyFigures data={data} />
          </Panel>

          <Panel className="p-7">
            <FunnelRun
              funnel={data.funnel}
              revealed={run.revealed}
              isRunning={run.isRunning}
              onReplay={run.replay}
            />
          </Panel>

          {data.patient_profile && (
            <Reveal>
              <Panel className="p-7">
                <PatientPanel profile={data.patient_profile} />
              </Panel>
            </Reveal>
          )}

          <Reveal>
            <Panel className="p-7">
              <KnowledgeGraph candidates={data.candidates} />
            </Panel>
          </Reveal>

          <Reveal>
            <Panel className="p-7">
              <CandidatesSection candidates={data.candidates} />
            </Panel>
          </Reveal>

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
        </main>

        <footer className="mx-auto max-w-[84rem] px-6 pb-10">
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
