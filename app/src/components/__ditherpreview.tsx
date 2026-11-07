/**
 * THROWAWAY. Delete this file — it exists only so Dither could be looked at
 * before it was integrated. Mirrors __kgpreview.tsx.
 *
 * Mount from the dev server's console:
 *   await import("/src/components/__ditherpreview.tsx").then((m) => m.mount())
 *   // brighter, to confirm the Bayer cells are actually there:
 *   await import("/src/components/__ditherpreview.tsx").then((m) => m.mount([0.6, 0.58, 0.72], 6))
 */
import { createRoot } from "react-dom/client";
import { Dither } from "./Dither";

export function mount(waveColor?: [number, number, number], pixelSize = 3) {
  document.getElementById("ditherpreview")?.remove();
  const host = document.createElement("div");
  host.id = "ditherpreview";
  // z-index 0, not 99: Dither is -z-10 and has to sit under page content,
  // which is exactly the stacking it will have in App.
  host.style.cssText = "position:relative;z-index:0";
  document.body.appendChild(host);

  createRoot(host).render(
    <>
      <Dither waveColor={waveColor} pixelSize={pixelSize} />
      <div
        style={{
          position: "fixed",
          inset: "0",
          display: "grid",
          placeContent: "center",
          gap: "12px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "44px",
            color: "var(--ink)",
            margin: 0,
          }}
        >
          Readability check over the dither
        </p>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            margin: 0,
          }}
        >
          --ink-faint at 11px/500 is the worst case in index.css
        </p>
        <div
          style={{
            margin: "12px auto 0",
            padding: "16px 24px",
            width: "320px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: "10px",
            color: "var(--ink-soft)",
            fontSize: "13px",
          }}
        >
          A --surface card. The brightest dither dot should sit at or below
          this panel's luminance.
        </div>
      </div>
    </>,
  );
}
