import { useEffect, useState, type RefObject } from "react";

/**
 * True once the element has been on screen. Latches — it never goes back.
 *
 * A plain IntersectionObserver rather than motion's `useInView`, because the
 * two autoplaying animations on this page depend on this being right and
 * this is the version already proven elsewhere in the codebase. `rootMargin`
 * here means the same thing it means everywhere else, which is worth more
 * than the three lines it saves.
 *
 * `rootMargin` defaults to firing slightly before the element arrives, so a
 * run triggered by it has started by the time the viewer is looking at it
 * rather than after.
 */
export function useOnScreen(
  ref: RefObject<Element | null>,
  rootMargin = "0px 0px -10% 0px",
): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;

    // No observer (jsdom, very old browsers): show the end state rather than
    // leave an animation that never starts.
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);

  return seen;
}
