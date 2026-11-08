import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { StageStatus } from '@/lib/run-store'
import { cn } from '@/lib/utils'
import { LANE_COLORS } from './lanes'
import { DrkgLegend } from './drkg-legend'
import { DEFAULT_SRC, loadNames, useDrkg, type DrkgData, type Vec3 } from './drkg-data'

/**
 * Stage 3, drawn from the real DRKG. One property per visual channel:
 *
 *   position    clustered layout of the 400-d TransE vector (points.bin)
 *   colour      cluster (clusters.bin); the traversal overlay uses LANE_COLORS
 *   size        graph degree, log-scaled (degree.bin)
 *   shape       entity type: Compound ● · Gene ○ · Disease ◆ · other ·
 *   opacity     closeness to the active query during the L2 scan (visual falloff
 *               only; the ranking is the 400-d distance shown on the labels)
 *
 * Profile by profile it replays the two traversals the stage performs — real
 * DRKG edges ALS → gene → compound, then e[gene] − r[target] → nearest
 * compounds — as thin strokes with a travelling pulse. The timeline runs in the
 * frame loop from `status`; `done` on mount or reduced motion shows the end.
 */

const LEAD = 0.9 // ALS lights before the first profile
const STEP = 3.3 // profile start spacing
const WIN = 3.7 // one profile's window (overlaps the next by 0.4 s)
const OUTRO = 1.6
const MAX_CLUSTERS = 32 // ponytail: uniform array; switch to a DataTexture if the layout ever has more
const MAX_TYPES = 16 // DRKG has 13 entity types
const LEADER = 18 // px from point to label

// Animation tokens (animate skill): reveals ease out, camera moves ease in-out.
const easeOut = bezier(0.23, 1, 0.32, 1)
const easeInOut = bezier(0.77, 0, 0.175, 1)

const PAPER = new THREE.Color('#f7f4ee') // --card over --background
const INK = '#13293d' // --foreground

// Shape codes shared by both point layers (see POINT_FRAG).
const SHAPE = { compound: 0, gene: 1, matched: 2, disease: 3, other: 4, query: 5, als: 6 } as const

/** Layer a line or dot belongs to: always shown, real DRKG edges, or vector arithmetic. */
const KIND = { core: 0, edge: 1, vector: 2 } as const

type Seg = { a: Vec3; b: Vec3; color: THREE.Color; start: number; dur: number; lane: number; base: number; kind: number; peak?: number }
type Dot = { pos: Vec3; color: THREE.Color; size: number; shape: number; start: number; lane: number; settle: number; kind?: number }
type Label = { pos: THREE.Vector3; lane: number; priority: number; node: ReactNode; opacity: (t: number, focus: number | null) => number }
type Cluster = { id: number; label: string; size: number; color: string }

/* ---------------------------------------------------------------- helpers -- */

function bezier(x1: number, y1: number, x2: number, y2: number) {
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x
      if (Math.abs(cx) < 1e-5) break
      const dx = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t
      t = Math.min(1, Math.max(0, t - cx / (dx || 1e-6)))
    }
    return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
  }
}

/** OKLCH → sRGB hex. Same ramp as drkg-legend's `clusterColor`, which emits CSS three can't parse. */
function oklch(l: number, c: number, hDeg: number) {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const gamma = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)))
  return '#' + lin.map((x) => gamma(x).toString(16).padStart(2, '0')).join('')
}
const clusterHex = (id: number, color?: string) => (color?.startsWith('#') ? color : oklch(0.7, 0.085, (id * 137.508 + 200) % 360))

const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)))
/** 1 inside [a, b], easing in over `fade` before a and out after b. */
const window_ = (t: number, a: number, b: number, fade = 0.35) => ramp(t, a, a + fade) * (1 - ramp(t, b, b + fade))
const start = (lane: number) => LEAD + lane * STEP

