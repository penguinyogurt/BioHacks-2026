import GradientASCII from '@/components/react-bits/GradientASCII'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * React Bits Gradient ASCII, in the Addo palette: a teal-to-ink gradient drawn
 * as monospace glyphs on paper. Shared by the landing page and the workspace.
 */
export function AsciiBackground({ quiet = false }: { quiet?: boolean }) {
  return (
    <div className="absolute inset-0 bg-background" aria-hidden>
      <GradientASCII
        lightMode
        shape="horizon"
        colors={['#d7ecef', '#7fb8c1', '#2f6f7c', '#13293d']}
        characters=" .:-=+*#%@"
        fontFamily='"Geist Mono Variable", ui-monospace, monospace'
        cellSize={14}
        density={0.85}
        glyphOpacity={quiet ? 0.55 : 0.8}
        gradientOpacity={quiet ? 0.35 : 0.6}
        glow={0.15}
        flicker={0.15}
        flow={0.5}
        speed={reducedMotion ? 0 : 0.6}
        grain={0.05}
        clickEffect="wave"
      />
    </div>
  )
}
