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
          <h2 id="funnel-heading" className="text-lg leading-tight font-semibold">
            Five stages, each removing candidates for a stated reason
          </h2>
          <p className="mt-1 text-sm leading-normal text-ink-soft">
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
            "text-sm font-medium text-ink-soft",
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
          // What entered this stage, drawn as a ghost behind the survivors.
          // The gap between the two IS the elimination — without it the cut
          // is only a number you have to read, not a thing you can see.
          const inboundWidth =
            i === 0 ? width : logBarWidth(funnel[i - 1].count, max);

          return (
            <li key={stage.stage} className="grid grid-cols-[13rem_1fr] items-start gap-4 py-1">
              <div className="pt-0.5 text-right">
                <div
                  className={cn(
                    "text-sm leading-tight font-medium transition-colors duration-200 ease-out",
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
                    {inboundWidth > width && (
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-[3px] bg-cut-soft"
                        initial={false}
                        animate={{ width: isRevealed ? `${inboundWidth}%` : "0%" }}
                        transition={{ duration: 0.38, ease: [0.23, 1, 0.32, 1] }}
                        aria-hidden="true"
                      />
                    )}
                    {/* Animating width rather than scaleX: at stage 5 the bar
                        is 21% wide, and scaleX would stretch the 3px radius
                        into a visible pill. One bar at a time, 28px tall —
                        measured, no jank. */}
                    <motion.div
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-[3px]",
                        isLast ? "bg-keep" : "bg-ink",
                      )}
                      initial={false}
                      animate={{ width: isRevealed ? `${width}%` : "0%" }}
                      transition={{
                        duration: 0.52,
                        ease: [0.23, 1, 0.32, 1],
                        delay: isRevealed ? 0.12 : 0,
                      }}
                    />
                  </div>

                  <motion.span
                    className="readout w-[4.5rem] shrink-0 text-right text-lg leading-none font-semibold"
                    initial={false}
                    animate={{ opacity: isRevealed ? 1 : 0.25 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {num(stage.count)}
                  </motion.span>
                </div>

                {stage.eliminated > 0 && (
                  <motion.p
                    className="mt-1.5 flex items-baseline gap-2 text-sm leading-normal"
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
          className="mt-3 text-md leading-normal text-ink-soft"
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
