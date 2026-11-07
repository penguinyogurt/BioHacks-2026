import { useRef } from "react";
import { motion } from "motion/react";
import type { FunnelStage, Stage } from "@/lib/contract";
import { logBarWidth } from "@/lib/pipeline";
import { useFunnelRun } from "@/hooks/useFunnelRun";
import { useOnScreen } from "@/hooks/useOnScreen";
import { Button } from "@/components/ui/button";
import { cn, num } from "@/lib/utils";

/** Stages whose eliminated drugs are actually carried in `candidates`. */
const CUTS_SHOWN = new Set<Stage>(["bbb", "patient_filter", "trial_history"]);

export function FunnelRun({
  funnel,
  onShowCuts,
}: {
  funnel: FunnelStage[];
  onShowCuts?: (stage: Stage) => void;
}) {
  const max = funnel[0]?.count ?? 1;
  const final = funnel[funnel.length - 1];

  // The run owns its own visibility. A judge must actually be looking at the
  // bars when they move — triggering on mount meant the whole 3.1s played
  // below the fold and they arrived at a finished chart.
  const frame = useRef<HTMLElement>(null);
  // -45%: the panel is 423px and only ~133px of it (the heading, no bars)
  // was on screen when the default -10% margin tripped, so the run still
  // played to nobody. This waits until most of the bars are visible.
  const onScreen = useOnScreen(frame, "0px 0px -45% 0px");
  const { revealed, isRunning, replay } = useFunnelRun(funnel.length, onScreen);

  return (
    <section aria-labelledby="funnel-heading" ref={frame}>
      <header className="mb-4 flex items-end justify-between gap-6">
        <div>
          <h2 id="funnel-heading" className="text-2xl leading-tight">
            Five stages, each removing candidates for a stated reason
          </h2>
          <p className="mt-1 text-sm leading-normal text-ink-soft">
            Bar length is log-scaled so every stage stays legible
            {" · "}
            equal time per stage, not per drug removed
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={replay}
          // min-w so swapping the label doesn't resize the button and nudge
          // the header.
          className="min-w-[5.5rem] bg-surface/60 text-ink-soft active:scale-[0.97] hover:text-ink"
        >
          {isRunning ? "Running…" : "Replay"}
        </Button>
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
                    {/* The number stays ink and the colour moves onto the
                        sign. A coloured numeral was the only one on the page,
                        which broke the tabular column and is a generated-
                        dashboard tell — colour belongs on a mark, not on a
                        value. */}
                    <span className="readout font-medium text-ink">
                      <span className="text-cut">−</span>
                      {num(stage.eliminated)}
                    </span>
                    {stage.top_reason && (
                      <span className="text-ink-soft">{stage.top_reason}</span>
                    )}
                    {/* The drugs a stage removed are carried in the data for
                        the last three stages only; the first two are counts.
                        Where we have the cards, let the number reach them —
                        otherwise the funnel and the card grid are two
                        unrelated pictures of the same run. */}
                    {onShowCuts && CUTS_SHOWN.has(stage.stage) && (
                      <button
                        type="button"
                        onClick={() => onShowCuts(stage.stage)}
                        className="rounded text-sm text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors duration-150 ease-out hover:text-ink hover:decoration-ink"
                      >
                        see them
                      </button>
                    )}
                  </motion.p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* A live region observes content, not style. Fading this in with
          opacity announced nothing when the run finished — which was the
          whole point — and `opacity: 0` doesn't hide it from a screen
          reader either, so the answer was read out 3.1s before anyone could
          see it. It gets mounted when the run lands, not faded. */}
      <div aria-live="polite" className="mt-3 min-h-6">
        {final && revealed >= funnel.length && (
          <motion.p
            className="text-md leading-normal text-ink-soft"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="readout font-semibold text-ink">{num(final.count)}</span>{" "}
            of <span className="readout">{num(max)}</span> approved drugs survive
            every stage.
          </motion.p>
        )}
      </div>
    </section>
  );
}
