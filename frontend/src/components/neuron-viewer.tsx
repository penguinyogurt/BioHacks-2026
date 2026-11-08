import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * The neuron, standing upright, spinning about its long axis and firing every
 * few seconds: inputs converge, the soma sparks, an amber pulse runs down
 * the axon, and the terminals release a puff of transmitter.
 * Model: "Neuron Cell Low-poly Simple" by vitalik.kucha, CC BY 4.0
 * (public/models/neuron.LICENSE.txt).
 */

const MODEL_URL = '/models/neuron.glb'
const MODEL_SIZE = 11 // long axis, world units: whole cell in frame
const COLOR = '#2f5f6b' // teal ink
const PULSE = '#f2852f' // warm amber spark against the teal membrane
const OPACITY = 0.55
const AUTO_ROTATE_SPEED = 2.2
const SLANT_DEG = -10 // adds to the model's own lean: top-left to bottom-right

/*
 * Landmarks in the model's own mesh coordinates (long axis = x), measured from
 * its vertices: soma centre, where the axon leaves it, where the terminals begin.
 */
const SOMA = new THREE.Vector3(-1.0, 0.0, 0.2)
const HILLOCK_X = -0.3
const AXON_END = new THREE.Vector3(1.35, 0.1, 0.1)
const TIP_X = 2.45

/* One firing, in seconds from its start. */
const INPUT_S = 0.45 // dendritic inputs converge on the soma
const AP_SPEED = 2.6 // mesh units / s down the axon
const BURST = 10 // particles per terminal

const pulseVert = /* glsl */ `
varying vec3 vPos;`
const pulseFrag = /* glsl */ `
varying vec3 vPos;
uniform vec3 uPulse;
uniform vec3 uSomaC;
uniform float uFront;
uniform float uInward;
uniform float uSoma;`
const pulseApply = /* glsl */ `
  float pulseK;
  {
    float axon = step(${HILLOCK_X.toFixed(2)}, vPos.x);
    // Action potential: a crisp head with a fading tail behind it, so direction reads at a glance.
    float dA = vPos.x - uFront;
    float head = exp(-dA * dA * 90.0);
    float tail = dA < 0.0 ? exp(dA * 5.0) * 0.35 : 0.0;
    float wave = (head + tail) * axon;
    // Synaptic input: a soft ring closing in on the soma.
    float r = length(vPos - uSomaC);
    float dI = r - uInward;
    float inward = exp(-dI * dI * 40.0) * (1.0 - axon) * step(0.0, uInward);
    float soma = uSoma * (1.0 - smoothstep(0.2, 0.55, r));
    pulseK = clamp(wave + inward * 0.18 + soma * 0.4, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uPulse, pulseK * 0.55);
    diffuseColor.a = mix(diffuseColor.a, 1.0, pulseK);
  }`
// Added as unlit light so the lighting can't grey the spark out.
const pulseEmissive = /* glsl */ `
  totalEmissiveRadiance += uPulse * pulseK * 0.75;`

const particleVS = /* glsl */ `
attribute float aLife;
uniform float uSize;
varying float vLife;
void main() {
  vLife = aLife;
  gl_PointSize = uSize * (0.6 + 0.4 * aLife);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const particleFS = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, vLife * 0.9 * (1.0 - smoothstep(0.25, 0.5, d)));
}`

/** Terminal tips: farthest-point sample of the vertices past the axon. */
function terminalTips(geo: THREE.BufferGeometry, n: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i)
    if (v.x > 1.75) pts.push(v)
  }
  if (!pts.length) return []
  const picked = [pts.reduce((a, b) => (b.x > a.x ? b : a))]
  const best = pts.map((p) => p.distanceToSquared(picked[0]))
  while (picked.length < Math.min(n, pts.length)) {
    let k = 0
    for (let i = 1; i < best.length; i++) if (best[i] > best[k]) k = i
    picked.push(pts[k])
    for (let i = 0; i < pts.length; i++) best[i] = Math.min(best[i], pts[i].distanceToSquared(pts[k]))
  }
  return picked
}

