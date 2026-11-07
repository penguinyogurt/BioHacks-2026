import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Procedural motor neuron.
 *
 * Every vertex carries `aDist`: path distance from the soma. Dendrites are
 * negative, the soma is 0, the axon and its terminals are positive. The
 * membrane shader uses it to draw action potentials travelling down the
 * real geometry, and the simulation uses it to know when a front reaches a
 * synaptic bouton.
 */

type Rng = () => number

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const V = THREE.Vector3

function randUnit(r: Rng, out = new V()) {
  const u = r() * 2 - 1
  const th = r() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return out.set(s * Math.cos(th), s * Math.sin(th), u)
}

function deviate(r: Rng, dir: THREE.Vector3, angle: number) {
  const axis = randUnit(r).cross(dir).normalize()
  return dir.clone().applyAxisAngle(axis, angle)
}

/** Tube along a curve with a radius profile and a linear `aDist` from d0 to d1. */
function tube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radius: (t: number) => number,
  d0: number,
  d1: number,
) {
  const frames = curve.computeFrenetFrames(segments, false)
  const count = (segments + 1) * (radial + 1)
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  const dist = new Float32Array(count)
  const P = new V()
  const N = new V()
  let k = 0
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, P)
    const rad = radius(t)
    const d = d0 + (d1 - d0) * t
    const Ni = frames.normals[i]
    const Bi = frames.binormals[i]
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2
      const s = Math.sin(v)
      const c = -Math.cos(v)
      N.set(c * Ni.x + s * Bi.x, c * Ni.y + s * Bi.y, c * Ni.z + s * Bi.z).normalize()
      pos[k * 3] = P.x + rad * N.x
      pos[k * 3 + 1] = P.y + rad * N.y
      pos[k * 3 + 2] = P.z + rad * N.z
      nor[k * 3] = N.x
      nor[k * 3 + 1] = N.y
      nor[k * 3 + 2] = N.z
      dist[k] = d
      k++
    }
  }
  const index: number[] = []
  for (let j = 1; j <= segments; j++) {
    for (let i = 1; i <= radial; i++) {
      const a = (radial + 1) * (j - 1) + (i - 1)
      const b = (radial + 1) * j + (i - 1)
      const c = (radial + 1) * j + i
      const d = (radial + 1) * (j - 1) + i
      index.push(a, b, d, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1))
  geo.setIndex(index)
  return geo
}

/** Persistent random walk: a neurite that wanders but keeps its heading. */
function walk(
  r: Rng,
  start: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  steps: number,
  wiggle: number,
  bias?: THREE.Vector3,
  biasAmount = 0,
) {
  const pts = [start.clone()]
  const d = dir.clone().normalize()
  const p = start.clone()
  const tmp = new V()
  const step = length / steps
  for (let k = 0; k < steps; k++) {
    d.addScaledVector(randUnit(r, tmp), wiggle)
    if (bias) d.addScaledVector(bias, biasAmount)
    d.normalize()
    p.addScaledVector(d, step)
    pts.push(p.clone())
  }
  return pts
}

type Leaf = { pts: THREE.Vector3[]; end: THREE.Vector3; dir: THREE.Vector3; dist: number }

type GrowOpts = {
  r: Rng
  sign: 1 | -1
  rTip: number
  wiggle: number
  childLength: [number, number]
  branchAngle: [number, number]
  geos: THREE.BufferGeometry[]
  leaves: Leaf[]
}

function grow(
  o: GrowOpts,
  start: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  r0: number,
  depth: number,
  distStart: number,
  chain: THREE.Vector3[],
) {
  const steps = Math.max(4, Math.round(length * 4))
  const pts = walk(o.r, start, dir, length, steps, o.wiggle)
  const curve = new THREE.CatmullRomCurve3(pts)
  const len = curve.getLength()
  const r1 = depth === 0 ? o.rTip : r0 * 0.66
  o.geos.push(tube(curve, steps * 3, 6, (t) => r0 + (r1 - r0) * t, o.sign * distStart, o.sign * (distStart + len)))
  const full = chain.length ? chain.concat(pts.slice(1)) : pts
  const endDir = curve.getTangentAt(1)
  if (depth === 0) {
    o.leaves.push({ pts: full, end: pts[pts.length - 1].clone(), dir: endDir, dist: distStart + len })
    return
  }
  const kids = o.r() < 0.3 ? 3 : 2
  for (let k = 0; k < kids; k++) {
    const angle = o.branchAngle[0] + o.r() * (o.branchAngle[1] - o.branchAngle[0])
    const childLen = length * (o.childLength[0] + o.r() * (o.childLength[1] - o.childLength[0]))
    grow(o, pts[pts.length - 1], deviate(o.r, endDir, angle), childLen, r1, depth - 1, distStart + len, full)
  }
}

export type NeuronData = {
  soma: THREE.BufferGeometry
  dendrites: THREE.BufferGeometry
  axon: THREE.BufferGeometry
  myelin: THREE.BufferGeometry
  somaRadius: number
  nucleusOffset: THREE.Vector3
  /** Paths from each dendrite tip to the soma, for incoming synaptic signals. */
  inputs: THREE.CatmullRomCurve3[]
  axonCurve: THREE.CatmullRomCurve3
  axonLength: number
  boutons: { pos: THREE.Vector3; dir: THREE.Vector3; dist: number }[]
  maxDist: number
}

