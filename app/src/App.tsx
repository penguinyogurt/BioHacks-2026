import { pipelineResult } from "@/lib/pipeline";
import { useFunnelRun } from "@/hooks/useFunnelRun";
import { ContractError } from "@/components/ContractError";
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

  const { meta, patient_profile, funnel, candidates, graveyard, validation } =
    pipelineResult.data;

  return <Report
    meta={meta}
    profile={patient_profile}
    funnel={funnel}
    candidates={candidates}
    graveyard={graveyard}
    validation={validation}
  />;
}

type ReportProps = {
  meta: Extract<typeof pipelineResult, { ok: true }>["data"]["meta"];
  profile: Extract<typeof pipelineResult, { ok: true }>["data"]["patient_profile"];
  funnel: Extract<typeof pipelineResult, { ok: true }>["data"]["funnel"];
  candidates: Extract<typeof pipelineResult, { ok: true }>["data"]["candidates"];
  graveyard: Extract<typeof pipelineResult, { ok: true }>["data"]["graveyard"];
  validation: Extract<typeof pipelineResult, { ok: true }>["data"]["validation"];
};

/**
 * Hooks can't live behind the early return in App, so the report body is its
 * own component. Keeps the contract failure a real screen instead of a crash.
 */
function Report({ meta, profile, funnel, candidates, graveyard, validation }: ReportProps) {
  const run = useFunnelRun(funnel.length);
  const generated = new Date(meta.generated_at);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-[0.8125rem] focus:text-paper"
      >
        Skip to content
      </a>

      <header className="hairline-b">
        <div className="mx-auto flex max-w-[84rem] flex-wrap items-end justify-between gap-4 px-6 pt-10 pb-6">
          <div>
            <p className="label">Patient-constrained drug repurposing · ALS</p>
            <h1 className="mt-2 max-w-[34ch] text-[1.5rem] leading-[1.15] font-semibold">
              Rank approved drugs against ALS biology, then disqualify what is
              unusable for one person
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {meta.sample && (
              <p
                className="rounded-md border border-cut-rule bg-cut-soft px-2.5 py-1.5 text-[0.8125rem] leading-tight font-medium text-ink"
                role="status"
              >
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

      <main id="main" className="mx-auto max-w-[84rem] space-y-10 px-6 py-10">
        {profile && <PatientPanel profile={profile} />}

        <FunnelRun
          funnel={funnel}
          revealed={run.revealed}
          isRunning={run.isRunning}
          onReplay={run.replay}
        />

        <CandidatesSection candidates={candidates} />
        <GraveyardPartition entries={graveyard} />
        <ValidationPanel validation={validation} />
      </main>

      <footer className="hairline-t">
        <div className="mx-auto max-w-[84rem] px-6 py-6">
          <p className="text-[0.75rem] leading-normal text-ink-faint">
            {num(meta.n_input)} approved substances screened · knowledge graph
            DRKG · barrier labels B3DB · formulations, targets and adverse
            events DrugCentral · availability Health Canada DPD. Research
            prototype, not clinical advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
