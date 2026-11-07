import { useEffect, useMemo, useState } from "react";
import type { Candidate, Pipeline, Stage } from "@/lib/contract";
import { isSample } from "@/lib/contract";
import { loadPipeline } from "@/lib/pipeline";
import { buildGraph, type GraphNode } from "@/lib/graph";
import { profileOf } from "@/lib/patient";
import { ContractError } from "@/components/ContractError";
import { AuroraBackground } from "@/components/AuroraBackground";
import { KeyFigures } from "@/components/KeyFigures";
import { PatientPanel } from "@/components/PatientPanel";
import { GraphCanvas } from "@/components/GraphCanvas";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import { ValidationPanel } from "@/components/ValidationPanel";
import { cn, num } from "@/lib/utils";

export default function App() {
  const [problems, setProblems] = useState<string[] | null>(null);
  const [data, setData] = useState<Pipeline | null>(null);

  useEffect(() => {
    void loadPipeline().then((result) => {
      if (result.ok) setData(result.data);
      else setProblems(result.problems);
    });
  }, []);

  if (problems) return <ContractError problems={problems} />;
  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <AuroraBackground />
        <p className="label">Loading the 3,791-compound graph…</p>
      </div>
    );
  }
  return <Report data={data} />;
}

function Report({ data }: { data: Pipeline }) {
  const last = data.funnel[data.funnel.length - 1]?.stage ?? "trial_history";
  const [stage, setStage] = useState<Stage>(last);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const generated = new Date(data.meta.generated_at);
  const graph = useMemo(
    () => buildGraph(data.candidates, data.graveyard, stage),
    [data.candidates, data.graveyard, stage],
  );

  const neighbors = useMemo(() => {
    if (!selected || (selected.kind !== "gene" && selected.kind !== "pathway")) return [];
    const ids = new Set(
      graph.edges
        .filter((e) => e.source === selected.id || e.target === selected.id)
        .flatMap((e) => [e.source, e.target]),
    );
    return graph.nodes
      .filter((n) => n.kind === "drug" && ids.has(n.id) && n.candidate)
      .map((n) => n.candidate as Candidate);
  }, [graph, selected]);

  return (
    <div className="min-h-dvh">
      <AuroraBackground />

      <header className="hairline-b">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-end justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <p className="label">Patient-constrained drug repurposing · ALS</p>
            <h1 className="mt-1.5 max-w-[46ch] text-3xl leading-[1.06]">
              The knowledge graph is the argument
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isSample(data.meta) && (
              <p className="rounded-md border border-cut-rule bg-cut-soft px-2.5 py-1.5 text-sm font-medium">
                Sample data — not pipeline output
              </p>
            )}
            <div className="text-right">
              <span className="label">Generated</span>
              <p className="readout text-sm text-ink-soft">
                {generated.toISOString().slice(0, 16).replace("T", " ")}
                <span className="text-ink-faint"> UTC</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[90rem] px-6 py-5">
        <KeyFigures data={data} />

        <section aria-labelledby="graph-heading" className="mt-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="graph-heading" className="text-xl leading-tight">
                Drug → gene → ALS, then the funnel cuts
              </h2>
              <p className="mt-1 max-w-[68ch] text-sm leading-normal text-ink-soft">
                Nodes are drugs, genes, pathways, ALS, patient-filter failures and
                graveyard buckets. The chips below filter this graph — they are not a
                second wall of cards.
              </p>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-ink" /> drug / ALS
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-ink-soft" /> gene
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-cut" /> eliminated
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-bucket-never" /> graveyard
              </li>
            </ul>
          </div>

          <div
            role="tablist"
            aria-label="Funnel stage"
            className="mb-3 grid grid-cols-5 gap-1.5"
          >
            {data.funnel.map((s) => {
              const on = s.stage === stage;
              return (
                <button
                  key={s.stage}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-stage={s.stage}
                  onClick={() => {
                    setStage(s.stage);
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors duration-150 ease-out",
                    on
                      ? "border-ink bg-surface"
                      : "border-rule bg-paper hover:border-rule-strong",
                  )}
                >
                  <span className="label">{s.label}</span>
                  <span className="readout mt-1 block text-xl leading-none font-semibold">
                    {num(s.count)}
                  </span>
                  {s.eliminated > 0 && (
                    <span className="mt-1 block text-xs text-cut">
                      −{num(s.eliminated)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid min-h-[680px] overflow-hidden rounded-lg border border-rule bg-surface-sunk/40 lg:grid-cols-[minmax(0,1fr)_24.5rem]">
            <div className="relative h-[680px] bg-paper/40">
              <GraphCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            </div>
            <ReceiptPanel
              node={selected}
              neighbors={neighbors}
              graveyard={data.graveyard}
            />
          </div>
        </section>

        <div className="mt-8">
          <PatientPanel profile={profileOf(data)} />
        </div>

        <div className="mt-8">
          <ValidationPanel validation={data.validation} />
        </div>
      </main>
    </div>
  );
}
