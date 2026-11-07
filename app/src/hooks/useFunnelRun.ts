import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Drives the staged reveal of the funnel.
 *
 * Every stage gets the same dwell time on purpose. Proportional timing would
 * give the 4,465-drug first cut almost the whole run and the patient filter a
 * blink, which is backwards — the patient filter is the contribution.
 *
 * Autoplays once on mount so a judge arriving mid-conversation sees the
 * argument without anyone touching the laptop, and replays in ~3s on demand.
 */
const DWELL_MS = 620;

export type FunnelRun = {
  /** How many stages are currently revealed, 0..total. */
  revealed: number;
  isRunning: boolean;
  replay: () => void;
};

export function useFunnelRun(total: number): FunnelRun {
  const reduceMotion = useReducedMotion();
  // Reduced motion still tells the story — it just arrives already told.
  const [revealed, setRevealed] = useState(() => (reduceMotion ? total : 0));
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    if (reduceMotion) {
      setRevealed(total);
      return;
    }
    setRevealed(0);
    timer.current = window.setInterval(() => {
      setRevealed((n) => {
        if (n >= total) {
          clear();
          return n;
        }
        return n + 1;
      });
    }, DWELL_MS);
  }, [clear, reduceMotion, total]);

  useEffect(() => {
    start();
    return clear;
  }, [start, clear]);

  return { revealed, isRunning: revealed < total, replay: start };
}
