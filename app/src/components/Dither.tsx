import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import { Color, Uniform, Vector2 } from "three";
import type { Mesh, ShaderMaterial } from "three";
import { cn } from "@/lib/utils";

/**
 * Ordered-dither wave background, ported from ReactBits "Dither"
 * (DavidHDev/react-bits, src/ts-default/Backgrounds/Dither/Dither.tsx at
 * commit e04bb7e — the last revision before upstream dropped three.js for
 * raw WebGL2). The Perlin (`cnoise`) and 8x8 Bayer matrix below are the
 * upstream values verbatim; neither was reconstructed, because a wrong
 * Perlin or a wrong Bayer reads as noise rather than dither.
 *
 * Two passes, same as upstream: a plane renders an fbm Perlin wave into a
 * luminance field, then an `EffectComposer` runs one custom `Effect` that
 * pixelates, applies an ordered 8x8 Bayer threshold and quantises to
 * `colorNum` levels. The ordered dither is the entire look — it is what
 * makes this read as a 1-bit print texture instead of a blurry gradient.
 *
 * ---
 * ONE DELIBERATE DIVERGENCE FROM UPSTREAM, and it is the reason this can be
 * dark at all. Upstream multiplies `waveColor` into the wave pass, *before*
 * quantisation, then the dither pass subtracts a hardcoded 0.2 bias:
 *
 *     color = clamp(color - 0.2, 0.0, 1.0);
 *     return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
 *
 * Feed that a near-black `waveColor` and every channel lands under the bias,
 * clamps to zero and quantises to zero: the canvas goes solid black with no
 * shader error to show for it. So the wave pass here emits a neutral
 * luminance field at upstream's default amplitude, the Bayer quantisation
 * runs over that full 0..1 range exactly as upstream intends, and
 * `waveColor` is applied as a *tint* on the far side of the quantiser. A
 * multiply after quantisation preserves the level count, so the hard 1-bit
 * structure survives at any darkness.
 *
 * ---
 * Colour. This sits behind a dark violet-black UI whose ground is
 * `--paper: oklch(0.165 0.014 285)` (sRGB #0e0e14) and whose elevated cards
 * are `--surface: oklch(0.213 0.016 285)` (sRGB #181820). A shader cannot
 * read a CSS variable, so the defaults below are hand-matched to those two
 * tokens: the brightest dither dot is held at roughly `--surface`
 * luminance, so the background never out-weighs a card and the contrast
 * measurements documented in index.css still hold over it. If you can point
 * at the wave, it is too strong — same rule AuroraBackground states.
 *
 * The container blends with `mix-blend-mode: screen`. The pass renders on
 * black, and screen leaves black untouched, so the dither *adds* light onto
 * the propagated `--paper` ground instead of covering it with an opaque
 * black rectangle. Fading the canvas with `opacity` instead would darken the
 * ground, and quantising the alpha channel instead would turn the 1-bit
 * edges back into a soft gradient.
 *
 * Mount once, inside `body`, like AuroraBackground: `-z-10` works on the
 * assumption that the ground colour is set on exactly one of `html` or
 * `body` (index.css sets it on `body`), so it propagates to the root canvas
 * and is painted beneath negative z-index content.
 */

const waveVertexShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

/**
 * Upstream's wave pass, with the `waveColor` multiply removed (see the note
 * above) so this emits a neutral field. The 0.5 factor is exactly upstream's
 * default `waveColor` of [0.5, 0.5, 0.5], which keeps the value distribution
 * reaching the quantiser identical to upstream's default look.
 */
const waveFragmentShader = /* glsl */ `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

// NO BACKTICKS ANYWHERE IN THIS STRING - it is a template literal, and a
// backtick in a GLSL comment silently ends it and hands the rest of the
// shader to the JS parser.
//
// Upstream runs 8 octaves. Measured on the Intel HD 620 this is being
// captured on, at 1440x900 and dpr 1.5 (a 2160x1350 buffer), 8 octaves cost
// 82ms/frame - about 12fps - because pattern() nests fbm() three deep, so
// every octave is really 3 Perlin evaluations per pixel. Four octaves cost
// 24ms.
//
// Nothing is lost at the default waveAmplitude of 0.3: amplitude decays by
// that factor per octave, so octaves 5-8 together contribute 0.8% of the
// field, which is 0.034 of one quantisation step at colorNum = 4 - they
// cannot flip a single dither cell, and the dither cell is the smallest
// thing this can show. The tail only becomes visible around waveAmplitude
// 0.8 (3.6 steps); raise this back toward 8 if you raise it that far.
const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p - fbm(p + fbm(p2)));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  gl_FragColor = vec4(vec3(f * 0.5), 1.0);
}
`;

