import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Candidate } from "@/lib/contract";
import { CandidateCard } from "./CandidateCard";
import { cn } from "@/lib/utils";

type ViewKey = "survived" | "patient_filter" | "trial_history" | "bbb";

const VIEWS: { key: ViewKey; label: string; empty: string }[] = [
  {
    key: "survived",
    label: "Survived every stage",
    empty: "Nothing survived every stage.",
  },
  {
    key: "patient_filter",
    label: "Cut by the patient filter",
    empty: "No candidate was cut by the patient filter.",
  },
  {
    key: "bbb",
    label: "Cut at the barrier",
    empty: "No candidate was cut at the barrier gate.",
  },
  {
    key: "trial_history",
    label: "Already failed a trial",
    empty: "No candidate was cut on trial history.",
  },
];

function select(candidates: Candidate[], view: ViewKey): Candidate[] {
  const picked =
    view === "survived"
      ? candidates.filter((c) => c.verdict === "survived")
      : candidates.filter((c) => c.eliminated_at === view);
  return picked.toSorted((a, b) => a.kg.rank - b.kg.rank);
}

export function CandidatesSection({ candidates }: { candidates: Candidate[] }) {
  const [view, setView] = useState<ViewKey>("survived");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        VIEWS.map((v) => [v.key, select(candidates, v.key).length]),
      ) as Record<ViewKey, number>,
    [candidates],
  );

  const shown = useMemo(() => select(candidates, view), [candidates, view]);
  const active = VIEWS.find((v) => v.key === view);

  return (
    <section aria-labelledby="candidates-heading" className="hairline-b pb-10">
      <header className="mb-5">
        <h2 id="candidates-heading" className="text-[1.0625rem] leading-tight font-semibold">
          Every surviving drug carries its receipt
        </h2>
        <p className="mt-1 max-w-[66ch] text-[0.8125rem] leading-normal text-ink-soft">
          The graph path that connected it to ALS, the barrier prediction with
          its applicability check, and which patient rules it cleared — in rule
          order, first failure highlighted.
        </p>
      </header>

      {/* These are filters, not tabs: there is one list, not four panels.
          role="tab" without a tabpanel promises arrow-key navigation that
          doesn't exist and makes aria-selected invalid. Native buttons with
          aria-pressed say exactly what these do, and need no keyboard code. */}
      <div
        role="group"
        aria-label="Filter candidates by outcome"
        className="mb-5 flex flex-wrap gap-1.5"
      >
        {VIEWS.map((v) => {
          const isActive = v.key === view;
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setView(v.key)}
              className={cn(
                "flex items-baseline gap-2 rounded-md border px-2.5 py-1.5",
                "text-[0.8125rem] font-medium",
                "transition-[transform,background-color,border-color,color] duration-150 ease-out",
                "active:scale-[0.97]",
                isActive
                  ? "border-ink bg-ink text-paper"
                  : "border-rule-strong bg-surface text-ink-soft hover:bg-surface-sunk hover:text-ink",
              )}
            >
              {v.label}
              <span
                className={cn(
                  "readout text-[0.75rem]",
                  isActive ? "text-paper/70" : "text-ink-faint",
                )}
              >
                {counts[v.key]}
              </span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-[0.875rem] leading-normal text-ink-faint">{active?.empty}</p>
      ) : (
        <motion.div
          layout="position"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((candidate, i) => (
              <motion.div
                key={candidate.inchikey}
                layout
                // Exit is faster than enter, and blurs as it leaves: the eye
                // reads one object departing rather than two overlapping.
                exit={{
                  opacity: 0,
                  y: -12,
                  filter: "blur(4px)",
                  transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
                }}
              >
                <CandidateCard candidate={candidate} index={i} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}
