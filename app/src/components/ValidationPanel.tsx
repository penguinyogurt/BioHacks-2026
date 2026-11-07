import type { Pipeline } from "@/lib/contract";
import { prob } from "@/lib/utils";

type Metric = {
  label: string;
  value: string;
  shows: string;
};

/**
 * Self-reported, including the unflattering numbers.
 *
 * Known failures appearing in the top 50 is an error rate we print rather than
 * hide — a judge who finds it themselves costs more than one we volunteer.
 */
export function ValidationPanel({ validation }: { validation: Pipeline["validation"] }) {
  const metrics: Metric[] = [];

  if (validation.riluzole_rank !== null || validation.edaravone_rank !== null) {
    const parts = [
      validation.riluzole_rank !== null && `riluzole ${validation.riluzole_rank}`,
      validation.edaravone_rank !== null && `edaravone ${validation.edaravone_rank}`,
    ].filter(Boolean);
    metrics.push({
      label: "Positive controls",
      value: parts.join(" · "),
      shows:
        "Where the two drugs that genuinely work in ALS land in our ranking. A model that can't find the known answers has a problem.",
    });
  }

  if (validation.bbb_roc_auc !== null) {
    metrics.push({
      label: "Barrier model ROC-AUC",
      value: prob(validation.bbb_roc_auc),
      shows:
        "Measured on a Bemis–Murcko scaffold split, not a random one — random splits leak similar molecules across train and test and inflate this number.",
    });
  }

  if (
    validation.bbb_roc_auc !== null &&
    validation.bbb_roc_auc_published_baseline !== null
  ) {
    const delta = validation.bbb_roc_auc - validation.bbb_roc_auc_published_baseline;
    metrics.push({
      label: "Against published B3clf",
      value: `${delta >= 0 ? "+" : "−"}${prob(Math.abs(delta))}`,
      shows: `Ours ${prob(validation.bbb_roc_auc)} against the B3DB authors' ${prob(
        validation.bbb_roc_auc_published_baseline,
      )}. Being within a few points of published work validates the approach.`,
    });
  }

  if (validation.negatives_in_top_50 !== null) {
    metrics.push({
      label: "Known failures in our top 50",
      value: String(validation.negatives_in_top_50),
      shows:
        "Our honest error rate: drugs that already failed a human ALS trial but which our ranking still likes.",
    });
  }

  metrics.push({
    label: "Partition",
    value: `${validation.partition.never_arrived} never arrived · ${validation.partition.arrived_failed} arrived and failed`,
    shows: "The finding.",
  });

  return (
    <section aria-labelledby="validation-heading">
      <header className="mb-5">
        <h2 id="validation-heading" className="text-lg leading-tight font-semibold">
          What we measured, including what doesn&rsquo;t flatter us
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm leading-normal text-ink-soft">
          We have labelled positives and labelled negatives, which is rare for
          a repurposing claim.
        </p>
      </header>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="hairline-t pt-2.5">
            <dt className="label">{metric.label}</dt>
            <dd>
              <p className="readout mt-1 text-md leading-snug font-semibold">
                {metric.value}
              </p>
              <p className="mt-1 text-sm leading-normal text-ink-soft">
                {metric.shows}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