/**
 * The dither pass. `inputBuffer`, `uv` and the `mainImage` entry point are
 * supplied by postprocessing; `uResolution` is ours (postprocessing's own
 * `resolution` uniform is not part of the effect-shader contract, so it is
 * kept separate and fed from `setSize`).
 *
 * `stepSize` is upstream's `step` renamed — a local named `step` shadows the
 * GLSL builtin, which is legal but not worth relying on.
 */
const ditherFragmentShader = /* glsl */ `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
uniform vec3 waveColor;
uniform vec2 uResolution;

const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 cell, vec3 color) {
  int x = int(mod(cell.x, 8.0));
  int y = int(mod(cell.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float stepSize = 1.0 / (colorNum - 1.0);
  color += threshold * stepSize;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / uResolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  vec2 cell = floor(gl_FragCoord.xy / pixelSize);
  outputColor = vec4(dither(cell, color.rgb) * waveColor, color.a);
}
`;

type RetroOptions = {
  colorNum?: number;
  pixelSize?: number;
  waveColor?: [number, number, number];
};

/**
 * The options object is what makes this typed end to end: `wrapEffect`
 * derives its prop type from the first constructor parameter, so a
 * `RetroOptions` parameter is what gives `<RetroEffect>` real
 * `colorNum` / `pixelSize` / `waveColor` props instead of `{}`. It stays
 * optional because r3f's reconciler constructs the effect with no arguments
 * and then applies those props through the setters below.
 *
 * `uniforms` is *not* redeclared as a field. `Effect` already owns it as a
 * `readonly Map<string, Uniform>`, and with `useDefineForClassFields` a
 * redeclaration would `defineProperty` over the base map with `undefined`.
 */
