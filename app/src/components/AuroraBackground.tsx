import { cn } from "@/lib/utils";

/**
 * The depth layer: three slow lobes of coloured light behind the whole page.
 *
 * Ambient, never focal. It runs at under 10% opacity, which is low enough that
 * the contrast measurements in index.css still hold over it — if you can point
 * at a blob, it is too strong.
 *
 * No JavaScript and no motion library on purpose. The drift is entirely
 * predetermined, and CSS animations run off the main thread, so this keeps
 * moving while the funnel is computing and the molecule renderer is painting.
 * That is exactly the moment a rAF-driven background would start dropping
 * frames.
 *
 * Only `transform` and `opacity` animate. The blur is a static `filter`, which
 * means the browser rasterises each lobe once into its own compositor layer
 * and then only moves that layer — the filter never re-runs per frame, and no
 * `will-change` is needed because the filter already promotes the layer.
 *
 * Each lobe has its own period and they ping-pong rather than loop, so the
 * combined pattern has no cycle a viewer can catch and no seam where a
 * `normal` iteration would snap back to its first keyframe.
 *
 * Colour: `--aurora-1..3` are opt-in. They fall back to the neutral ink tokens,
 * because index.css reserves `--cut` for elimination and refuses to let hue
 * carry meaning on its own. Define the three in the palette to get the deep
 * violet / indigo / teal; leave them undefined and this is a neutral glow.
 *
 * Mount it once, inside `body`. `-z-10` puts it behind page content on the
 * assumption that the ground colour is set on exactly one of `html` or `body`
 * (as index.css does), so it propagates to the canvas. Set an opaque
 * background on *both* and body's will paint over this.
 */

const CSS = `
.aurora-lobe {
  position: absolute;
  border-radius: 9999px;
  /* Rasterised once; the transform animation only moves the result. */
  filter: blur(72px);
  opacity: 0.08;
}

.aurora-1 {
  top: -28vmax;
  left: -16vmax;
  width: 72vmax;
  height: 72vmax;
  background-color: var(--aurora-1, var(--ink-soft));
}

.aurora-2 {
  top: 8vmax;
  right: -26vmax;
  width: 62vmax;
  height: 62vmax;
  background-color: var(--aurora-2, var(--ink-faint));
}

.aurora-3 {
  bottom: -34vmax;
  left: 14vmax;
  width: 66vmax;
  height: 66vmax;
  background-color: var(--aurora-3, var(--rule-strong));
}

@keyframes aurora-drift-1 {
  from { transform: translate3d(0, 0, 0) scale(1); opacity: 0.065; }
  to   { transform: translate3d(7vw, 6vh, 0) scale(1.14); opacity: 0.1; }
}

@keyframes aurora-drift-2 {
  from { transform: translate3d(0, 0, 0) scale(1.1); opacity: 0.095; }
  to   { transform: translate3d(-6vw, 8vh, 0) scale(1); opacity: 0.06; }
}

@keyframes aurora-drift-3 {
  from { transform: translate3d(0, 0, 0) scale(1.05); opacity: 0.055; }
  to   { transform: translate3d(5vw, -7vh, 0) scale(1.18); opacity: 0.09; }
}

@media (prefers-reduced-motion: no-preference) {
  /* ease-in-out, not the house ease-out: this is continuous ping-pong motion,
     and matching velocity at the turnaround is what hides the reversal. The
     ease-in half is invisible at a 29-second period. */
  .aurora-1 { animation: aurora-drift-1 29s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate; }
  .aurora-2 { animation: aurora-drift-2 37s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate; }
  .aurora-3 { animation: aurora-drift-3 47s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate; }
}
`;

export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      <style>{CSS}</style>
      <div className="aurora-lobe aurora-1" />
      <div className="aurora-lobe aurora-2" />
      <div className="aurora-lobe aurora-3" />
    </div>
  );
}
