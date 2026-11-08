import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DrkgData } from '@/components/discovery/drkg-data'
import { TypeGlyph } from '@/components/discovery/drkg-legend'
import { cn } from '@/lib/utils'

/**
 * All 97,238 DRKG entities as one THREE.Points. Same visual grammar as the
 * stage-3 scene: position = clustered TransE layout, colour = type or cluster,
 * size = log degree, shape = type (Compound ● · Gene ○ · Disease ◆ · other ·).
 * Selection is a sparse `aHi` attribute plus a `uDim` uniform, never a rewrite
 * of all colours.
 */

const MAX_TYPES = 16
const PAPER = new THREE.Color('#f7f4ee')
const INK = '#13293d'

/* --------------------------------------------------------------- colours -- */

/** OKLCH → sRGB hex (three can't parse oklch()). */
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
/**
 * Hand-placed [L, C, hue] per scene.json type index. Compound/Gene/Disease have their own
 * glyphs; the ten soft-dot types are kept apart by hue AND lightness, and the type filter
 * plus hover tooltip are the non-colour path.
 */
const TYPE_LCH: [number, number, number][] = [
  [0.62, 0.11, 195], // Gene
  [0.6, 0.12, 340], //  Compound
  [0.66, 0.11, 125], // Biological Process
  [0.6, 0.11, 255], //  Side Effect
  [0.58, 0.13, 30], //  Disease
  [0.54, 0.11, 315], // Atc
  [0.76, 0.11, 80], //  Molecular Function
  [0.52, 0.1, 160], //  Pathway
  [0.76, 0.08, 215], // Cellular Component
  [0.74, 0.09, 10], //  Symptom
  [0.5, 0.08, 50], //   Anatomy
  [0.74, 0.08, 285], // Pharmacologic Class
  [0.5, 0.02, 245], //  Tax
]
export const typeHex = (i: number) => {
  const [l, c, h] = TYPE_LCH[i] ?? [0.6, 0.02, 245]
  return oklch(l, c, h)
}
export const clusterHex = (id: number, color?: string) => (color?.startsWith('#') ? color : oklch(0.7, 0.085, (id * 137.508 + 200) % 360))

const shapeOf = (type: string) => (type === 'Compound' ? 0 : type === 'Gene' ? 1 : type === 'Disease' ? 2 : 3)

/* --------------------------------------------------------------- shaders -- */

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  attribute float aShape;
  attribute float aType;
  attribute float aHi;
  uniform float uPx;
  uniform float uDim;
  uniform float uPass[${MAX_TYPES}];
  uniform vec3 uPaper;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float hi = step(0.5, aHi);
    float boost = aHi > 1.5 ? 2.2 : mix(1.0 - 0.45 * uDim, 1.5, hi);
    gl_PointSize = aSize * 0.75 * boost * uPx * (24.0 / -mv.z);
    float fog = smoothstep(18.0, 60.0, -mv.z) * 0.6 * (1.0 - hi);
    vColor = mix(color, uPaper, fog);
    float pass = uPass[int(aType + 0.5)];
    vAlpha = hi > 0.5 ? 1.0 : 0.7 * mix(0.045, 1.0, pass) * mix(1.0, 0.08, uDim);
    vShape = aShape;
  }
`
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  float edge(float d, float r, float aa) { return 1.0 - smoothstep(r - aa, r, d); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float dd = (abs(c.x) + abs(c.y)) * 2.0;
    float aa = max(fwidth(d), 0.02) * 1.2;
    int s = int(vShape + 0.5);
    float a;
    if (s == 0) a = edge(d, 1.0, aa);                                   // compound: filled disc
    else if (s == 1) a = edge(d, 1.0, aa) * (1.0 - edge(d, 0.4, aa));  // gene: ring
    else if (s == 2) a = edge(dd, 0.95, aa);                            // disease: diamond
    else a = (1.0 - smoothstep(0.15, 0.55, d)) * 0.85;                  // other: soft dot
    a *= vAlpha;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`
