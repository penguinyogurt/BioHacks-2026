import { useLayoutEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { cn, num } from "@/lib/utils";

/**
 * A headline figure that counts up from zero the first time it enters view.
 *
 * The count never passes through React. `animate` writes the formatted string
 * straight to the node's textContent, so 1.2 seconds of counting costs zero
 * re-renders of whatever section the figure sits in — which matters because
 * these numbers sit beside the funnel while it is running.
 *
 * Two details carry it. The digits are tabular: a proportional `1` is narrower
 * than a `0`, so an untabulated count reflows on nearly every frame, and a
 * number that jitters reads worse than one that never animated. And the final
 * value is the element's children, so it is what the first paint, a failed
 * hydration and reduced motion all show. The zero is written in a layout
 * effect, before the browser paints, so the real figure never flashes first.
 */

/** The project's --ease-out. Decelerating: most of the count is over early. */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

type Props = {
  value: number;
  /** Seconds. Past ~1.2 the count stops reading as arrival and starts as wait. */
  duration?: number;
  format?: (n: number) => string;
  className?: string;
};

export function CountUp({
  value,
  duration = 1.2,
  format = num,
  className,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  /** No early margin: a figure should be settled by the time it is readable. */
  const inView = useInView(ref, { once: true, margin: "0px 0px -8% 0px" });
  const reduced = useReducedMotion();

  // Read at animation time rather than captured in the effect's deps: an
  // inline `format` prop is a new function on every render and would otherwise
  // restart the count forever.
  const fmt = useRef(format);
  fmt.current = format;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;

    if (!inView) {
      node.textContent = fmt.current(0);
      return;
    }

    const playback = animate(0, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (n) => {
        node.textContent = fmt.current(Math.round(n));
      },
    });
    return () => playback.stop();
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(value)}
    </span>
  );
}
