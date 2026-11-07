import { motion } from "motion/react";
import type { Candidate } from "@/lib/contract";
import { firstFailure, passCount } from "@/lib/contract";
import { cn, prob } from "@/lib/utils";
import { MoleculeView } from "./MoleculeView";
import { PathGraph } from "./PathGraph";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * What the four descriptors mean, in terms of the barrier question.
 *
 * These are the features the classifier actually reads, so explaining them
 * explains the model — a judge who isn't a chemist can otherwise only take
 * the probability on faith.
 */
const DESCRIPTOR_HELP = {
  MW: "Molecular weight, in daltons. Large molecules cross the blood–brain barrier poorly; above roughly 500 it becomes unlikely.",
  logP: "Lipophilicity — how much the molecule prefers fat to water. The barrier wants moderately greasy: too polar can't enter the membrane, too greasy never leaves it.",
  TPSA: "Topological polar surface area, in square ångströms. Polar surface has to shed its water to cross; above roughly 90 Å² is a strong signal against it.",
  HBD: "Hydrogen-bond donors. Each one holds onto water that must be stripped away before the molecule can pass through the membrane.",
} as const;

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
          <span className="text-sm font-medium text-ink-faint">
            not predicted
          </span>
        </div>
        <div className="mt-2 rounded-[3px] border border-dashed border-rule-strong bg-surface-sunk px-2.5 py-2">
          <p className="text-sm leading-snug text-ink-soft">
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
        <span className="readout text-md leading-none font-semibold">
          {prob(bbb.prob)}
        </span>
      </div>
      {/* The threshold is marked because 0.84 means nothing on its own — the
          classifier's decision is "above or below 0.5", and that is the same
          line the partition chart divides the failed trials on. Without it
          the bar is a number with no reference. */}
      <div className="relative mt-2 h-1.5 rounded-full bg-surface-sunk">
        <div
          className={cn(
            "h-full rounded-full",
            bbb.prob >= 0.5 ? "bg-ink" : "bg-ink-faint",
          )}
          style={{ width: `${bbb.prob * 100}%` }}
        />
        <span
          className="absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-rule-strong"
          aria-hidden="true"
        />
      </div>
      <p className="mt-1.5 flex items-baseline justify-between gap-3 text-xs leading-normal text-ink-faint">
        <span>
          in domain · nearest Tanimoto{" "}
          <span className="readout">{prob(bbb.nearest_tanimoto)}</span>
        </span>
        <span className={bbb.prob >= 0.5 ? "text-ink-soft" : "text-cut"}>
          {bbb.prob >= 0.5 ? "crosses" : "cannot cross"}
        </span>
      </p>
    </div>
  );
}

function RuleList({ candidate }: { candidate: Candidate }) {
  const decisive = firstFailure(candidate);
  const { passed, total } = passCount(candidate);

  if (total === 0) {
    return (
      <p className="text-sm leading-snug text-ink-faint">
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
                "grid grid-cols-[1rem_9rem_1fr] items-baseline gap-2 rounded-[3px] py-0.5 text-sm leading-snug",
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
            "readout text-sm font-semibold",
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
      // whileInView, not animate: on load this grid sits ~2,700px below the
      // fold, so an entrance keyed to mount finished long before anyone
      // scrolled to it. The Reveal wrapper hides it meanwhile, which is not
      // the same as pausing it.
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: 0.26,
        ease: [0.23, 1, 0.32, 1],
        // Stagger stays short; long cascades read as slow, not as polish.
        delay: Math.min(index * 0.05, 0.4),
      }}
    >
      <header className="hairline-b flex items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h3
            className="truncate text-md leading-tight font-semibold capitalize"
            title={candidate.name}
          >
            {candidate.name}
          </h3>
          <p className="readout mt-1 truncate text-xs text-ink-faint">
            {candidate.id} · {skeleton}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span className="label">Rank</span>
          <div className="readout text-md leading-none font-semibold">
            {candidate.kg.rank}
          </div>
        </div>
      </header>

      {eliminated && candidate.eliminated_at && (
        <p className="-mt-1 flex items-baseline gap-1.5 text-sm leading-snug">
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
            ["MW", candidate.bbb.descriptors.mw, DESCRIPTOR_HELP.MW],
            ["logP", candidate.bbb.descriptors.logp, DESCRIPTOR_HELP.logP],
            ["TPSA", candidate.bbb.descriptors.tpsa, DESCRIPTOR_HELP.TPSA],
            ["HBD", candidate.bbb.descriptors.hbd, DESCRIPTOR_HELP.HBD],
          ] as const
        ).map(([label, value, help]) => (
          <div key={label}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A button, not a bare span: the explanation has to be
                    reachable by keyboard, and these four numbers are
                    meaningless to a judge who isn't a chemist. */}
                {/* min-h-6 with a negative margin: WCAG 2.2 wants a 24px
                    target and these measured 22.6x13.2. The margin keeps the
                    row's visual height unchanged. */}
                <button
                  type="button"
                  className="label -my-[5px] inline-flex min-h-6 cursor-help items-center underline decoration-rule-strong decoration-dotted underline-offset-[3px] hover:text-ink-soft focus-visible:text-ink-soft"
                >
                  {label}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[22rem] text-pretty">
                {help}
              </TooltipContent>
            </Tooltip>
            <dd className="readout mt-0.5 text-sm font-medium">
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