// Selected entity: an ink ring at a constant on-screen size.
const HALO_VERT = /* glsl */ `
  uniform float uPx;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 34.0 * uPx;
  }
`
const HALO_FRAG = /* glsl */ `
  uniform vec3 uInk;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float aa = fwidth(d) * 1.2;
    float ring = smoothstep(0.78 - aa, 0.78, d) * (1.0 - smoothstep(0.9, 0.9 + aa, d));
    if (ring <= 0.01) discard;
    gl_FragColor = vec4(uInk, ring * 0.9);
    #include <colorspace_fragment>
  }
`

/* ----------------------------------------------------------------- world -- */

export type ColorBy = 'type' | 'cluster'
type Label = { row: number; text: string }

type WorldProps = {
  data: DrkgData
  colorBy: ColorBy
  clusterColors: string[]
  only: Set<number>
  selected: number | null
  neighbours: Uint32Array | null
  knn: Uint32Array | null
  reduce: boolean
  clusterEls: React.RefObject<(HTMLDivElement | null)[]>
  centroids: THREE.Vector3[]
  labelEls: React.RefObject<(HTMLDivElement | null)[]>
  labels: Label[]
  /** per island (centroids order): 1 if its dominant type passes the type filter */
  clusterPass: number[]
  onHover: (h: { row: number; x: number; y: number } | null) => void
  onSelect: (row: number) => void
}