function Neuron({ onLoaded, firing }: { onLoaded: () => void; firing: boolean }) {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const dpr = useThree((s) => s.viewport.dpr)

  const { model, center, scale } = useMemo(() => {
    const model = gltf.scene.clone(true)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    return { model, center: box.getCenter(new THREE.Vector3()), scale: MODEL_SIZE / (Math.max(size.x, size.y, size.z) || 1) }
  }, [gltf])

  /** Shared by every membrane material; driven from useFrame. */
  const uniforms = useMemo(
    () => ({
      uPulse: { value: new THREE.Color(PULSE) },
      uSomaC: { value: SOMA.clone() },
      uFront: { value: -10 },
      uInward: { value: -1 },
      uSoma: { value: 0 },
    }),
    [],
  )

  const sparks = useMemo(() => {
    let mesh: THREE.Mesh | undefined
    model.traverse((n) => {
      if (!mesh && (n as THREE.Mesh).isMesh) mesh = n as THREE.Mesh
    })
    const tips = mesh ? terminalTips(mesh.geometry, 8) : []
    const count = Math.max(1, tips.length * BURST)
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const life = new Float32Array(count)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVS,
      fragmentShader: particleFS,
      uniforms: { uColor: { value: new THREE.Color(PULSE) }, uSize: { value: 5 } },
      transparent: true,
      depthWrite: false,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    mesh?.add(points) // lives in mesh space, so it turns with the neuron
    return { tips, points, pos, life, vel: new Float32Array(count * 3) }
  }, [model])

  useEffect(() => {
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((src) => {
        const m = src.clone() as THREE.MeshStandardMaterial
        m.color.set(COLOR)
        m.transparent = true
        m.opacity = OPACITY
        m.depthWrite = false
        m.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms)
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>${pulseVert}`)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPos = position;')
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>${pulseFrag}`)
            .replace('#include <color_fragment>', `#include <color_fragment>${pulseApply}`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${pulseEmissive}`)
        }
        m.customProgramCacheKey = () => 'motus-pulse'
        return m
      })
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0]
    })
    onLoaded()
    return () => {
      sparks.points.geometry.dispose()
      ;(sparks.points.material as THREE.Material).dispose()
      sparks.points.removeFromParent()
    }
  }, [model, onLoaded, uniforms, sparks])

  // Firing loop: inputs converge → soma darkens → action potential runs to the terminals → release.
  const clock = useRef({ t: -1.2, next: 2.8, prevFront: -10 })
  useFrame((_, delta) => {
    sparks.points.material.uniforms.uSize.value = 5 * dpr
    const c = clock.current
    const dt = Math.min(delta, 0.05)
    if (firing) {
      c.t += dt
      if (c.t > c.next) {
        c.t = 0
        c.next = 2.6 + Math.random() * 1.2
      }
    }
    const t = c.t
    uniforms.uInward.value = t >= 0 && t < INPUT_S ? 1.6 - (1.05 * t) / INPUT_S : -1
    uniforms.uSoma.value = t >= 0 ? Math.exp(-(((t - INPUT_S) / 0.2) ** 2)) : 0
    const front = t >= INPUT_S ? HILLOCK_X + (t - INPUT_S) * AP_SPEED : -10
    uniforms.uFront.value = front < TIP_X + 0.3 ? front : -10

    // Release at each terminal as the front reaches it.
    const { tips, pos, life, vel, points } = sparks
    tips.forEach((tip, j) => {
      if (c.prevFront < tip.x && front >= tip.x) {
        const dir = tip.clone().sub(AXON_END).normalize()
        for (let k = 0; k < BURST; k++) {
          const i = j * BURST + k
          pos[i * 3] = tip.x
          pos[i * 3 + 1] = tip.y
          pos[i * 3 + 2] = tip.z
          const sp = 0.12 + Math.random() * 0.2
          vel[i * 3] = (dir.x * 0.8 + (Math.random() - 0.5)) * sp
          vel[i * 3 + 1] = (dir.y * 0.8 + (Math.random() - 0.5)) * sp
          vel[i * 3 + 2] = (dir.z * 0.8 + (Math.random() - 0.5)) * sp
          life[i] = 1
        }
      }
    })
    c.prevFront = front
    for (let i = 0; i < life.length; i++) {
      if (life[i] <= 0) continue
      life[i] = Math.max(0, life[i] - dt / 1.1)
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
    }
    points.geometry.attributes.position.needsUpdate = true
    points.geometry.attributes.aLife.needsUpdate = true
  })

  // The model's long axis is x; turn it 90° so it stands vertically (dendrites up, axon down).
  return (
    <group scale={scale} rotation={[0, 0, -Math.PI / 2]}>
      <group position={[-center.x, -center.y, -center.z]}>
        <primitive object={model} />
      </group>
    </group>
  )
}

/** Spin about the vertical axis only: auto-rotate, and drag left/right to turn it. */
function Controls({ autoRotate }: { autoRotate: boolean }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED
    controls.enableZoom = false
    controls.enablePan = false
    controls.enableDamping = true
    controls.minPolarAngle = Math.PI / 2
    controls.maxPolarAngle = Math.PI / 2
    return () => controls.dispose()
  }, [controls, autoRotate])
  useFrame(() => controls.update())
  return null
}

export default function NeuronViewer({ reducedMotion = false, className = '' }: { reducedMotion?: boolean; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const onLoaded = useMemo(() => () => setLoaded(true), [])
  return (
    <div
      className={`transition-opacity duration-700 ease-out motion-reduce:transition-none ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
      style={{ cursor: 'grab' }}
    >
      {/* Slanted frame: the spin axis tilts with it, so the cell still turns about its own length. */}
      <div className="absolute -inset-[12%]" style={{ transform: `rotate(${SLANT_DEG}deg)` }}>
      <Canvas
        camera={{ position: [0, 0, 12], fov: 65 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        // Size from layout, not the rotated bounding box, so the scene stays centred.
        resize={{ offsetSize: true }}
      >
        <ambientLight intensity={2} />
        <directionalLight position={[8, 8, 6]} intensity={3} />
        <directionalLight position={[-8, 6, 4]} intensity={2} />
        <directionalLight position={[0, -10, 2]} intensity={1.5} />
        <pointLight position={[0, 0, 8]} intensity={2} />
        <Controls autoRotate={!reducedMotion} />
        <Suspense fallback={null}>
          <Neuron onLoaded={onLoaded} firing={!reducedMotion} />
        </Suspense>
      </Canvas>
      </div>
    </div>
  )
}
