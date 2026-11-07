import { motion, useReducedMotion } from "motion/react";
import type { Candidate, Pipeline } from "@/lib/contract";
import { CountUp } from "./CountUp";
import { MoleculeView } from "./MoleculeView";
import { num } from "@/lib/utils";

/**
 * The opening frame.
 *
 * A judge decides whether to stop walking in about two seconds, so the hero
 * states the whole claim as an arithmetic fact rather than describing the
 * project. The numbers are read from the run, not written here — if the
 * pipeline's output changes, the headline changes with it, and it can never
 * say something the page below contradicts.
 */

const EASE = [0.23, 1, 0.32, 1] as const;

/** The best-ranked drug that actually survived — the hero's subject. */
function topSurvivor(candidates: Candidate[]): Candidate | null {
  return (
    candidates
      .filter((c) => c.verdict === "survived")
      .toSorted((a, b) => a.kg.rank - b.kg.rank)[0] ?? null
  );
}

export function Hero({ data }: { data: Pipeline }) {
  const reduceMotion = useReducedMotion();
  const screened = data.funnel[0]?.count ?? data.meta.n_input;
  const survived = data.funnel[data.funnel.length - 1]?.count ?? 0;
  const feature = topSurvivor(data.candidates);

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, ease: EASE, delay },
        };

  return (
    <header className="relative flex min-h-[78svh] flex-col justify-center px-6 py-20">
      <div className="mx-auto grid w-full max-w-[84rem] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div>
        <motion.p className="label" {...rise(0)}>
          BioHacks 2026 · Patient-constrained drug repurposing · ALS
        </motion.p>

        <motion.h1
          className="mt-5 max-w-[20ch] text-[clamp(2.75rem,6.5vw,5.25rem)] leading-[0.98]"
          {...rise(0.08)}
        >
          <CountUp value={screened} className="readout" /> approved drugs.
          <br />
          One chart.{" "}
          <span className="text-keep">
            <CountUp value={survived} className="readout" /> that fit.
          </span>
        </motion.h1>

        <motion.p
          className="mt-7 max-w-[58ch] text-base leading-relaxed text-ink-soft"
          {...rise(0.16)}
        >
          Most repurposing work stops at &ldquo;this drug plausibly treats this
          disease&rdquo;. This asks the next question — can{" "}
          <em className="not-italic text-ink">this person</em> actually take it?
          What he can swallow, what his breathing tolerates, what collides with
          the prescription he is already on.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-ink-faint"
          {...rise(0.24)}
        >
          <span>
            <span className="readout text-ink">{num(data.candidates.length)}</span>{" "}
            candidates carried
          </span>
          <span aria-hidden="true" className="text-rule-strong">
            ·
          </span>
          <span>
            <span className="readout text-ink">{num(data.graveyard.length)}</span>{" "}
            failed trials re-examined
          </span>
          <span aria-hidden="true" className="text-rule-strong">
            ·
          </span>
          <span>every verdict carries its receipt</span>
        </motion.div>
        </div>

        {/* The subject of the sentence, drawn. The references each put one
            object beside the headline; ours should be the molecule the
            pipeline actually picked, named and ranked, so the hero is making
            a specific claim rather than decorating. */}
        {feature && (
          <motion.figure
            className="hidden lg:block"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
          >
            <div className="rounded-xl border border-white/[0.07] bg-surface/40 p-6 backdrop-blur-xl">
              <MoleculeView
                smiles={feature.smiles}
                name={feature.name}
                height={260}
              />
              <figcaption className="mt-4 flex items-baseline justify-between gap-4">
                <div>
                  <p className="label">Top-ranked survivor</p>
                  <p className="mt-1 text-md capitalize">{feature.name}</p>
                </div>
                <p className="readout text-sm text-ink-soft">
                  rank {feature.kg.rank}
                </p>
              </figcaption>
            </div>
          </motion.figure>
        )}
      </div>
    </header>
  );
}
