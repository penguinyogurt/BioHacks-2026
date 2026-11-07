import { useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

/**
 * Fades and lifts a section into place the first time it scrolls into view.
 *
 * Purpose is "prevent a jarring change", not delight: sections that pop into
 * existence at the scroll boundary read as a rendering fault. So it is short
 * (400ms), small (12px) and strictly once — a reader scrolling back up finds
 * the page exactly where they left it rather than watching it reassemble.
 *
 * The wrapper is deliberately plain. No overflow, no z-index, no isolation, so
 * nothing inside it can be clipped or re-stacked; and because `y` settles at
 * 0, Motion writes `transform: none` at the end, so the div stops being a
 * containing block for any fixed-position child once the reveal is over.
 */

/** The project's --ease-out: instant first frame, long settle. */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

type Props = {
  children: ReactNode;
  /** Seconds. Stagger siblings ~0.1 apart; more reads as the page lagging. */
  delay?: number;
  className?: string;
};

export function Reveal({ children, delay = 0, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Positive bottom margin grows the observed box downward, so the fade starts
  // ~96px before the section reaches the fold and is finished by the time the
  // reader's eye arrives. Negative margin here would do the opposite.
  const inView = useInView(ref, { once: true, margin: "0px 0px 96px 0px" });
  const reduced = useReducedMotion();

  // Not a gentler version: this one is pure movement, so there is nothing to
  // keep. A bare div, so `className` still lands and layout is identical.
  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.4, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