class RetroEffectImpl extends Effect {
  constructor({
    colorNum = 4,
    pixelSize = 2,
    waveColor = [0.5, 0.5, 0.5],
  }: RetroOptions = {}) {
    super("RetroEffect", ditherFragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["colorNum", new Uniform(colorNum)],
        ["pixelSize", new Uniform(pixelSize)],
        ["waveColor", new Uniform(new Color(...waveColor))],
        ["uResolution", new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  private uniform<T>(name: string): Uniform<T> {
    // Every key is written in the constructor above, so this is total.
    return this.uniforms.get(name) as Uniform<T>;
  }

  /** postprocessing's `Resizable` hook — fires with the render resolution. */
  override setSize(width: number, height: number): void {
    this.uniform<Vector2>("uResolution").value.set(width, height);
  }

  get colorNum(): number {
    return this.uniform<number>("colorNum").value;
  }
  set colorNum(value: number) {
    this.uniform<number>("colorNum").value = value;
  }

  get pixelSize(): number {
    return this.uniform<number>("pixelSize").value;
  }
  set pixelSize(value: number) {
    this.uniform<number>("pixelSize").value = value;
  }

  get waveColor(): Color {
    return this.uniform<Color>("waveColor").value;
  }
  set waveColor(value: Color | [number, number, number]) {
    const target = this.uniform<Color>("waveColor").value;
    if (Array.isArray(value)) target.setRGB(...value);
    else target.copy(value);
  }
}

// Hoisted out of render on purpose: `wrapEffect` registers a new JSX
// intrinsic per class, and calling it inside a component (as upstream does)
// hands React a brand-new component type on every render, remounting the
// effect and rebuilding the composer each time.
const RetroEffect = wrapEffect(RetroEffectImpl);

type WaveUniforms = {
  time: Uniform<number>;
  resolution: Uniform<Vector2>;
  waveSpeed: Uniform<number>;
  waveFrequency: Uniform<number>;
  waveAmplitude: Uniform<number>;
  mousePos: Uniform<Vector2>;
  enableMouseInteraction: Uniform<number>;
  mouseRadius: Uniform<number>;
};

type WavesProps = Required<
  Pick<
    DitherProps,
    | "waveSpeed"
    | "waveFrequency"
    | "waveAmplitude"
    | "waveColor"
    | "colorNum"
    | "pixelSize"
    | "disableAnimation"
    | "enableMouseInteraction"
    | "mouseRadius"
  >
>;

function DitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius,
}: WavesProps) {
  const mesh = useRef<Mesh>(null);
  const { size, gl, viewport, invalidate } = useThree();

  // A ref, not state: upstream re-rendered the whole subtree on every
  // pointermove, which is a React render per mouse pixel for a value that
  // only ever reaches a uniform.
  const mouse = useRef(new Vector2(0, 0));

  const uniforms = useRef<WaveUniforms>({
    time: new Uniform(0),
    resolution: new Uniform(new Vector2(0, 0)),
    waveSpeed: new Uniform(waveSpeed),
    waveFrequency: new Uniform(waveFrequency),
    waveAmplitude: new Uniform(waveAmplitude),
    mousePos: new Uniform(new Vector2(0, 0)),
    enableMouseInteraction: new Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new Uniform(mouseRadius),
  });

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    uniforms.current.resolution.value.set(
      Math.floor(size.width * dpr),
      Math.floor(size.height * dpr),
    );
  }, [size, gl]);

  // Under reduced motion the Canvas runs `frameloop="demand"`, which renders
  // only when asked. It does NOT reliably paint an initial frame: the canvas
  // is still unsized on the first commit, so a mount with no explicit
  // request leaves a blank background rather than the required static frame.
  // No dependency array on purpose — this runs after every commit, and since
  // it is declared after the resolution effect above, the uniforms are
  // already current. Under `always` it is a harmless no-op.
  useEffect(invalidate);

  // The container is `pointer-events-none`, so upstream's invisible
  // raycast-catching mesh can never be hit. A window listener reads the
  // pointer without taking a single event away from the page content.
  useEffect(() => {
    if (!enableMouseInteraction) return;
    const onMove = (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const dpr = gl.getPixelRatio();
      mouse.current.set(
        (event.clientX - rect.left) * dpr,
        (event.clientY - rect.top) * dpr,
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enableMouseInteraction, gl]);

  // r3f disposes declarative geometry and materials on unmount, and
  // @react-three/postprocessing disposes the composer and its passes with
  // it. Held explicitly anyway, because the GPU cost of getting this wrong
  // on a full-screen shader only shows up as a slow leak across remounts.
  useEffect(() => {
    const node = mesh.current;
    return () => {
      node?.geometry.dispose();
      (node?.material as ShaderMaterial | undefined)?.dispose();
    };
  }, []);

  useFrame(({ clock }) => {
    const u = uniforms.current;
    if (!disableAnimation) u.time.value = clock.getElapsedTime();
    u.waveSpeed.value = waveSpeed;
    u.waveFrequency.value = waveFrequency;
    u.waveAmplitude.value = waveAmplitude;
    u.mouseRadius.value = mouseRadius;
    u.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    if (enableMouseInteraction) u.mousePos.value.copy(mouse.current);
  });

  return (
    <>
      {/* The vertex shader is upstream's and runs the full
          projection * view * model chain, so this plane lives in world
          space, not clip space — it has to be scaled to the camera's
          viewport to fill the screen. A unit plane here renders as a small
          bright patch in the middle of a black page. */}
      <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={waveVertexShader}
          fragmentShader={waveFragmentShader}
          uniforms={uniforms.current}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <EffectComposer>
        <RetroEffect
          colorNum={colorNum}
          pixelSize={pixelSize}
          waveColor={waveColor}
        />
      </EffectComposer>
    </>
  );
}

/**
 * Last line of defence. A shader that fails to link, a driver that refuses
 * a float render target, a context lost mid-capture — any of those throw
 * from inside r3f's commit, and without a boundary they take the whole page
 * with them. A background is never worth a white screen, so this renders
 * nothing and lets the page carry on over the plain `--paper` ground.
 */
class WebGLBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Probed once, lazily: a context creation here is cheap and is released. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ??
      (probe.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export type DitherProps = {
  /** Drift rate of the noise field. Upstream default. */
  waveSpeed?: number;
  /** Per-octave frequency multiplier in the fbm. */
  waveFrequency?: number;
  /** Per-octave amplitude falloff in the fbm. */
  waveAmplitude?: number;
  /** Linear RGB tint applied to the lit dither dots, after quantisation. */
  waveColor?: [number, number, number];
  /** Quantisation levels. 2 is true 1-bit; 4 is upstream's default. */
  colorNum?: number;
  /** Dither cell size in device pixels. */
  pixelSize?: number;
  /** Freeze the wave but keep rendering. */
  disableAnimation?: boolean;
  /** Push the field away from the cursor. Off by default behind UI. */
  enableMouseInteraction?: boolean;
  /** Radius of that push, in the shader's aspect-corrected uv space. */
  mouseRadius?: number;
  className?: string;
};

export function Dither({
  waveSpeed = 0.02,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  // Linear-light, and measured rather than guessed — postprocessing encodes
  // the composer output to sRGB, so these are ~25x smaller than the sRGB
  // values they produce. With colorNum = 4 the four levels land on sRGB
  // 0.000 / 0.017 / 0.034 / 0.050, which screen onto `--paper` (0.053) as
  // 0.053 / 0.069 / 0.085 / 0.100 — four 8-bit-distinct steps that top out
  // at `--surface` (0.094), so the brightest dot never out-weighs a card.
  // This is the calibration knob: raise it together and the texture comes
  // forward, but re-check the `--ink-faint` 11px case in index.css first.
  waveColor = [0.004, 0.0038, 0.0058],
  colorNum = 4,
  pixelSize = 3,
  disableAnimation = false,
  enableMouseInteraction = false,
  mouseRadius = 0.6,
  className,
}: DitherProps = {}) {
  // Lazy and once: `webglAvailable` touches the DOM, so it must not run
  // during module evaluation or on the server.
  const [supported] = useState(webglAvailable);
  const [lost, setLost] = useState(false);

  const [reduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [hidden, setHidden] = useState(() => document.hidden);

  // A backgrounded tab must not keep a full-screen fragment shader warm.
  // rAF already throttles, but `frameloop="never"` stops the loop outright.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const container = cn(
    "pointer-events-none fixed inset-0 -z-10",
    "motion-reduce:transition-none",
    className,
  );

  // Still a div, never a missing node: the page's own layering assumes the
  // background element exists, and a transparent one costs nothing.
  if (!supported || lost) return <div aria-hidden="true" className={container} />;

  return (
    <div
      aria-hidden="true"
      className={container}
      // The pass renders on black and screen leaves black alone, so the
      // dither adds light onto the propagated `--paper` ground rather than
      // painting an opaque black rectangle over it.
      style={{ mixBlendMode: "screen" }}
    >
      <WebGLBoundary>
        <Canvas
          // Reduced motion gets exactly one frame, so the texture is still
          // there but nothing moves. `never` parks the loop for a hidden tab.
          frameloop={reduced ? "demand" : hidden ? "never" : "always"}
          camera={{ position: [0, 0, 6] }}
          // 2x on a full-screen fragment shader is a frame-rate cliff for no
          // visible gain at this contrast — the dither cell is quantised to
          // device pixels either way.
          dpr={[1, 1.5]}
          gl={{
            antialias: false,
            powerPreference: "low-power",
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener(
              "webglcontextlost",
              (event) => {
                // Default behaviour is a permanently dead canvas; swallowing
                // it would leave a black rectangle mid-recording instead.
                event.preventDefault();
                setLost(true);
              },
              { once: true },
            );
          }}
        >
          <DitheredWaves
            waveSpeed={reduced ? 0 : waveSpeed}
            waveFrequency={waveFrequency}
            waveAmplitude={waveAmplitude}
            waveColor={waveColor}
            colorNum={colorNum}
            pixelSize={pixelSize}
            disableAnimation={disableAnimation || reduced}
            enableMouseInteraction={enableMouseInteraction && !reduced}
            mouseRadius={mouseRadius}
          />
        </Canvas>
      </WebGLBoundary>
    </div>
  );
}

export default Dither;
