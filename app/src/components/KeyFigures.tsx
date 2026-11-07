import type { Pipeline } from "@/lib/contract";
import { CountUp } from "./CountUp";

/**
 * The four numbers that carry the whole argument, above the fold.
 *
 * A judge has about ninety seconds and arrives mid-conversation. The funnel
 * explains how we got here, but it takes three seconds to run — this says
 * where it lands before it starts, so nobody has to wait to understand the
 * claim.
 */

/** `count` animates from zero; `value` is rendered as-is. */
type Figure = {
  count?: number;
  value?: string;
  label: string;
  note: string;
};

function build(data: Pipeline): Figure[] {
  const first = data.funnel[0];
  const last = data.funnel[data.funnel.length - 1];
  const patientStage = data.funnel.find((s) => s.stage === "patient_filter");
  const { never_arrived, arrived_failed } = data.validation.partition;

  const figures: Figure[] = [
    {
      count: first?.count ?? data.meta.n_input,
      label: "Approved drugs screened",
      note: "Every human-approved substance with a structure",
    },
    {
      count: last?.count ?? 0,
      label: "Viable for Alex",
      note: "Survived all five stages, receipts attached",
    },
  ];

  if (patientStage && patientStage.eliminated > 0) {
    figures.push({
      count: patientStage.eliminated,
      label: "Removed by his chart alone",
      note: "Would have passed every other stage",
    });
  }

  const partitioned = never_arrived + arrived_failed;
  if (partitioned > 0) {
    figures.push({
      value: `${never_arrived} / ${arrived_failed}`,
      label: "Failed trials, partitioned",
      note: "Never reached the tissue vs reached it and failed",
    });
  }

  return figures;
}

export function KeyFigures({ data }: { data: Pipeline }) {
  const figures = build(data);

  return (
    <section aria-label="Headline figures" className="hairline-b pb-8">
      <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="label">{figure.label}</dt>
            <dd>
              <p className="readout mt-1.5 text-3xl leading-none font-semibold tracking-[-0.02em]">
                {figure.count !== undefined ? (
                  <CountUp value={figure.count} />
                ) : (
                  figure.value
                )}
              </p>
              <p className="mt-2 max-w-[28ch] text-sm leading-snug text-ink-soft">
                {figure.note}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