const World = memo(function World(props: WorldProps) {
  const { data, colorBy, clusterColors, only, selected, neighbours, knn, reduce, clusterEls, centroids, labelEls, labels, clusterPass, onHover, onSelect } = props
  const { camera, gl, size } = useThree()
  const n = data.types.length
  const P = data.positions
  const ui = useRef({ flying: false, idleSince: performance.now(), dragging: false, dim: 0, rotating: false })
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover

  // in an effect, not useMemo: StrictMode would leak a connected duplicate and dispose the kept one
  const controls = useRef<OrbitControls | null>(null)

  const colours = useMemo(() => {
    const t = data.scene.types.map((_, i) => new THREE.Color(typeHex(i)))
    const c = clusterColors.map((h) => new THREE.Color(h))
    const byType = new Float32Array(n * 3)
    const byCluster = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = t[data.types[i]] ?? t[0]
      byType.set([a.r, a.g, a.b], i * 3)
      const b = c[data.clusters?.[i] ?? 0] ?? a
      byCluster.set([b.r, b.g, b.b], i * 3)
    }
    return { byType, byCluster, type: t }
  }, [data, clusterColors, n])

  const cloud = useMemo(() => {
    const { types, degree, scene } = data
    const shape = scene.types.map((t) => shapeOf(t.name))
    const p99 = Math.log1p(scene.meta.degree?.p99 ?? 1)
    const aShape = new Float32Array(n)
    const aSize = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      aShape[i] = shape[types[i]] ?? 3
      aSize[i] = degree ? 4 + 8 * Math.min(1, Math.log1p(degree[i]) / p99) : 7
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colours.byType.slice(), 3))
    geo.setAttribute('aShape', new THREE.BufferAttribute(aShape, 1))
    geo.setAttribute('aType', new THREE.BufferAttribute(Float32Array.from(types), 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    geo.setAttribute('aHi', new THREE.BufferAttribute(new Float32Array(n), 1))
    geo.computeBoundingSphere()
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uPx: { value: 1 },
        uDim: { value: 0 },
        uPass: { value: new Array(MAX_TYPES).fill(1) },
        uPaper: { value: PAPER },
      },
      transparent: true,
      depthWrite: false,
    })
    return new THREE.Points(geo, mat)
  }, [data, colours, P, n])

  const halo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    const mat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uPx: { value: 1 }, uInk: { value: new THREE.Color(INK) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const pts = new THREE.Points(geo, mat)
    pts.renderOrder = 3
    pts.frustumCulled = false
    pts.visible = false
    return pts
  }, [])

  const edges = useMemo(() => {
    const ls = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    )
    ls.renderOrder = 1
    ls.frustumCulled = false
    return ls
  }, [])
  const dashed = useMemo(() => {
    const ls = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: INK, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    )
    ls.renderOrder = 2
    ls.frustumCulled = false
    return ls
  }, [])

  useEffect(
    () => () => {
      for (const o of [cloud, halo, edges, dashed]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [cloud, halo, edges, dashed],
  )

  /* colour mode: one copy of a precomputed array */
  useEffect(() => {
    const attr = cloud.geometry.attributes.color as THREE.BufferAttribute
    ;(attr.array as Float32Array).set(colorBy === 'type' ? colours.byType : colours.byCluster)
    attr.needsUpdate = true
  }, [cloud, colours, colorBy])

  /* type filter: a 16-float uniform */
  useEffect(() => {
    ;(cloud.material as THREE.ShaderMaterial).uniforms.uPass.value = Array.from({ length: MAX_TYPES }, (_, i) => (only.size === 0 || only.has(i) ? 1 : 0))
  }, [cloud, only])

  const lit = useRef<number[]>([])
  const goal = useMemo(() => new THREE.Vector3(), [])
  const home = useMemo(() => {
    const b = cloud.geometry.boundingSphere!
    return { center: b.center.clone(), dist: b.radius * 2.9 }
  }, [cloud])
  const want = useRef(home.dist)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.enablePan = true
    c.screenSpacePanning = true
    c.minDistance = 1.5
    c.maxDistance = 80
    c.rotateSpeed = 0.6
    c.autoRotateSpeed = 0.25
    c.addEventListener('start', () => {
      ui.current.flying = false
      ui.current.dragging = true
      hoverRef.current(null)
    })
    c.addEventListener('end', () => {
      ui.current.dragging = false
      ui.current.idleSince = performance.now()
    })
    c.target.copy(home.center)
    camera.position.copy(home.center).add(new THREE.Vector3(0.33, 0.25, 0.91).multiplyScalar(home.dist))
    c.update()
    controls.current = c
    return () => {
      c.dispose()
      controls.current = null
    }
  }, [camera, gl, home])

  /* camera: centre on the selection, back off to fit its graph neighbours. Re-aims only for a
     new selection or when its neighbours first arrive, never for a kNN or relation toggle. */
  const framed = useRef<{ sel: number | null; loaded: boolean }>({ sel: null, loaded: false })
  useEffect(() => {
    const f = framed.current
    const loaded = neighbours !== null
    if (f.sel === selected && (f.loaded || !loaded)) return
    framed.current = { sel: selected, loaded }
    if (selected === null) {
      goal.copy(home.center)
      want.current = home.dist
    } else {
      goal.set(P[selected * 3], P[selected * 3 + 1], P[selected * 3 + 2])
      let r = 0
      if (neighbours)
        for (const q of neighbours) {
          const dx = P[q * 3] - goal.x, dy = P[q * 3 + 1] - goal.y, dz = P[q * 3 + 2] - goal.z
          r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz))
        }
      want.current = THREE.MathUtils.clamp(r * 2.2 + 3, 7, home.dist)
    }
    ui.current.flying = true
  }, [selected, neighbours, P, goal, home])

  /* selection highlight: touch only the rows that change */
  useEffect(() => {
    const attr = cloud.geometry.attributes.aHi as THREE.BufferAttribute
    const hi = attr.array as Float32Array
    for (const r of lit.current) hi[r] = 0
    const next: number[] = []
    if (selected !== null) {
      for (const list of [neighbours, knn]) if (list) for (const r of list) (hi[r] = 1), next.push(r)
      hi[selected] = 2
      next.push(selected)
    }
    lit.current = next
    attr.needsUpdate = true

    const seg = (geo: THREE.BufferGeometry, rows: Uint32Array | null, colour: boolean) => {
      const m = selected === null || !rows ? 0 : rows.length
      const pos = new Float32Array(m * 6)
      const col = colour ? new Float32Array(m * 6) : null
      for (let k = 0; k < m; k++) {
        const r = rows![k]
        pos.set([P[selected! * 3], P[selected! * 3 + 1], P[selected! * 3 + 2], P[r * 3], P[r * 3 + 1], P[r * 3 + 2]], k * 6)
        if (col) {
          const c = colours.type[data.types[r]]
          col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      geo.dispose()
      return g
    }
    edges.geometry = seg(edges.geometry, neighbours, true)
    dashed.geometry = seg(dashed.geometry, knn, false)
    dashed.computeLineDistances()

    if (selected === null) halo.visible = false
    else {
      ;(halo.geometry.attributes.position as THREE.BufferAttribute).set([P[selected * 3], P[selected * 3 + 1], P[selected * 3 + 2]])
      halo.geometry.attributes.position.needsUpdate = true
      halo.visible = true
    }
  }, [cloud, halo, edges, dashed, selected, neighbours, knn, P, colours, data.types])

  const v = useMemo(() => new THREE.Vector3(), [])
  const off = useMemo(() => new THREE.Vector3(), [])
  const placed = useMemo(() => [] as number[], [])
  const labelPos = useMemo(() => new THREE.Vector3(), [])
  const dims = useMemo(() => new WeakMap<HTMLElement, [number, number]>(), [])
  const lastView = useMemo(() => new THREE.Matrix4(), [])
  const dirty = useRef(true)
  // one batched layout read per label set, never inside the frame loop
  useLayoutEffect(() => {
    for (const el of [...(labelEls.current ?? []), ...(clusterEls.current ?? [])]) if (el && !dims.has(el)) dims.set(el, [el.offsetWidth, el.offsetHeight])
    dirty.current = true
  }, [labels, centroids, labelEls, clusterEls, dims])
  useEffect(() => {
    dirty.current = true
  }, [clusterPass, size])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = ui.current
    const dpr = gl.getPixelRatio()
    const cu = (cloud.material as THREE.ShaderMaterial).uniforms
    cu.uPx.value = dpr
    ;(halo.material as THREE.ShaderMaterial).uniforms.uPx.value = dpr

    // dim / line fades: exponential approach, ~200 ms
    const k = reduce ? 1 : 1 - Math.exp(-dt * 14)
    s.dim += ((selected !== null ? 1 : 0) - s.dim) * k
    cu.uDim.value = s.dim
    const em = edges.material as THREE.LineBasicMaterial
    em.opacity += ((selected !== null ? 0.32 : 0) - em.opacity) * k
    const dm = dashed.material as THREE.LineDashedMaterial
    dm.opacity += ((selected !== null && knn ? 0.7 : 0) - dm.opacity) * k

    const c = controls.current
    if (!c) return
    // camera: ease toward the selection; reduced motion jumps
    if (s.flying) {
      const f = reduce ? 1 : 1 - Math.exp(-dt * 3.2)
      c.target.lerp(goal, f)
      off.copy(camera.position).sub(c.target)
      const len = off.length()
      off.setLength(len + (want.current - len) * f)
      camera.position.copy(c.target).add(off)
      if (c.target.distanceTo(goal) < 0.005 && Math.abs(len - want.current) < 0.02) s.flying = false
    }
    const rotate = !reduce && !s.dragging && performance.now() - s.idleSince > 20000
    if (rotate && !s.rotating) hoverRef.current(null) // the point under the cursor is about to move
    s.rotating = c.autoRotate = rotate
    c.update(dt)

    // DOM labels: entity labels first, then islands by size; drop overlaps.
    // Skipped while the view and inputs are still.
    camera.updateMatrixWorld()
    const fading = Math.abs((selected !== null ? 1 : 0) - s.dim) > 1e-3
    if (!dirty.current && !fading && lastView.equals(camera.matrixWorld)) return
    dirty.current = false
    lastView.copy(camera.matrixWorld)
    placed.length = 0
    const put = (el: HTMLDivElement | null | undefined, p: THREE.Vector3, opacity: number) => {
      if (!el) return
      v.copy(p).project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      let d = dims.get(el) // normally measured in the layout effect above; a ref that landed later is read here once
      if (!d) dims.set(el, (d = [el.offsetWidth, el.offsetHeight]))
      const [w, h] = d
      let show = opacity > 0.01 && v.z < 1 && x > -w && x < size.width + w && y > 0 && y < size.height + h
      if (show) {
        const x0 = x - w / 2 - 3, y0 = y - h - 10, x1 = x + w / 2 + 3, y1 = y - 6
        for (let i = 0; i < placed.length; i += 4)
          if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) {
            show = false
            break
          }
        if (show) placed.push(x0, y0, x1, y1)
      }
      el.style.opacity = show ? String(opacity) : '0'
      if (show) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, calc(-100% - 8px))`
    }
    for (let i = 0; i < labels.length; i++) {
      const r = labels[i].row
      put(labelEls.current?.[i], labelPos.set(P[r * 3], P[r * 3 + 1], P[r * 3 + 2]), 1)
    }
    for (let i = 0; i < centroids.length; i++) put(clusterEls.current?.[i], centroids[i], (0.9 - 0.7 * s.dim) * clusterPass[i])
  })

  const visible = (row: number) => only.size === 0 || only.has(data.types[row]) || (selected !== null && (cloud.geometry.attributes.aHi.array as Float32Array)[row] > 0)
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    // the point closest to the cursor ray; with a selection, lit neighbours win over the dimmed cloud
    const hi = cloud.geometry.attributes.aHi.array as Float32Array
    let best: number | null = null
    let bestKey = Infinity
    for (const hit of e.intersections)
      if (hit.object === cloud && hit.index !== undefined && visible(hit.index)) {
        const key = (hit.distanceToRay ?? 0) + (selected !== null && hi[hit.index] === 0 ? 1e3 : 0)
        if (key < bestKey) (bestKey = key), (best = hit.index)
      }
    return best
  }

  return (
    <>
      <primitive
        object={cloud}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (ui.current.dragging) return
          const row = pick(e)
          onHover(row === null ? null : { row, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 4) return
          const row = pick(e)
          if (row !== null) onSelect(row)
        }}
      />
      <primitive object={edges} />
      <primitive object={dashed} />
      <primitive object={halo} />
    </>
  )
})

/* ----------------------------------------------------------------- shell -- */

const pill = 'rounded-md bg-popover/95 px-1.5 py-0.5 text-sm leading-tight text-foreground shadow-xs ring-1 ring-border'

export function GraphCanvas({
  data,
  colorBy,
  only,
  selected,
  neighbours,
  knn,
  labels,
  reduce,
  labelOf,
  onSelect,
  className,
}: {
  data: DrkgData
  colorBy: ColorBy
  only: Set<number>
  selected: number | null
  neighbours: Uint32Array | null
  knn: Uint32Array | null
  /** entity labels drawn in the scene, selected first */
  labels: Label[]
  reduce: boolean
  labelOf: (row: number) => string
  onSelect: (row: number) => void
  className?: string
}) {
  // the row re-renders on change only; the position is written straight to the element
  const [hover, setHover] = useState<number | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const tipAt = useRef({ x: 0, y: 0 })
  const placeTip = useCallback(() => {
    const el = tip.current
    const box = el?.parentElement
    if (!el || !box) return
    const { x, y } = tipAt.current
    const w = el.offsetWidth, h = el.offsetHeight
    const tx = x + 14 + w > box.clientWidth ? x - 14 - w : x + 14 // flip at the right / bottom edge
    const ty = y + 14 + h > box.clientHeight ? y - 14 - h : y + 14
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }, [])
  const onHover = useCallback(
    (h: { row: number; x: number; y: number } | null) => {
      if (h) tipAt.current = h
      setHover(h ? h.row : null)
      placeTip()
    },
    [placeTip],
  )
  useLayoutEffect(placeTip, [hover, placeTip])
  useEffect(() => setHover(null), [selected])
  const clusterEls = useRef<(HTMLDivElement | null)[]>([])
  const labelEls = useRef<(HTMLDivElement | null)[]>([])

  const clusters = useMemo(() => data.scene.clusters ?? [], [data])
  const clusterColors = useMemo(() => clusters.map((c) => clusterHex(c.id, c.color)), [clusters])
  const centroids = useMemo(() => {
    const sum = clusters.map(() => new THREE.Vector3())
    const cnt = clusters.map(() => 0)
    const P = data.positions
    if (data.clusters)
      for (let i = 0; i < data.clusters.length; i++) {
        const c = data.clusters[i]
        if (!sum[c]) continue
        sum[c].x += P[i * 3]
        sum[c].y += P[i * 3 + 1]
        sum[c].z += P[i * 3 + 2]
        cnt[c]++
      }
    return sum.map((s, i) => s.divideScalar(Math.max(1, cnt[i])))
  }, [data, clusters])
  // largest islands win label collisions
  const clusterOrder = useMemo(() => clusters.map((_, i) => i).sort((a, b) => clusters[b].size - clusters[a].size), [clusters])
  const orderedCentroids = useMemo(() => clusterOrder.map((i) => centroids[i]), [clusterOrder, centroids])
  const clusterPass = useMemo(() => {
    const idx = new Map(data.scene.types.map((t, i) => [t.name, i]))
    return clusterOrder.map((ci) => (only.size === 0 || only.has(idx.get(clusters[ci].dominantType) ?? -1) ? 1 : 0))
  }, [clusterOrder, clusters, only, data])

  useLayoutEffect(() => {
    labelEls.current.length = labels.length
  }, [labels])

  const type = hover !== null ? data.scene.types[data.types[hover]]?.name : null

  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      <Canvas
        camera={{ position: [9, 7, 25], fov: 42, near: 0.05, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        raycaster={{ params: { Points: { threshold: 0.09 } } } as never}
        onPointerMissed={() => setHover(null)}
        aria-label="3D map of every DRKG entity. Drag to rotate, scroll to zoom, click a point to inspect it."
        className={hover !== null ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
      >
        <World
          data={data}
          colorBy={colorBy}
          clusterColors={clusterColors}
          only={only}
          selected={selected}
          neighbours={neighbours}
          knn={knn}
          reduce={reduce}
          clusterEls={clusterEls}
          centroids={orderedCentroids}
          labelEls={labelEls}
          labels={labels}
          clusterPass={clusterPass}
          onHover={onHover}
          onSelect={onSelect}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {clusterOrder.map((ci, i) => (
          <div
            key={ci}
            ref={(el) => void (clusterEls.current[i] = el)}
            className="absolute top-0 left-0 w-max whitespace-nowrap rounded-full bg-popover/85 px-2 py-0.5 text-sm leading-tight font-medium text-foreground/80 opacity-0"
          >
            {clusters[ci].label} <span className="font-normal text-muted-foreground tabular-nums">{clusters[ci].size.toLocaleString('en-US')}</span>
          </div>
        ))}
        {labels.map((l, i) => (
          <div
            key={`${l.row}-${i}`}
            ref={(el) => void (labelEls.current[i] = el)}
            className={cn(pill, 'absolute top-0 left-0 w-max max-w-[14rem] truncate opacity-0', i === 0 && selected === l.row && 'font-medium ring-foreground/30')}
          >
            {l.text}
          </div>
        ))}
      </div>

      {hover !== null ? (
        <div ref={tip} className={cn(pill, 'pointer-events-none absolute top-0 left-0 z-10 max-w-xs px-2 py-1')}>
          <p className="truncate font-medium">{labelOf(hover) || `Entity ${hover}`}</p>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            {type ? <TypeGlyph type={type} color={typeHex(data.types[hover])} size={10} /> : null}
            {type}
            {data.degree ? (
              <>
                {' · '}
                <span className="tabular-nums">{data.degree[hover].toLocaleString('en-US')}</span> edges
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  )
}