export function buildNeuron(seed: number, opts: { axonLength?: number; dendrites?: number } = {}): NeuronData {
  const r = mulberry32(seed)
  const somaR = 0.85
  const axonDir = new V(1, -0.12, 0.08).normalize()

  // Primary dendrite headings: away from the axon, flattened toward the viewer's plane.
  const trunkDirs: THREE.Vector3[] = []
  const nDend = opts.dendrites ?? 7
  for (let i = 0; i < nDend; i++) {
    const a = Math.PI * 0.35 + (i / nDend) * Math.PI * 1.3 + (r() - 0.5) * 0.35
    trunkDirs.push(new V(Math.cos(a) - 0.15, Math.sin(a), (r() - 0.5) * 1.1).normalize())
  }

  // Soma: displaced sphere that swells into each trunk and the axon hillock.
  let soma: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 16)
  soma.deleteAttribute('normal')
  soma.deleteAttribute('uv')
  soma = mergeVertices(soma)
  const sp = soma.attributes.position as THREE.BufferAttribute
  const u = new V()
  for (let i = 0; i < sp.count; i++) {
    u.fromBufferAttribute(sp, i).normalize()
    let rr = somaR * (1 + 0.06 * Math.sin(5 * u.x + 2 * u.y) * Math.cos(4 * u.z))
    for (const d of trunkDirs) rr += somaR * 0.5 * Math.pow(Math.max(0, u.dot(d)), 10)
    rr += somaR * 0.6 * Math.pow(Math.max(0, u.dot(axonDir)), 12)
    sp.setXYZ(i, u.x * rr, u.y * rr, u.z * rr * 0.85)
  }
  soma.computeVertexNormals()
  soma.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(sp.count), 1))

  // Dendritic arbor.
  const dGeos: THREE.BufferGeometry[] = []
  const dLeaves: Leaf[] = []
  const dOpts: GrowOpts = {
    r, sign: -1, rTip: 0.014, wiggle: 0.3,
    childLength: [0.6, 0.85], branchAngle: [0.35, 0.8],
    geos: dGeos, leaves: dLeaves,
  }
  trunkDirs.forEach((d, i) => {
    const apical = i === Math.floor(nDend / 2)
    grow(dOpts, d.clone().multiplyScalar(somaR * 1.1), d, (apical ? 1.9 : 1.25) + r() * 0.5, apical ? 0.2 : 0.15, 3, 0, [])
  })

  // Axon: long, gently wandering, myelinated.
  const aStart = axonDir.clone().multiplyScalar(somaR * 1.3)
  const aLen = opts.axonLength ?? 11
  const axPts = walk(r, aStart, axonDir, aLen, 12, 0.12, new V(1, -0.1, 0), 0.12)
  const axonCurve = new THREE.CatmullRomCurve3(axPts)
  const axonLength = axonCurve.getLength()
  const axonR = 0.075
  const aGeos = [tube(axonCurve, 220, 8, (t) => axonR + 0.1 * Math.max(0, 1 - t * 25), 0, axonLength)]

  const mGeos: THREE.BufferGeometry[] = []
  const internode = 0.82
  const gap = 0.13
  for (let s = 0.75; s + internode < axonLength - 0.45; s += internode + gap) {
    const sample: THREE.Vector3[] = []
    for (let k = 0; k <= 8; k++) sample.push(axonCurve.getPointAt((s + (internode * k) / 8) / axonLength))
    mGeos.push(
      tube(new THREE.CatmullRomCurve3(sample), 24, 12, (t) => axonR + 0.09 * Math.pow(Math.sin(Math.PI * t), 0.35), s, s + internode),
    )
  }

  // Terminal arbor ending in synaptic boutons.
  const tLeaves: Leaf[] = []
  const tOpts: GrowOpts = {
    r, sign: 1, rTip: 0.03, wiggle: 0.35,
    childLength: [0.55, 0.85], branchAngle: [0.3, 0.75],
    geos: aGeos, leaves: tLeaves,
  }
  const aEnd = axPts[axPts.length - 1]
  const aTan = axonCurve.getTangentAt(1)
  for (let k = 0; k < 4; k++) grow(tOpts, aEnd, deviate(r, aTan, 0.25 + r() * 0.6), 0.9 + r() * 0.6, axonR * 0.8, 1, axonLength, [])

  const boutons = tLeaves.map((l) => ({ pos: l.end, dir: l.dir, dist: l.dist }))
  return {
    soma,
    dendrites: mergeGeometries(dGeos),
    axon: mergeGeometries(aGeos),
    myelin: mergeGeometries(mGeos),
    somaRadius: somaR,
    nucleusOffset: new V(-0.12, 0.1, 0.18),
    inputs: dLeaves.map((l) => new THREE.CatmullRomCurve3(l.pts.slice().reverse())),
    axonCurve,
    axonLength,
    boutons,
    maxDist: Math.max(...boutons.map((b) => b.dist)),
  }
}
