import type { Candidate, GraveyardEntry } from "@/lib/contract";
import { isSurvivor } from "@/lib/contract";
import type { GraphNode } from "@/lib/graph";
import { CandidateCard } from "./CandidateCard";
import { PredictDock } from "./PredictDock";
import { num, prob } from "@/lib/utils";

type Props = {
  node: GraphNode | null;
  neighbors: Candidate[];
  graveyard: GraveyardEntry[];
};

function BucketReceipt({
  bucket,
  entries,
}: {
  bucket: GraveyardEntry["bucket"];
  entries: GraveyardEntry[];
}) {
  const title = bucket === "never_arrived" ? "Never arrived" : "Arrived and still failed";
  return (
    <div>
      <p className="label">Graveyard</p>
      <h3 className="mt-1 text-lg leading-tight font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-soft">
        {num(entries.length)} failed ALS trials in this bucket.
      </p>
      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={`${e.name}-${e.year}`} className="hairline-t pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium capitalize">{e.name}</span>
              <span className="readout text-xs text-ink-faint">
                {e.year} · phase {e.phase}
              </span>
            </div>
            <p className="mt-1 text-sm leading-snug text-ink-soft">{e.note}</p>
            <p className="mt-1 readout text-xs text-ink-faint">
              {e.bbb_prob == null ? "BBB not predicted" : `BBB ${prob(e.bbb_prob)}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReceiptPanel({ node, neighbors, graveyard }: Props) {
  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-rule bg-surface/60 px-5 py-5">
      {!node && (
        <div>
          <p className="label">Receipt</p>
          <h3 className="mt-1 text-lg leading-tight font-semibold">Click a node</h3>
          <p className="mt-2 max-w-[36ch] text-sm leading-normal text-ink-soft">
            Drugs carry BBB probability, descriptors, the 2-hop path, and ordered
            filter reasons. Out-of-domain molecules show no probability.
          </p>
        </div>
      )}

      {node?.kind === "als" && (
        <div>
          <p className="label">Disease</p>
          <h3 className="mt-1 text-lg font-semibold">Amyotrophic lateral sclerosis</h3>
          <p className="mt-2 text-sm leading-normal text-ink-soft">
            Hub of the graph. Edges are typed DRKG relations, not decoration.
            Funnel chips change which drugs and cuts are drawn.
          </p>
        </div>
      )}

      {node?.kind === "drug" && node.candidate && (
        <CandidateCard candidate={node.candidate} index={0} />
      )}

      {node?.kind === "gene" || node?.kind === "pathway" ? (
        <div>
          <p className="label">{node.kind}</p>
          <h3 className="mt-1 text-lg font-semibold">{node.label}</h3>
          <p className="mt-2 text-sm text-ink-soft">
            {neighbors.length === 0
              ? "No visible drugs currently attach to this node."
              : `${neighbors.length} drug${neighbors.length === 1 ? "" : "s"} in this view:`}
          </p>
          <ul className="mt-3 space-y-1.5">
            {neighbors.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="capitalize">{c.name}</span>
                <span className="readout text-xs text-ink-faint">
                  rank {c.kg.rank}
                  {isSurvivor(c) ? "" : ` · cut ${c.eliminated_at}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {node?.kind === "bucket" && node.bucket && (
        <BucketReceipt
          bucket={node.bucket}
          entries={graveyard.filter((g) => g.bucket === node.bucket)}
        />
      )}

      {node?.kind === "rule" && (
        <div>
          <p className="label">Patient-filter rule</p>
          <h3 className="mt-1 text-lg font-semibold">{node.label}</h3>
          <p className="mt-2 text-sm text-ink-soft">
            Drugs that failed this rule on Alex&rsquo;s chart. Click a drug node for the
            ordered reasons.
          </p>
        </div>
      )}

      <PredictDock />
    </aside>
  );
}
