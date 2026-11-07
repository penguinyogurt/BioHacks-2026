import { motion } from "motion/react";
import type { Candidate } from "@/lib/contract";
import { firstFailure, passCount } from "@/lib/contract";
import { cn, prob } from "@/lib/utils";
import { MoleculeView } from "./MoleculeView";
import { PathGraph } from "./PathGraph";

const STAGE_LABEL: Record<string, string> = {
  universe: "the universe",
  kg_relevance: "KG relevance",
  bbb: "the barrier gate",
  patient_filter: "the patient filter",
  trial_history: "trial history",
};

function BbbReadout({ bbb }: { bbb: Candidate["bbb"] }) {
  // in_domain === false means the model has no standing to predict on this
  // molecule. We show the distance that disqualified it, never a number the
  // model can't stand behind.
  if (!bbb.in_domain || bbb.prob === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">Barrier permeability</span>
          <span className="text-[0.8125rem] font-medium text-ink-faint">
            not predicted
          </span>
        </div>
        <div className="mt-2 rounded-[3px] border border-dashed border-rule-strong bg-surface-sunk px-2.5 py-2">
          <p className="text-[0.8125rem] leading-snug text-ink-soft">
            Outside the model&rsquo;s applicability domain — nearest training
            compound is only{" "}
            <span className="readout font-medium text-ink">
              {prob(bbb.nearest_tanimoto)}
            </span>{" "}
            Tanimoto similar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Barrier permeability</span>
        <span className="readout text-[0.9375rem] leading-none font-semibold">
          {prob(bbb.prob)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunk">
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${bbb.prob * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-normal text-ink-faint">
        in domain · nearest Tanimoto{" "}
        <span className="readout">{prob(bbb.nearest_tanimoto)}</span>
      </p>
    </div>
  );
}

function RuleList({ candidate }: { candidate: Candidate }) {
  const decisive = firstFailure(candidate);
  const { passed, total } = passCount(candidate);

  if (total === 0) {
    return (
      <p className="text-[0.8125rem] leading-snug text-ink-faint">
        Cut before the patient filter ran, so no rules were evaluated.
      </p>
    );
  }

  return (
    <div>
      <span className="label">Patient rules, in order</span>
      <ul className="mt-2 space-y-1">
        {candidate.filters.map((f) => {
          const isDecisive = f === decisive;
          return (
            <li
              key={f.rule}
              className={cn(
                "grid grid-cols-[1rem_6.5rem_1fr] items-baseline gap-2 rounded-[3px] py-0.5 text-[0.8125rem] leading-snug",
                isDecisive && "-mx-1.5 bg-cut-soft px-1.5 py-1",
              )}
            >
              {/* Glyph, not colour alone: the mark carries the state in
                  greyscale and to a screen reader. */}
              <span
                className={cn(
                  "readout text-center",
                  f.passed ? "text-keep" : "text-cut",
                )}
                aria-hidden="true"
              >
                {f.passed ? "✓" : "✕"}
              </span>
              <span className="readout truncate text-ink-soft" title={f.rule}>
                {f.rule}
              </span>
              <span className={cn(f.passed ? "text-ink-soft" : "font-medium text-ink")}>
                <span className="sr-only">{f.passed ? "Passed: " : "Failed: "}</span>
                {f.reason}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="hairline-t mt-2 flex items-baseline justify-between pt-1.5">
        <span className="label">Rules cleared</span>
        <span
          className={cn(
            "readout text-[0.8125rem] font-semibold",
            passed === total ? "text-keep" : "text-cut",
          )}
        >
          {passed}/{total}
        </span>
      </div>
    </div>
  );
}

export function CandidateCard({ candidate, index }: { candidate: Candidate; index: number }) {
  const eliminated = candidate.verdict === "eliminated";
  const skeleton = candidate.inchikey.split("-")[0];

  return (
    <motion.article
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-surface p-4",
        eliminated ? "border-cut-rule" : "border-rule",
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.26,
        ease: [0.23, 1, 0.32, 1],
        // Stagger stays short; long cascades read as slow, not as polish.
        delay: Math.min(index * 0.05, 0.4),
      }}
    >
      <header className="hairline-b flex items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] leading-tight font-semibold capitalize">
            {candidate.name}
          </h3>
          <p className="readout mt-1 truncate text-[0.75rem] text-ink-faint">
            {candidate.id} · {skeleton}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span className="label">Rank</span>
          <div className="readout text-[0.9375rem] leading-none font-semibold">
            {candidate.kg.rank}
          </div>
        </div>
      </header>

      {eliminated && candidate.eliminated_at && (
        <p className="-mt-1 flex items-baseline gap-1.5 text-[0.8125rem] leading-snug">
          <span
            className="mt-[0.3rem] size-1.5 shrink-0 rounded-full bg-cut"
            aria-hidden="true"
          />
          <span className="text-ink-soft">
            Eliminated at{" "}
            <span className="font-medium text-ink">
              {STAGE_LABEL[candidate.eliminated_at] ?? candidate.eliminated_at}
            </span>
          </span>
        </p>
      )}

      <MoleculeView smiles={candidate.smiles} name={candidate.name} height={108} />

      <BbbReadout bbb={candidate.bbb} />

      <dl className="grid grid-cols-4 gap-2 rounded-[3px] bg-surface-sunk px-2.5 py-2">
        {(
          [
            ["MW", candidate.bbb.descriptors.mw],
            ["logP", candidate.bbb.descriptors.logp],
            ["TPSA", candidate.bbb.descriptors.tpsa],
            ["HBD", candidate.bbb.descriptors.hbd],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="label">{label}</dt>
            <dd className="readout mt-0.5 text-[0.8125rem] font-medium">
              {/* Minus sign, not hyphen: logP of −1.3 is a number, not a range. */}
              {String(value).replace("-", "−")}
            </dd>
          </div>
        ))}
      </dl>

      <PathGraph path={candidate.path} />
      <RuleList candidate={candidate} />
    </motion.article>
  );
}