function useReducedMotion() {
  const [reduce, setReduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

/** Clusters if the layout has them, else one group per entity type. */
function clustersOf(data: DrkgData): { list: Cluster[]; index: Uint8Array } {
  const { scene, clusters, types } = data
  if (clusters && scene.clusters?.length)
    return { list: scene.clusters.map((c) => ({ id: c.id, label: c.label, size: c.size, color: clusterHex(c.id, c.color) })), index: clusters }
  return { list: scene.types.map((ty, i) => ({ id: i, label: ty.name, size: ty.count, color: clusterHex(i) })), index: types }
}

/* ---------------------------------------------------------------- shaders -- */

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aShape;
  attribute float aCluster;
  attribute float aType;
  uniform float uPx;
  uniform float uSize;
  uniform float uHidden[${MAX_CLUSTERS}];
  uniform float uHiddenType[${MAX_TYPES}];
  uniform vec3 uPaper;
  uniform float uFog;
  uniform vec3 uQuery;
  uniform float uScan;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uSize * uPx * (24.0 / -mv.z);
    float fog = smoothstep(14.0, 40.0, -mv.z) * uFog;
    vColor = mix(color, uPaper, fog);
    float hidden = aCluster < 0.0 ? 0.0 : uHidden[int(aCluster + 0.5)];
    float hiddenType = aType < 0.0 ? 0.0 : uHiddenType[int(aType + 0.5)];
    float d2 = dot(position - uQuery, position - uQuery);
    float near = 0.12 + 0.88 * exp(-d2 / 18.0);
    vAlpha = aAlpha * mix(1.0, near, uScan) * mix(1.0, 0.05, hidden) * mix(1.0, 0.04, hiddenType);
    vShape = aShape;
  }
`
const POINT_FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  float edge(float d, float r, float aa) { return 1.0 - smoothstep(r - aa, r, d); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float dd = (abs(c.x) + abs(c.y)) * 2.0;
    float aa = max(fwidth(d), 0.02) * 1.2;
    vec3 col = vColor;
    float a;
    int s = int(vShape + 0.5);
    if (s == 0) a = edge(d, 1.0, aa);                                     // compound: filled circle
    else if (s == 1) a = edge(d, 1.0, aa) * (1.0 - edge(d, 0.38, aa));   // gene: ring with a clear hole
    else if (s == 2) { a = edge(d, 1.0, aa); col = mix(col, uInk, 1.0 - edge(d, 0.68, aa)); } // matched compound
    else if (s == 3) a = edge(dd, 0.95, aa);                              // disease: diamond
    else if (s == 4) a = (1.0 - smoothstep(0.15, 0.5, d)) * 0.8;          // other: small soft dot
    else if (s == 5) a = edge(d, 1.0, aa) * (1.0 - edge(d, 0.62, aa)) + edge(d, 0.24, aa); // query: target
    else { a = edge(dd, 1.0, aa); col = mix(col, uInk, 1.0 - edge(dd, 0.66, aa)); }         // ALS: outlined diamond
    a *= vAlpha;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`
// Every line: a thin solid stroke that draws itself on, then carries a slow pulse.
const LINE_VERT = /* glsl */ `
  attribute float aT;
  attribute float aStart;
  attribute float aDur;
  attribute float aWin;
  attribute float aBase;
  attribute float aLane;
  attribute float aSeed;
  attribute float aKind;
  attribute float aPeak;
  attribute vec3 color;
  uniform float uLane[5];
  uniform float uLaneTime[5];
  uniform float uShow[3];
  varying float vT; varying float vStart; varying float vDur; varying float vWin;
  varying float vBase; varying float vSeed; varying float vLane; varying float vTime; varying float vPeak;
  varying vec3 vColor;
  void main() {
    vPeak = aPeak;
    vT = aT; vStart = aStart; vDur = aDur; vWin = aWin; vBase = aBase; vSeed = aSeed; vColor = color;
    int lane = int(aLane + 0.5);
    vLane = uLane[lane] * uShow[int(aKind + 0.5)];
    vTime = uLaneTime[lane];
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const LINE_FRAG = /* glsl */ `
  uniform float uClock;
  uniform float uFlow;
  varying float vT; varying float vStart; varying float vDur; varying float vWin;
  varying float vBase; varying float vSeed; varying float vLane; varying float vTime; varying float vPeak;
  varying vec3 vColor;
  void main() {
    if (vLane <= 0.001) discard;
    float r = clamp((vTime - vStart) / vDur, 0.0, 1.0);
    if (r <= 0.0 || vT > r) discard;
    float live = 1.0 - smoothstep(0.0, 0.6, vTime - vWin);
    float head = exp(-pow((vT - r) * 10.0, 2.0)) * (1.0 - step(1.0, r));
    // pulse runs on the wall clock so it keeps travelling after the timeline ends
    float pulse = exp(-pow((fract(uClock * 0.4 + vSeed) - vT) * 8.0, 2.0)) * uFlow;
    float a = mix(vBase, vPeak, live) + pulse * (0.22 + 0.3 * live) * vPeak + head * 0.35;
    gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0) * vLane);
  }
