import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Drives the staged reveal of the funnel.
 *
 * Every stage gets the same dwell time on purpose. Proportional timing would
 * give the 4,465-drug first cut almost the whole run and the patient filter a
 * blink, which is backwards — the patient filter is the contribution.
 *
 * Autoplays ONCE THE FUNNEL IS ACTUALLY ON SCREEN, not on mount — `enabled`
 * is the caller's visibility check. Mount-triggered, the whole 3.1s run
 * finished while the panel was still below the fold (measured: top edge at
 * 908px on a 900px viewport), so the argument played to nobody and the judge
 * scrolled down to a static chart. Replays in ~3s on demand.
 */
const DWELL_MS = 620;

export type FunnelRun = {
  /** How many stages are currently revealed, 0..total. */
  revealed: number;
  isRunning: boolean;
  replay: () => void;
};

export function useFunnelRun(total: number, enabled = true): FunnelRun {
  const reduceMotion = useReducedMotion();
  // Reduced motion still tells the story — it just arrives already told.
  const [revealed, setRevealed] = useState(() => (reduceMotion ? total : 0));
  const timer = useRef<number | null>(null);
  // No "have I started?" ref guard here, deliberately. A ref survives
  // StrictMode's deliberate mount/cleanup/mount in development, so the first
  // mount's cleanup cancelled the interval and the second mount hit the guard
  // and never restarted it — the bars sat at zero forever. `enabled` latches
  // true and never goes back, which is what makes "once" safe without a ref.

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
    if (!enabled) return;
    start();
    return clear;
  }, [enabled, start, clear]);

  return { revealed, isRunning: revealed < total, replay: start };
}
