import type { Pipeline } from "@/lib/contract";
import { pipelineResult } from "@/lib/pipeline";
import { useFunnelRun } from "@/hooks/useFunnelRun";
import { ContractError } from "@/components/ContractError";
import { KeyFigures } from "@/components/KeyFigures";
import { PatientPanel } from "@/components/PatientPanel";
import { FunnelRun } from "@/components/FunnelRun";
import { CandidatesSection } from "@/components/CandidatesSection";
import { GraveyardPartition } from "@/components/GraveyardPartition";
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
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-[0.8125rem] focus:text-paper"
      >
        Skip to content
      </a>

      <header className="hairline-b">
        <div className="mx-auto flex max-w-[84rem] flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <p className="label">Patient-constrained drug repurposing · ALS</p>
            <h1 className="mt-2 max-w-[58ch] text-[1.5rem] leading-[1.15] font-semibold">
              Rank approved drugs against ALS biology, then disqualify what is
              unusable for one person
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {data.meta.sample && (
              <p className="rounded-md border border-cut-rule bg-cut-soft px-2.5 py-1.5 text-[0.8125rem] leading-tight font-medium text-ink">
                Sample data — not pipeline output
              </p>
            )}
            <div className="text-right">
              <span className="label">Generated</span>
              <p className="readout text-[0.8125rem] text-ink-soft">
                {generated.toISOString().slice(0, 16).replace("T", " ")}
                <span className="text-ink-faint"> UTC</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Order is load-bearing. The funnel is the argument and it autoplays,
          so it has to finish above the fold at 1440×900 — which it only does
          with the patient panel below it. "Alex before the drugs" is still
          honoured: he precedes the ranked list, and the funnel raises the
          question his panel immediately answers. */}
      <main id="main" className="mx-auto max-w-[84rem] space-y-8 px-6 py-6">
        <KeyFigures data={data} />

        <FunnelRun
          funnel={data.funnel}
          revealed={run.revealed}
          isRunning={run.isRunning}
          onReplay={run.replay}
        />

        {data.patient_profile && <PatientPanel profile={data.patient_profile} />}

        <CandidatesSection candidates={data.candidates} />
        <GraveyardPartition entries={data.graveyard} />
        <ValidationPanel validation={data.validation} />
      </main>

      <footer className="hairline-t">
        <div className="mx-auto max-w-[84rem] px-6 py-6">
          <p className="text-[0.75rem] leading-normal text-ink-faint">
            {num(data.meta.n_input)} approved substances screened · knowledge
            graph DRKG · barrier labels B3DB · formulations, targets and adverse
            events DrugCentral · availability Health Canada DPD. Research
            prototype, not clinical advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