`

/* ---------------------------------------------------------- build the run -- */

const pill = 'rounded-md bg-card/90 px-1.5 py-0.5 text-xs leading-tight text-foreground shadow-xs ring-1 ring-border backdrop-blur-sm'

function build(data: DrkgData) {
  const { scene, positions: P } = data
  const at = (row: number): Vec3 => [P[row * 3], P[row * 3 + 1], P[row * 3 + 2]]
  const profiles = [...scene.profiles].sort((a, b) => a.lane - b.lane)
  const end = start(profiles.length - 1) + WIN + OUTRO

  const dots: Dot[] = [{ pos: scene.als.pos, color: new THREE.Color('#d3a2a8'), size: 13, shape: SHAPE.als, start: 0.1, lane: -1, settle: 1 }]
  const lines: Seg[] = []
  const labels: Label[] = []
  const focus: { target: THREE.Vector3; dist: number; query: Vec3 }[] = []

  labels.push({
    pos: new THREE.Vector3(...scene.als.pos),
    lane: -1,
    priority: 0,
    opacity: (t) => ramp(t, 0.2, 0.6),
    node: (
      <span className={cn(pill, 'font-medium')}>
        ALS <span className="font-normal text-muted-foreground">{scene.als.id.replace('Disease::', '')}</span>
      </span>
    ),
  })

  for (const p of profiles) {
    const s = start(p.lane)
    const win = s + WIN
    const hex = LANE_COLORS[p.lane % LANE_COLORS.length]
    const c = new THREE.Color(hex)
    const soft = new THREE.Color(hex).lerp(PAPER, 0.4)
    // Labels belong to the active profile, or to the profile hovered in the list.
    const live = (t: number, f: number | null) => (f !== null ? (f === p.lane ? 1 : 0) : window_(t, s, win + 0.1, 0.35))

    p.genes.forEach((g, gi) => {
      if (g.alsEdge) lines.push({ a: scene.als.pos, b: g.pos, color: c, start: s + gi * 0.08, dur: 0.55, lane: p.lane, base: 0.32, kind: KIND.edge })
      dots.push({ pos: g.pos, color: c, size: 11, shape: SHAPE.gene, start: s + 0.3 + gi * 0.08, lane: p.lane, settle: 0.85 })
      const a0 = s + 1.4 + gi * 0.15
      lines.push({ a: g.pos, b: g.query, color: c, start: a0, dur: 0.6, lane: p.lane, base: 0.3, kind: KIND.vector })
      dots.push({ pos: g.query, color: c, size: 11, shape: SHAPE.query, start: a0 + 0.55, lane: p.lane, settle: 0.7, kind: KIND.vector })
      labels.push({
        pos: new THREE.Vector3(...g.pos),
        lane: p.lane,
        priority: 1,
        opacity: live,
        node: (
          <span className={cn(pill, 'flex items-center gap-1 font-mono font-medium')}>
            <span className="size-1.5 rounded-full" style={{ background: hex }} aria-hidden />
            {g.symbol}
          </span>
        ),
      })
    })

    const matchRows = new Set(p.matches.map((m) => m.row))
    const fanned = new Set<number>()
    p.edges.forEach((e, j) => {
      const st = s + 0.45 + (p.edges.length > 1 ? j / (p.edges.length - 1) : 0) * 0.6
      // dozens per profile: lighter stroke so the fan reads as texture, not ink
      lines.push({ a: at(e.from), b: at(e.to), color: soft, start: st, dur: 0.5, lane: p.lane, base: 0.08, kind: KIND.edge, peak: 0.26 })
      if (!matchRows.has(e.to) && !fanned.has(e.to)) {
        fanned.add(e.to)
        dots.push({ pos: at(e.to), color: soft, size: 6, shape: SHAPE.compound, start: st + 0.5, lane: p.lane, settle: 0.5, kind: KIND.edge })
      }
    })

    const first = p.genes[0]
    // first gene wins: a --from-levi scene can repeat an anchor (ALS ×3)
    const queries = new Map<string, Vec3>()
    for (const g of p.genes) if (!queries.has(g.symbol)) queries.set(g.symbol, g.query)
    p.matches.forEach((m, k) => {
      const q = queries.get(m.viaGene) ?? first?.query ?? scene.als.pos
      const r0 = s + 2.1 + k * 0.18
      lines.push({ a: q, b: m.pos, color: soft, start: r0, dur: 0.45, lane: p.lane, base: 0.18, kind: KIND.vector })
      const pop = r0 + 0.4
      dots.push({ pos: m.pos, color: c, size: k === 0 ? 12 : 9.5, shape: SHAPE.matched, start: pop, lane: p.lane, settle: k === 0 ? 1 : 0.8 })
      labels.push({
        pos: new THREE.Vector3(...m.pos),
        lane: p.lane,
        priority: 2 + k,
        opacity: (t, f) => {
          const shown = ramp(t, pop, pop + 0.3)
          if (f !== null) return f === p.lane ? shown : 0
          // After its window, only the top hit stays, at the lowest priority.
          return shown * Math.max(1 - ramp(t, win + 0.1, win + 0.45), k === 0 && t >= end - OUTRO ? 1 : 0)
        },
        node: (
          <span className={cn(pill, 'flex items-baseline gap-1.5')} title={m.name}>
            <span className="text-muted-foreground tabular-nums">{m.rank}</span>
            <span className="max-w-[10rem] truncate font-medium">{m.name}</span>
            <span className="font-mono text-muted-foreground tabular-nums">{m.distance.toFixed(2)}</span>
          </span>
        ),
      })
    })

    // Camera focus: centroid of everything this profile touches.
    const pts = [...p.genes.flatMap((g) => [g.pos, g.query]), ...p.matches.map((m) => m.pos)].map((v) => new THREE.Vector3(...v))
    const target = pts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(Math.max(1, pts.length))
    const radius = pts.reduce((r, v) => Math.max(r, v.distanceTo(target)), 0)
    const top = p.matches[0]
    focus.push({ target, dist: THREE.MathUtils.clamp(radius * 2.3 + 7, 13, 28), query: (top && queries.get(top.viaGene)) ?? first?.query ?? scene.als.pos })
  }

  return { dots, lines, labels, focus, end, profiles }
}

type Built = ReturnType<typeof build>
export type Layers = { edges: boolean; vector: boolean; labels: boolean }

/* ------------------------------------------------------------------ world -- */

type WorldProps = {
  data: DrkgData
  built: Built
  clusters: { list: Cluster[]; index: Uint8Array }
  hidden: Set<number>
  hiddenTypes: Set<number>
  layers: Layers
  status: StageStatus
  /** the stage was already done when this scene mounted (revisit): open on the end state */
  startAtEnd: boolean
  reduce: boolean
  focusLane: number | null
  selectedLane: number | null
  replay: number
  labelEls: React.RefObject<(HTMLDivElement | null)[]>
  labelSize: React.RefObject<{ w: number; h: number }[]>
  onPhase: (phase: string, lane: number | null) => void
  onReveal?: (n: number) => void
  onHover: (h: { row: number; x: number; y: number } | null) => void
}

const World = memo(function World(props: WorldProps) {
  const { data, built, clusters, hidden, hiddenTypes, layers, status, startAtEnd, reduce, focusLane, selectedLane, replay, labelEls, labelSize, onPhase, onReveal, onHover } = props
  const { camera, gl, size } = useThree()
  const dpr = gl.getPixelRatio()
  const t = useRef(startAtEnd || reduce ? built.end : 0)
  const guided = useRef(true)
  const lastPhase = useRef('')
  const lastReveal = useRef(-1)
  const laneAlpha = useRef(new Float32Array(5).fill(1))
  // Per-lane clock: normally the global one; a selected lane replays on its own.
  const solo = useRef<(number | null)[]>([null, null, null, null, null])

  useEffect(() => {
    if (replay === 0) return
    t.current = reduce ? built.end : 0
    solo.current = solo.current.map(() => null)
    guided.current = true
  }, [replay, reduce, built.end])

  useEffect(() => {
    solo.current = solo.current.map(() => null)
    if (selectedLane !== null) {
      solo.current[selectedLane] = reduce ? built.end : start(selectedLane)
      guided.current = true
    }
  }, [selectedLane, reduce, built.end])

  useEffect(() => {
    if (reduce) t.current = built.end
  }, [reduce, built.end])

  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.enablePan = false
    c.minDistance = 5
    c.maxDistance = 46
    c.rotateSpeed = 0.6
    c.addEventListener('start', () => (guided.current = false))
    return c
  }, [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])

  const pointMaterial = useCallback(
    (sizeScale: number, fog: number) =>
      new THREE.ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          uPx: { value: dpr },
          uSize: { value: sizeScale },
          uHidden: { value: new Array(MAX_CLUSTERS).fill(0) },
          uHiddenType: { value: new Array(MAX_TYPES).fill(0) },
          uPaper: { value: PAPER },
          uInk: { value: new THREE.Color(INK) },
          uFog: { value: fog },
          uQuery: { value: new THREE.Vector3() },
          uScan: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [dpr],
  )

  /* background cloud: one Points; colour = cluster, size = degree, shape = type */
  const cloud = useMemo(() => {
    const { positions, types, degree, scene } = data
    const n = positions.length / 3
    const palette = clusters.list.map((c) => new THREE.Color(c.color))
    const typeShape = scene.types.map((ty) =>
      ty.name === 'Compound' ? SHAPE.compound : ty.name === 'Gene' ? SHAPE.gene : ty.name === 'Disease' ? SHAPE.disease : SHAPE.other,
    )
    const p99 = Math.log1p(scene.meta.degree?.p99 ?? 1)
    const color = new Float32Array(n * 3)
    const aCluster = new Float32Array(n)
    const aShape = new Float32Array(n)
    const aSize = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const k = Math.min(clusters.index[i], MAX_CLUSTERS - 1)
      const c = palette[k] ?? palette[0]
      color[i * 3] = c.r
      color[i * 3 + 1] = c.g
      color[i * 3 + 2] = c.b
      aCluster[i] = k
      aShape[i] = typeShape[types[i]] ?? SHAPE.other
      // Same mapping as the legend: 4 + 8 · log1p(degree) / log1p(p99), clamped.
      aSize[i] = degree ? 4 + 8 * Math.min(1, Math.log1p(degree[i]) / p99) : 7
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
    geo.setAttribute('aCluster', new THREE.BufferAttribute(aCluster, 1))
    geo.setAttribute('aShape', new THREE.BufferAttribute(aShape, 1))
    geo.setAttribute('aType', new THREE.BufferAttribute(Float32Array.from(types), 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n).fill(0.85), 1))
    geo.computeBoundingSphere()
    return new THREE.Points(geo, pointMaterial(0.75, 0.7))
  }, [data, clusters, pointMaterial])

  useEffect(() => {
    ;(cloud.material as THREE.ShaderMaterial).uniforms.uHidden.value = Array.from({ length: MAX_CLUSTERS }, (_, i) =>
      clusters.list[i] && hidden.has(clusters.list[i].id) ? 1 : 0,
    )
  }, [cloud, hidden, clusters])

  useEffect(() => {
    ;(cloud.material as THREE.ShaderMaterial).uniforms.uHiddenType.value = Array.from({ length: MAX_TYPES }, (_, i) => (hiddenTypes.has(i) ? 1 : 0))
  }, [cloud, hiddenTypes])

  /* traversal overlay: ALS, genes, query vectors, matches, edge-linked compounds */
  const overlay = useMemo(() => {
    const n = built.dots.length
    const pos = new Float32Array(n * 3)
    const color = new Float32Array(n * 3)
    const shape = new Float32Array(n)
    built.dots.forEach((d, i) => {
      pos.set(d.pos, i * 3)
      color.set([d.color.r, d.color.g, d.color.b], i * 3)
      shape[i] = d.shape
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
    geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 1))
    geo.setAttribute('aCluster', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1))
    geo.setAttribute('aType', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1))
    geo.computeBoundingSphere()
    const mat = pointMaterial(1, 0)
    mat.depthTest = false
    const pts = new THREE.Points(geo, mat)
    pts.renderOrder = 3
    return pts
  }, [built, pointMaterial])

  /* all lines in one draw call */
  const lines = useMemo(() => {
    const n = built.lines.length
    const f = (k: number) => new Float32Array(n * k)
    const [pos, color, aT, aStart, aDur, aWin, aBase, aLane, aSeed, aKind, aPeak] = [f(6), f(6), f(2), f(2), f(2), f(2), f(2), f(2), f(2), f(2), f(2)]
    built.lines.forEach((e, i) => {
      pos.set([...e.a, ...e.b], i * 6)
      color.set([e.color.r, e.color.g, e.color.b, e.color.r, e.color.g, e.color.b], i * 6)
      const win = start(e.lane) + WIN
      const seed = (i * 0.618) % 1
      aT.set([0, 1], i * 2)
      for (const [arr, v] of [[aStart, e.start], [aDur, e.dur], [aWin, win], [aBase, e.base], [aLane, e.lane], [aSeed, seed], [aKind, e.kind], [aPeak, e.peak ?? 0.6]] as const) arr.set([v, v], i * 2)
    })
    const geo = new THREE.BufferGeometry()
    const attrs: [string, Float32Array, number][] = [
      ['position', pos, 3], ['color', color, 3], ['aT', aT, 1], ['aStart', aStart, 1], ['aDur', aDur, 1],
      ['aWin', aWin, 1], ['aBase', aBase, 1], ['aLane', aLane, 1], ['aSeed', aSeed, 1], ['aKind', aKind, 1], ['aPeak', aPeak, 1],
    ]
    for (const [name, arr, k] of attrs) geo.setAttribute(name, new THREE.BufferAttribute(arr, k))
    const mat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: {
        uClock: { value: 0 },
        uFlow: { value: 1 },
        uLane: { value: Array.from(laneAlpha.current) },
        uLaneTime: { value: [0, 0, 0, 0, 0] },
        uShow: { value: [1, 1, 1] },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    const ls = new THREE.LineSegments(geo, mat)
    ls.frustumCulled = false
    ls.renderOrder = 2
    return ls
  }, [built])

  useEffect(
    () => () => {
      for (const o of [cloud, overlay, lines]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [cloud, overlay, lines],
  )

  /* overview camera on mount and replay */
  useEffect(() => {
    camera.position.set(9, 7, 25)
    controls.target.set(0, 0, 0)
    controls.update()
  }, [camera, controls, replay])

  const v = useMemo(() => new THREE.Vector3(), [])
  const goal = useMemo(() => new THREE.Vector3(), [])
  const off = useMemo(() => new THREE.Vector3(), [])
  const order = useMemo(() => built.labels.map((_, i) => i).sort((a, b) => built.labels[a].priority - built.labels[b].priority), [built])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    if (status !== 'pending' && t.current < built.end) t.current = Math.min(built.end, t.current + dt)
    const time = t.current
    const playing = time < built.end && status !== 'pending'
    const n = built.profiles.length
    const so = solo.current
    for (let i = 0; i < 5; i++) if (so[i] !== null) so[i] = Math.min(built.end, (so[i] as number) + dt)
    const laneTime = (lane: number) => (lane < 0 ? time : (so[lane] ?? time))
    const kindOn = (kind: number = KIND.core) => (kind === KIND.edge ? layers.edges : kind === KIND.vector ? layers.vector : true)

    // selected lane dims the rest hard; a hovered lane is a lighter preview
    const pick = selectedLane ?? focusLane
    const la = laneAlpha.current
    for (let i = 0; i < 5; i++) {
      const want = pick === null || pick === i ? 1 : selectedLane !== null ? 0.12 : 0.35
      la[i] += (want - la[i]) * (1 - Math.exp(-dt * 10))
    }
    const laneA = (lane: number) => (lane < 0 ? 1 : Math.min(1, la[lane] ?? 1))

    // active profile + phase text
    let active = -1
    for (let i = 0; i < n; i++) if (time >= start(i)) active = i
    let phase = `${data.scene.meta.entities.toLocaleString()} DRKG entities`
    let lane: number | null = null
    if (status !== 'pending') {
      if (time < LEAD) phase = `ALS · ${data.scene.als.id}`
      else if (playing && active >= 0) {
        const p = built.profiles[active]
        const u = time - start(active)
        lane = p.lane
        phase =
          u < 1.4 ? `Walking edges · ${p.genes.map((g) => g.symbol).join(', ')}`
          : u < 2.1 ? `e[${p.genes[0]?.symbol ?? 'gene'}] − r[target]`
          : `L2 scan · ${data.scene.meta.universe.toLocaleString()} compounds`
      } else phase = `Done · top ${data.scene.meta.topK} per profile by 400-d L2`
    }
    if (phase !== lastPhase.current) {
      lastPhase.current = phase
      onPhase(phase, lane)
    }
    const revealed = built.profiles.filter((p) => time >= start(p.lane) + WIN - 0.3).length
    if (revealed !== lastReveal.current) {
      lastReveal.current = revealed
      onReveal?.(revealed)
    }

    // opacity = closeness to the active query, only while it scans
    const cu = (cloud.material as THREE.ShaderMaterial).uniforms
    let scan = 0
    for (let i = 0; i < n; i++) {
      const w = window_(laneTime(built.profiles[i].lane), start(i) + 2.0, start(i) + WIN - 0.2, 0.4)
      if (w > scan) {
        scan = w
        cu.uQuery.value.set(...built.focus[i].query)
      }
    }
    cu.uScan.value = scan
    cu.uPx.value = dpr
    ;(overlay.material as THREE.ShaderMaterial).uniforms.uPx.value = dpr

    const sizeA = overlay.geometry.attributes.aSize as THREE.BufferAttribute
    const alphaA = overlay.geometry.attributes.aAlpha as THREE.BufferAttribute
    built.dots.forEach((d, i) => {
      const lt = laneTime(d.lane)
      const appear = easeOut(ramp(lt, d.start, d.start + 0.3))
      const own = d.lane < 0 ? 1 : 1 - (1 - d.settle) * ramp(lt, start(d.lane) + WIN, start(d.lane) + WIN + 0.6)
      sizeA.array[i] = d.size * (0.85 + 0.15 * appear)
      alphaA.array[i] = kindOn(d.kind) ? appear * own * laneA(d.lane) : 0
    })
    sizeA.needsUpdate = true
    alphaA.needsUpdate = true

    const lu = (lines.material as THREE.ShaderMaterial).uniforms
    lu.uClock.value = state.clock.elapsedTime
    lu.uFlow.value = reduce ? 0 : 1
    lu.uLane.value = Array.from(la)
    lu.uLaneTime.value = [0, 1, 2, 3, 4].map(laneTime)
    lu.uShow.value = [1, layers.edges ? 1 : 0, layers.vector ? 1 : 0]

    // camera guidance (until the user grabs the controls)
    controls.autoRotate = !reduce
    controls.autoRotateSpeed = 0.3
    if (guided.current) {
      const sel = selectedLane === null ? -1 : built.profiles.findIndex((p) => p.lane === selectedLane)
      const f = sel >= 0 ? built.focus[sel] : playing && time >= LEAD && active >= 0 && time < built.end - OUTRO ? built.focus[active] : null
      if (f) goal.copy(f.target)
      else goal.set(0, 0, 0)
      const want = f ? f.dist : 27
      const k = 1 - Math.exp(-dt * 1.4)
      controls.target.lerp(goal, k)
      off.copy(camera.position).sub(controls.target)
      const len = off.length()
      off.setLength(len + (want - len) * easeInOut(Math.min(1, k * 1.6)))
      camera.position.copy(controls.target).add(off)
    }
    controls.update(dt)

    // DOM labels: priority order, drop any that would overlap one already placed
    const els = labelEls.current
    const sizes = labelSize.current
    const placed: number[][] = []
    for (const i of order) {
      const el = els?.[i]
      if (!el) continue
      const l = built.labels[i]
      const op = layers.labels ? l.opacity(laneTime(l.lane), pick) * laneA(l.lane) : 0
      v.copy(l.pos).project(camera)
      let show = op > 0.01 && v.z < 1
      const { w, h } = sizes?.[i] ?? { w: 80, h: 20 }
      const x = ((v.x + 1) / 2) * size.width
      // keep the pill inside the canvas when its point sits near the top edge
      const y = Math.max(((1 - v.y) / 2) * size.height, LEADER + h + 6)
      if (show) {
        const box = [x - w / 2 - 2, y - LEADER - h - 2, x + w / 2 + 2, y - LEADER + 2]
        show = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])
        if (show) placed.push(box)
      }
      el.style.opacity = show ? String(op) : '0'
      if (show) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    }
  })

  return (
    <>
      <primitive
        object={cloud}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (e.index === undefined) return
          e.stopPropagation()
          onHover({ row: e.index, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
        }}
        onPointerOut={() => onHover(null)}
      />
      <primitive object={lines} />
      <primitive object={overlay} />
    </>
  )
})

/* ------------------------------------------------------------------ shell -- */

export function DrkgScene({
  src = DEFAULT_SRC,
  status,
  focusLane = null,
  selectedLane = null,
  onSelectLane,
  onReveal,
  className,
}: {
  /** scene.json of a run; its binaries sit beside it. Point at a live backend's output. */
  src?: string
  status: StageStatus
  /** hovered profile: a light preview */
  focusLane?: number | null
  /** clicked profile: camera goes there, others dim, its traversal replays once */
  selectedLane?: number | null
  onSelectLane?: (lane: number | null) => void
  onReveal?: (revealed: number) => void
  className?: string
}) {
  const { data, error } = useDrkg(src)
  // Decided at mount, not when the data lands: a slow load must not skip the replay.
  const [startAtEnd] = useState(status === 'done')
  const reduce = useReducedMotion()
  const built = useMemo(() => (data ? build(data) : null), [data])
  const clusters = useMemo(() => (data ? clustersOf(data) : null), [data])
  const labelEls = useRef<(HTMLDivElement | null)[]>([])
  const labelSize = useRef<{ w: number; h: number }[]>([])
  const [phase, setPhase] = useState<{ text: string; lane: number | null }>({ text: '', lane: null })
  const [replay, setReplay] = useState(0)
  const [hidden, setHidden] = useState<Set<number>>(() => new Set())
  const [hiddenTypes, setHiddenTypes] = useState<Set<number>>(() => new Set())
  const [layerList, setLayerList] = useState<string[]>(['edges', 'vector', 'labels'])
  const layers = useMemo<Layers>(
    () => ({ edges: layerList.includes('edges'), vector: layerList.includes('vector'), labels: layerList.includes('labels') }),
    [layerList],
  )
  const [hover, setHover] = useState<{ row: number; x: number; y: number } | null>(null)
  const [names, setNames] = useState<Record<string, string> | null>(null)

  const onHover = useCallback((h: { row: number; x: number; y: number } | null) => {
    setHover(h)
    if (h) loadNames(src).then(setNames, () => {})
  }, [src])
  const onPhase = useCallback((text: string, lane: number | null) => setPhase({ text, lane }), [])
  const flip = (id: number) => (h: Set<number>) => {
    const next = new Set(h)
    if (!next.delete(id)) next.add(id)
    return next
  }
  const toggle = useCallback((id: number) => setHidden(flip(id)), [])
  const toggleType = useCallback((idx: number) => setHiddenTypes(flip(idx)), [])

  // Measure each label once; collision avoidance then needs no layout reads per frame.
  useLayoutEffect(() => {
    labelSize.current = labelEls.current.map((el) => {
      const pillEl = el?.lastElementChild as HTMLElement | null | undefined
      return { w: pillEl?.offsetWidth ?? 0, h: pillEl?.offsetHeight ?? 0 }
    })
  }, [built])

  // Spread, not literal props: the legend grows its props in a parallel branch.
  const legendProps = (scene: DrkgData['scene']) => ({
    scene,
    hidden,
    onToggleCluster: toggle,
    hiddenTypes,
    onToggleType: toggleType,
    activeLane: selectedLane ?? focusLane ?? phase.lane,
    phase: phase.text || null,
    selectedLane,
    onSelectLane: onSelectLane ?? (() => {}),
  })

  const meta = data?.scene.meta
  const variance = meta?.explainedVariance?.length ? (meta.explainedVariance.reduce((a, b) => a + b, 0) * 100).toFixed(1) : null
  const hoverType = hover && data ? data.scene.types[data.types[hover.row]]?.name : null
  const hoverCluster = hover && clusters ? clusters.list[clusters.index[hover.row]] : null

  return (
    // Light only: the scene is drawn against the paper tokens, never the dark theme.
    <div className={cn('flex gap-3', className)} style={{ colorScheme: 'light' }}>
      <div className="relative isolate min-w-0 flex-1 overflow-hidden rounded-xl bg-card ring-1 ring-border backdrop-blur-md">
        {built && data && clusters ? (
          <>
            <Canvas
              camera={{ position: [9, 7, 25], fov: 42, near: 0.1, far: 200 }}
              dpr={[1, 1.75]}
              gl={{ alpha: true, antialias: true }}
              raycaster={{ params: { Points: { threshold: 0.08 } } } as never}
              onPointerMissed={() => setHover(null)}
              aria-label="3D view of the DRKG embedding space with the stage 3 traversal"
            >
              <World
                data={data}
                built={built}
                clusters={clusters}
                hidden={hidden}
                hiddenTypes={hiddenTypes}
                layers={layers}
                status={status}
                startAtEnd={startAtEnd}
                reduce={reduce}
                focusLane={focusLane}
                selectedLane={selectedLane}
                replay={replay}
                labelEls={labelEls}
                labelSize={labelSize}
                onPhase={onPhase}
                onReveal={onReveal}
                onHover={onHover}
              />
            </Canvas>

            {/* labels: anchored at the point, pill above a short leader line */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {built.labels.map((l, i) => (
                <div key={i} ref={(el) => void (labelEls.current[i] = el)} className="absolute top-0 left-0 opacity-0">
                  <div className="absolute bottom-0 left-0 w-px -translate-x-1/2 bg-foreground/35" style={{ height: LEADER }} />
                  <div className="absolute left-0 w-max -translate-x-1/2 whitespace-nowrap" style={{ bottom: LEADER }}>
                    {l.node}
                  </div>
                </div>
              ))}
            </div>

            <div className="absolute top-3 left-3 flex items-center gap-2">
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                spacing={0}
                value={layerList}
                onValueChange={setLayerList}
                aria-label="Layers"
                className="bg-card/90 text-xs"
              >
                <ToggleGroupItem value="edges" className="px-2.5 text-xs">Edges</ToggleGroupItem>
                <ToggleGroupItem value="vector" className="px-2.5 text-xs">Vector arithmetic</ToggleGroupItem>
                <ToggleGroupItem value="labels" className="px-2.5 text-xs">Labels</ToggleGroupItem>
              </ToggleGroup>
              <Button variant="outline" size="sm" className="bg-card/90 text-xs" onClick={() => setReplay((n) => n + 1)}>
                <RotateCcw aria-hidden /> Replay
              </Button>
            </div>

            <p className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] rounded-md bg-card/80 px-2 py-1 text-[0.6875rem] leading-snug text-muted-foreground backdrop-blur-sm">
              {variance ? `PCA-3 of 400-d TransE · ${variance}% variance shown` : 'Clustered layout of 400-d TransE · positions are not distances'} · rankings use true 400-d L2 · drag to rotate, scroll to zoom
            </p>

            {hover ? (
              <div
                className={cn(pill, 'pointer-events-none absolute top-0 left-0 z-10 max-w-xs px-2 py-1')}
                style={{ transform: `translate3d(${hover.x + 14}px, ${hover.y + 14}px, 0)` }}
              >
                <p className="truncate font-medium">{names?.[String(hover.row)] ?? (names ? `Entity ${hover.row}` : 'Loading…')}</p>
                <p className="text-muted-foreground">
                  {hoverType}
                  {hoverCluster && hoverCluster.label !== hoverType ? ` · ${hoverCluster.label}` : ''}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            {error ? (
              <span>DRKG scene unavailable ({error}). Run frontend/scripts/drkg_scene.py.</span>
            ) : (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading 97,238 DRKG embeddings…
              </>
            )}
          </div>
        )}
      </div>
      {data ? <DrkgLegend {...legendProps(data.scene)} /> : null}
    </div>
  )
}
