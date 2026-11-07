import { motion, useReducedMotion } from "motion/react";
import type { PatientFinding, PatientProfile } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * The person before the ranked list.
 *
 * Stage 4 is the contribution, and it's only credible if a judge can see the
 * chart values it was derived from. So the section is wired rather than
 * tabulated: each measurement on the left, the rule id it creates on a rail to
 * the right, a hairline between them. The relationship — "FVC 61% supine"
 * *causes* `respiratory` — is the whole argument, so it is drawn, not
 * captioned.
 *
 * Nothing clinical is hardcoded here. `patient_profile` carries the values and
 * the rule ids; the only thing this file adds is where a number sits on a
 * track, and it draws that track solely from numbers present in the value
 * string itself (a before → after, a stated reference limit, a percentage of
 * predicted). A finding whose string carries no comparator gets no bar — a
 * scale the chart didn't give is a scale we'd be inventing.
 */

/** The project's --ease-out. */
const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Column geometry. The rail is drawn on each row at this offset from the right
 * edge, so it has to match the last grid column exactly — change both.
 */
const GRID = "md:grid-cols-[minmax(0,34rem)_minmax(2.5rem,1fr)_9.5rem] mx-auto w-full max-w-[56rem]";
const RAIL = "md:right-[9.5rem]";

/**
 * Where a measurement sits, read out of the value string.
 *
 * One shape covers all three cases, because they share a reading: `held` is
 * where he is now or where normal ends, `strained` is the far end of the gap
 * the chart records, and the rest of the track is headroom.
 */
type Measure = { max: number; held: number; strained: number };

