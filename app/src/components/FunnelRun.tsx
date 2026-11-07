import { motion } from "motion/react";
import type { FunnelStage } from "@/lib/contract";
import { logBarWidth } from "@/lib/pipeline";
import { cn, num } from "@/lib/utils";

type Props = {
  funnel: FunnelStage[];
  revealed: number;
  isRunning: boolean;
  onReplay: () => void;
};

export function FunnelRun({ funnel, revealed, isRunning, onReplay }: Props) {
  const max = funnel[0]?.count ?? 1;
  const final = funnel[funnel.length - 1];

  return (
    <section aria-labelledby="funnel-heading" className="hairline-b pb-6">
      <header className="mb-4 flex items-end justify-between gap-6">
        <div>
          <h2 id="funnel-heading" className="text-[1.0625rem] leading-tight font-semibold">
            Five stages, each removing candidates for a stated reason
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-normal text-ink-soft">
            Bar length is log-scaled so every stage stays legible
            {" · "}
            equal time per stage, not per drug removed
          </p>
        </div>

        <button
          type="button"
          onClick={onReplay}
          className={cn(
            // min-w so swapping the label doesn't resize the button and nudge
            // the header. Tailwind v4's hover: already emits
            // @media (hover: hover) — wrapping it again produces `not all`,
            // which never matches and silently kills the style.
            "min-w-[5.5rem] shrink-0 rounded-md border border-rule-strong bg-surface px-3 py-1.5",
            "text-[0.8125rem] font-medium text-ink-soft",
            "transition-[transform,color,background-color] duration-150 ease-out",
            "active:scale-[0.97]",
            "hover:bg-surface-sunk hover:text-ink",
          )}
        >
          {isRunning ? "Running…" : "Replay"}
        </button>
      </header>

      <ol className="space-y-1">
        {funnel.map((stage, i) => {
          const isRevealed = i < revealed;
          const width = logBarWidth(stage.count, max);
          const isLast = i === funnel.length - 1;

          return (
            <li key={stage.stage} className="grid grid-cols-[13rem_1fr] items-start gap-4 py-1">
              <div className="pt-0.5 text-right">
                <div
                  className={cn(
                    "text-[0.8125rem] leading-tight font-medium transition-colors duration-200 ease-out",
                    isRevealed ? "text-ink" : "text-ink-faint",
                  )}
                >
                  {stage.label}
                </div>
                <div className="label mt-1 tabular-nums">Stage {i + 1}</div>
              </div>

              <div>
                <div className="flex items-baseline gap-3">
                  {/* Track, so an unrevealed stage still reads as pending
                      rather than as a missing row. */}
                  <div className="relative h-7 flex-1 overflow-hidden rounded-[3px] bg-surface-sunk">
                    <motion.div
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-[3px]",
                        isLast ? "bg-keep" : "bg-ink",
                      )}
                      initial={false}
                      animate={{ width: isRevealed ? `${width}%` : "0%" }}
                      transition={{ duration: 0.52, ease: [0.23, 1, 0.32, 1] }}
                    />
                  </div>

                  <motion.span
                    className="readout w-[4.5rem] shrink-0 text-right text-[1.0625rem] leading-none font-semibold"
                    initial={false}
                    animate={{ opacity: isRevealed ? 1 : 0.25 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {num(stage.count)}
                  </motion.span>
                </div>

                {stage.eliminated > 0 && (
                  <motion.p
                    className="mt-1.5 flex items-baseline gap-2 text-[0.8125rem] leading-normal"
                    initial={false}
                    animate={{
                      opacity: isRevealed ? 1 : 0,
                      // Nothing appears from nothing: a short rise, not a pop.
                      y: isRevealed ? 0 : -4,
                    }}
                    transition={{
                      duration: 0.22,
                      ease: [0.23, 1, 0.32, 1],
                      delay: isRevealed ? 0.16 : 0,
                    }}
                  >
                    <span className="readout font-medium text-cut">
                      −{num(stage.eliminated)}
                    </span>
                    {stage.top_reason && (
                      <span className="text-ink-soft">{stage.top_reason}</span>
                    )}
                  </motion.p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {final && (
        <motion.p
          className="mt-3 text-[0.9375rem] leading-normal text-ink-soft"
          // Nothing else announces that the run finished, so a screen-reader
          // user who presses Replay otherwise gets no result.
          aria-live="polite"
          initial={false}
          animate={{ opacity: revealed >= funnel.length ? 1 : 0 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1], delay: 0.1 }}
        >
          <span className="readout font-semibold text-ink">{num(final.count)}</span> of{" "}
          <span className="readout">{num(max)}</span> approved drugs survive every stage.
        </motion.p>
      )}
    </section>
  );
}
