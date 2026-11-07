import type { GraveyardEntry } from "@/lib/contract";
import { cn, prob } from "@/lib/utils";

/**
 * The headline: every drug that failed a human ALS trial, split by whether the
 * barrier model thinks it ever reached the tissue.
 *
 * Drawn as a single axis of predicted permeability with one point per drug,
 * because the claim is about where each drug sits on that axis — a two-bar
 * count chart would throw away the only variable that matters and show two
 * numbers we already print in the legend.
 */

const BUCKETS = [
  {
    key: "never_arrived" as const,
    title: "Never arrived",
    blurb:
      "Predicted barrier-negative. The trial may have been testing whether a drug works in tissue it could not reach.",
  },
  {
    key: "arrived_failed" as const,
    title: "Arrived and still failed",
    blurb:
      "Predicted barrier-positive. The drug reached the tissue, so the biology was wrong — not the delivery.",
  },
];

export function GraveyardPartition({ entries }: { entries: GraveyardEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="graveyard-heading" className="hairline-b pb-10">
      <header className="mb-6">
        <h2 id="graveyard-heading" className="text-[1.0625rem] leading-tight font-semibold">
          Why {entries.length} failed ALS trials failed, split two ways
        </h2>
        <p className="mt-1 max-w-[70ch] text-[0.8125rem] leading-normal text-ink-soft">
          Each drug placed by its predicted barrier permeability. Nobody has
          published this partition for ALS.
        </p>
      </header>

      <div className="space-y-7">
        {BUCKETS.map((bucket) => {
          const inBucket = entries
            .filter((e) => e.bucket === bucket.key)
            .sort((a, b) => a.bbb_prob - b.bbb_prob);
          if (inBucket.length === 0) return null;

          return (
            <div key={bucket.key}>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-[0.875rem] leading-tight font-semibold">
                  {bucket.title}
                </h3>
                <span className="readout text-[0.8125rem] font-semibold text-ink-soft">
                  {inBucket.length}
                </span>
              </div>
              <p className="mb-4 max-w-[64ch] text-[0.8125rem] leading-normal text-ink-soft">
                {bucket.blurb}
              </p>

              <ul className="space-y-1.5">
                {inBucket.map((entry) => (
                  <li
                    key={`${entry.name}-${entry.year}`}
                    className="grid grid-cols-[10rem_5rem_1fr_3rem] items-center gap-3"
                  >
                    <a
                      href={entry.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "truncate text-[0.8125rem] leading-tight font-medium capitalize underline decoration-rule-strong decoration-1 underline-offset-2",
                        "transition-colors duration-150 ease-out",
                        "hover:[@media(hover:hover)and(pointer:fine)]:decoration-ink",
                      )}
                      title={entry.note}
                    >
                      {entry.name}
                    </a>

                    <span className="readout text-[0.75rem] text-ink-faint">
                      {entry.year} · ph {entry.phase}
                    </span>

                    {/* One shared axis across both buckets, so the positions
                        are comparable between them. */}
                    <div className="relative h-5">
                      <div
                        className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule"
                        aria-hidden="true"
                      />
                      {/* 0.5 is where the classifier stops saying "no". */}
                      <div
                        className="absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-rule-strong"
                        aria-hidden="true"
                      />
                      <div
                        className={cn(
                          "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface",
                          bucket.key === "never_arrived"
                            ? "bg-bucket-never"
                            : "bg-bucket-arrived",
                        )}
                        style={{ left: `${entry.bbb_prob * 100}%` }}
                      />
                    </div>

                    <span className="readout text-right text-[0.8125rem] text-ink-soft">
                      {prob(entry.bbb_prob)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-[10rem_5rem_1fr_3rem] gap-3">
        <span className="label">Predicted</span>
        <span />
        <div className="flex justify-between">
          <span className="label">0.0 — cannot cross</span>
          <span className="label">0.5</span>
          <span className="label">crosses — 1.0</span>
        </div>
        <span />
      </div>
    </section>
  );
}