function readMeasure(value: string): Measure | null {
  // 86 → 77.5 kg: ink to the current weight, the lost 8.5 kg as the gap.
  const drift = value.match(/(\d+(?:\.\d+)?)\s*(?:→|->)\s*(\d+(?:\.\d+)?)/);
  if (drift) {
    const a = Number(drift[1]);
    const b = Number(drift[2]);
    const hi = Math.max(a, b);
    return hi > 0 ? { max: hi, held: Math.min(a, b), strained: hi } : null;
  }

  // 470 U/L (ref < 195): ink to the upper limit of normal, the excess beyond
  // it as the gap. Only the over-the-limit direction is drawn; a value inside
  // its reference range has no finding to show.
  const ref = value.match(/(\d+(?:\.\d+)?)[^()]*\(\s*ref\s*<\s*(\d+(?:\.\d+)?)/i);
  if (ref) {
    const v = Number(ref[1]);
    const limit = Number(ref[2]);
    if (v > limit && limit > 0) return { max: v * 1.1, held: limit, strained: v };
    return null;
  }

  // FVC 76% sitting, 61% supine: percent of predicted on a 0–100 track, ink to
  // the worse reading, the spread between the two as the gap.
  const pct = [...value.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n <= 100);
  if (pct.length > 0) {
    return { max: 100, held: Math.min(...pct), strained: Math.max(...pct) };
  }

  return null;
}

/**
 * The number against where it should be.
 *
 * Decorative in the strict sense: it restates a value the mono readout above
 * it already spells out, so it is hidden from assistive technology rather than
 * given an invented label.
 */
function Gauge({ m, delay }: { m: Measure; delay: number }) {
  const reduce = useReducedMotion();
  const held = (m.held / m.max) * 100;
  const strained = (m.strained / m.max) * 100;

  const grow = reduce
    ? {}
    : {
        initial: { scaleX: 0 },
        whileInView: { scaleX: 1 },
        viewport: { once: true, margin: "0px 0px -8px 0px" },
        transition: { duration: 0.55, ease: EASE, delay },
      };

  return (
    <div
      aria-hidden
      className="relative mt-3 h-1 w-full max-w-[20rem] rounded-full bg-surface-sunk"
    >
      {/* The gap the chart records — the lost kilos, the excess CK, the drop
          from sitting to supine. One accent, and it is the eliminating one. */}
      <motion.span
        className="absolute inset-y-0 left-0 origin-left rounded-full bg-cut-rule"
        style={{ width: `${strained}%` }}
        {...grow}
      />
      <motion.span
        className="absolute inset-y-0 left-0 origin-left rounded-full bg-ink"
        style={{ width: `${held}%` }}
        {...grow}
      />
      {/* Tick at the far edge of the gap, so the eye has a hard stop to read
          the bar against rather than a fading band. */}
      <span
        className="absolute -top-1 -bottom-1 w-px bg-cut"
        style={{ left: `calc(${strained}% - 0.5px)` }}
      />
    </div>
  );
}

function Row({ finding, index }: { finding: PatientFinding; index: number }) {
  const m = readMeasure(finding.value);
  const wired = finding.drives.length > 0;
  // A quantified finding carries a number and a bar, so it gets the larger
  // readout. Six equal cells flattened the difference between a measurement
  // and an observation; this lets the chart's own numbers lead.
  const size = m ? "text-xl" : "text-md";

  return (
    <li className={cn("group relative grid gap-y-3 py-5 hairline-t", GRID)}>
      {/* The rail. Each row draws its own segment over its full height,
          padding included, so any number of rows forms one continuous line. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 hidden w-px bg-rule-strong md:block", RAIL)}
      />

      <div className="min-w-0 md:col-span-2">
        <p className="label">{finding.label}</p>

        {/* The wire leaves the measurement itself and ends on the rail beside
            the rule id, so the causal link is drawn rather than captioned. */}
        <div className="mt-1.5 flex items-center gap-4">
          <p className={cn("readout font-medium leading-snug", size)}>
            {finding.value.replace(/(\s)-(\d)/g, "$1−$2")}
          </p>
          {wired && (
            <span aria-hidden className="hidden flex-1 items-center md:flex">
              <span className="h-px flex-1 bg-rule-strong transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:bg-ink-faint" />
              {/* The junction. A line that merely reaches the rail reads as a
                  stray hairline; a terminated one reads as a connection. */}
              <span className="-mr-[3px] size-1.5 shrink-0 rounded-full bg-ink-faint transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:bg-ink" />
            </span>
          )}
        </div>

        {m && <Gauge m={m} delay={0.06 * index} />}
        <p className="mt-2.5 max-w-[52ch] text-sm leading-normal text-ink-soft">
          {finding.implication}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-1.5 md:pt-4.5 md:pl-3">
        <span className="label mr-1 md:hidden">Drives</span>
        {wired ? (
          finding.drives.map((rule) => (
            <span
              key={rule}
              className="readout rounded border border-rule bg-surface-sunk px-1.5 py-1 text-label text-ink-soft transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:border-rule-strong group-hover:text-ink"
            >
              {rule}
            </span>
          ))
        ) : (
          <span className="text-label text-ink-faint">No rule</span>
        )}
      </div>
    </li>
  );
}

export function PatientPanel({ profile }: { profile: PatientProfile }) {
  return (
    <section aria-labelledby="patient-heading">
      <header className="mb-6">
        <h2 id="patient-heading" className="text-2xl leading-tight">
          The constraints are {profile.display_name}&rsquo;s, not the disease&rsquo;s
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-sm leading-normal text-ink-soft">
          {profile.summary}
        </p>
      </header>

      {/* Two words carry the section: one column is his chart, the other is
          the rule set the funnel runs. Everything between them is the wire. */}
      <div className={cn("hidden items-baseline md:grid", GRID)}>
        <span className="label">Measured in his chart</span>
        <span />
        <span className="label">Rule it creates at stage 4</span>
      </div>

      <ul>
        {profile.findings.map((finding, i) => (
          <Row key={finding.label} finding={finding} index={i} />
        ))}
      </ul>
    </section>
  );
}
