import * as THREE from 'three'
import type { NeuronData } from './neuron'

/**
 * Drives one neuron: incoming synaptic signals run up the dendrites, the soma
 * fires, an action potential runs down the axon, and every bouton it reaches
 * releases a puff of neurotransmitter.
 *
 * Colours interpolate from a grey "unstained" state to a fluorescence palette
 * as `progress` goes 0 → 1 (the same grey-to-colour arc as card.io's heart).
 */

const C = (hex: string) => new THREE.Color(hex)
const PALETTE = {
  membrane: { grey: [C('#4f5663'), C('#a3abb8')], live: [C('#1597bd'), C('#86f2ff')] },
  myelin: { grey: [C('#3e434d'), C('#868d99')], live: [C('#3b46b8'), C('#aab4ff')] },
  spike: { grey: C('#8f96a3'), live: C('#7fe3f5') },
  synapse: { grey: C('#b9bec8'), live: C('#ff4fa3') },
  nucleus: { grey: C('#3b3f47'), live: C('#2f4dff') },
}

const membraneVS = /* glsl */ `
attribute float aDist;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vDist = aDist;
  gl_Position = projectionMatrix * mv;
}`

const membraneFS = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uRim;
uniform vec3 uSpike;
uniform vec4 uFronts;
uniform float uFlash;
uniform float uActivity;
uniform float uIntensity;
uniform float uFadeRoot;
varying vec3 vN;
varying vec3 vV;
varying float vDist;

float front(float f) {
  float x = vDist - f;
  return exp(-x * x * 2.4);
}

void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float onAxon = step(0.0, vDist);
  float wave = (front(uFronts.x) + front(uFronts.y) + front(uFronts.z) + front(uFronts.w)) * onAxon;
  float prox = exp(-abs(min(vDist, 0.0)) * 1.2);
  float flash = uFlash * prox;
  vec3 col = uBase * (0.16 + 0.5 * fres)
           + uRim * fres * (0.5 + 0.2 * uActivity)
           + uSpike * (wave * (0.3 + 0.5 * fres) + flash * (0.1 + 0.3 * fres));
  // Neurites start buried in the soma; fade their open ends so they don't ring.
  float root = mix(1.0, smoothstep(0.05, 0.5, abs(vDist)), uFadeRoot);
  gl_FragColor = vec4(col * uIntensity * root, 1.0);
  #include <colorspace_fragment>
}`

const particleVS = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const particleFS = /* glsl */ `
uniform vec3 uColor;
uniform sampler2D uMap;
varying float vLife;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a;
  gl_FragColor = vec4(uColor * a * vLife, 1.0);
  #include <colorspace_fragment>
}`

export function glowTexture() {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const

function membraneMaterial(fadeRoot = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: membraneVS,
    fragmentShader: membraneFS,
    uniforms: {
      uBase: { value: new THREE.Color() },
      uRim: { value: new THREE.Color() },
      uSpike: { value: new THREE.Color() },
      uFronts: { value: new THREE.Vector4(-1e3, -1e3, -1e3, -1e3) },
      uFlash: { value: 0 },
      uActivity: { value: 0 },
      uIntensity: { value: 1 },
      uFadeRoot: { value: fadeRoot },
    },
    ...additive,
  })
}

type Signal = { sprite: THREE.Sprite; curve: THREE.CatmullRomCurve3 | null; t: number; dur: number }

export type SimOptions = {
  glow: THREE.Texture
  /** Overall brightness; < 1 for out-of-focus background cells. */
  intensity?: number
  /** Mean seconds between spontaneous firings; 0 disables. */
  autoInterval?: number
  particles?: number
}

const AP_SPEED = 9 // scene units per second down the axon
const AP_DELAY = 0.45 // dendritic signals reach the soma, then it fires

export class NeuronSim {
  group = new THREE.Group()
  onSpike?: () => void

  private data: NeuronData
  private intensity: number
  private autoInterval: number
  private autoTimer: number
  private soma = membraneMaterial(0)
  private mem = membraneMaterial(1)
  private myelin = membraneMaterial(0)
  private nucleus: THREE.MeshBasicMaterial
  private boutons: THREE.InstancedMesh
  private boutonFlash: Float32Array
  private signals: Signal[] = []
  private fronts = [-1e3, -1e3, -1e3, -1e3]
  private frontSprites: THREE.Sprite[] = []
  private pending: number[] = []
  private activity = 0
  private flash = 0
  private pts: {
    geo: THREE.BufferGeometry
    mat: THREE.ShaderMaterial
    pos: Float32Array
    vel: Float32Array
    life: Float32Array
    next: number
  }
  private tmpColor = new THREE.Color()

  constructor(data: NeuronData, o: SimOptions) {
    this.data = data
    this.intensity = o.intensity ?? 1
    this.autoInterval = o.autoInterval ?? 0
    this.autoTimer = 0.8 + Math.random() * 1.2

    const g = this.group
    g.add(new THREE.Mesh(data.soma, this.soma))
    g.add(new THREE.Mesh(data.dendrites, this.mem))
    g.add(new THREE.Mesh(data.axon, this.mem))
    g.add(new THREE.Mesh(data.myelin, this.myelin))

    this.nucleus = new THREE.MeshBasicMaterial({ ...additive, toneMapped: false })
    const nuc = new THREE.Mesh(new THREE.SphereGeometry(data.somaRadius * 0.4, 28, 18), this.nucleus)
    nuc.position.copy(data.nucleusOffset)
    nuc.scale.set(1.1, 0.95, 0.8)
    g.add(nuc)

    this.boutons = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 14, 10),
      new THREE.MeshBasicMaterial({ ...additive, toneMapped: false }),
      data.boutons.length,
    )
    const m = new THREE.Matrix4()
    data.boutons.forEach((b, i) => {
      this.boutons.setMatrixAt(i, m.makeTranslation(b.pos.x, b.pos.y, b.pos.z))
      this.boutons.setColorAt(i, this.tmpColor.set(0, 0, 0))
    })
    this.boutonFlash = new Float32Array(data.boutons.length)
    g.add(this.boutons)

    const spriteMat = () => new THREE.SpriteMaterial({ map: o.glow, ...additive, toneMapped: false })
    for (let i = 0; i < 20; i++) {
      const sprite = new THREE.Sprite(spriteMat())
      sprite.visible = false
      g.add(sprite)
      this.signals.push({ sprite, curve: null, t: 0, dur: 1 })
    }
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(spriteMat())
      s.visible = false
      g.add(s)
      this.frontSprites.push(s)
    }

    const n = o.particles ?? 500
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 3)
    const life = new Float32Array(n)
    const size = new Float32Array(n).map(() => 0.05 + Math.random() * 0.08)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVS,
      fragmentShader: particleFS,
      uniforms: { uColor: { value: new THREE.Color() }, uMap: { value: o.glow }, uScale: { value: 600 } },
      ...additive,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    g.add(points)
    this.pts = { geo, mat, pos, vel: new Float32Array(n * 3), life, next: 0 }
  }

  /** Stimulate: a volley of synaptic inputs, then an action potential. */
  fire() {
    const inputs = this.data.inputs
    const n = 3 + Math.floor(Math.random() * 3)
    for (let k = 0; k < n; k++) {
      const s = this.signals.find((x) => !x.curve)
      if (!s) break
      s.curve = inputs[Math.floor(Math.random() * inputs.length)]
      s.dur = AP_DELAY - 0.04 - Math.random() * 0.08
      s.t = -Math.random() * 0.12
    }
    this.pending.push(AP_DELAY)
  }

  setPointScale(scale: number) {
    this.pts.mat.uniforms.uScale.value = scale
  }

  update(dt: number, progress: number) {
    const p = progress
    const I = this.intensity

    if (this.autoInterval > 0) {
      this.autoTimer -= dt
      if (this.autoTimer <= 0) {
        this.fire()
        this.autoTimer = this.autoInterval * (0.65 + Math.random() * 0.7)
      }
    }

    // Colours.
    const spike = this.tmpColor.copy(PALETTE.spike.grey).lerp(PALETTE.spike.live, p)
    const syn = PALETTE.synapse.grey.clone().lerp(PALETTE.synapse.live, p)
    for (const [mat, pal] of [[this.soma, PALETTE.membrane], [this.mem, PALETTE.membrane], [this.myelin, PALETTE.myelin]] as const) {
      const u = mat.uniforms
      u.uBase.value.copy(pal.grey[0]).lerp(pal.live[0], p)
      u.uRim.value.copy(pal.grey[1]).lerp(pal.live[1], p)
      u.uSpike.value.copy(spike)
      u.uIntensity.value = I
    }
    this.nucleus.color.copy(PALETTE.nucleus.grey).lerp(PALETTE.nucleus.live, p).multiplyScalar(0.22 * I * (1 + this.flash * 0.5))
    this.pts.mat.uniforms.uColor.value.copy(syn).multiplyScalar(I * 0.7)

    // Pending action potentials.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i] -= dt
      if (this.pending[i] <= 0) {
        this.pending.splice(i, 1)
        const slot = this.fronts.findIndex((f) => f < -100)
        if (slot >= 0) this.fronts[slot] = 0
        this.flash = 1
        this.activity = Math.min(1, this.activity + 0.5)
        this.onSpike?.()
      }
    }
    this.flash *= Math.exp(-dt * 5)
    this.activity *= Math.exp(-dt * 0.9)

    // Fronts down the axon.
    const { boutons, axonCurve, axonLength, maxDist } = this.data
    for (let i = 0; i < 4; i++) {
      const prev = this.fronts[i]
      const sprite = this.frontSprites[i]
      if (prev < -100) {
        sprite.visible = false
        continue
      }
      const cur = prev + AP_SPEED * dt
      boutons.forEach((b, j) => {
        if (prev < b.dist && cur >= b.dist) {
          this.boutonFlash[j] = 1
          this.burst(j)
        }
      })
      this.fronts[i] = cur > maxDist + 1.5 ? -1e3 : cur
      if (cur <= axonLength) {
        sprite.visible = true
        axonCurve.getPointAt(cur / axonLength, sprite.position)
        sprite.scale.setScalar(0.4)
        ;(sprite.material as THREE.SpriteMaterial).color.copy(spike).multiplyScalar(I * 0.45)
      } else sprite.visible = false
    }
    const f = this.fronts
    for (const mat of [this.soma, this.mem, this.myelin]) {
      mat.uniforms.uFronts.value.set(f[0], f[1], f[2], f[3])
      mat.uniforms.uFlash.value = this.flash
      mat.uniforms.uActivity.value = this.activity
    }

    // Incoming synaptic signals along dendrites.
    for (const s of this.signals) {
      if (!s.curve) continue
      s.t += dt / s.dur
      if (s.t >= 1) {
        s.curve = null
        s.sprite.visible = false
        continue
      }
      const t = Math.max(0, s.t)
      s.sprite.visible = s.t >= 0
      s.curve.getPointAt(t * t, s.sprite.position)
      s.sprite.scale.setScalar(0.34 + 0.1 * t)
      ;(s.sprite.material as THREE.SpriteMaterial).color.copy(syn).multiplyScalar(I * Math.min(1, t * 5))
    }

    // Boutons.
    for (let j = 0; j < boutons.length; j++) {
      this.boutonFlash[j] *= Math.exp(-dt * 3.5)
      const v = (0.22 + this.boutonFlash[j] * 0.7) * I
      this.boutons.setColorAt(j, this.tmpColor.copy(syn).multiplyScalar(v))
    }
    this.boutons.instanceColor!.needsUpdate = true

    // Neurotransmitter particles.
    const { pos, vel, life, geo } = this.pts
    const drag = Math.exp(-dt * 2.2)
    for (let i = 0; i < life.length; i++) {
      if (life[i] <= 0) continue
      life[i] = Math.max(0, life[i] - dt / 1.2)
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
      vel[i * 3] *= drag
      vel[i * 3 + 1] *= drag
      vel[i * 3 + 2] *= drag
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.aLife.needsUpdate = true
  }

  private burst(j: number) {
    const b = this.data.boutons[j]
    const { pos, vel, life } = this.pts
    const n = life.length
    for (let k = 0; k < 18; k++) {
      const i = this.pts.next
      this.pts.next = (i + 1) % n
      const rx = Math.random() * 2 - 1
      const ry = Math.random() * 2 - 1
      const rz = Math.random() * 2 - 1
      const sp = 0.5 + Math.random() * 0.9
      pos[i * 3] = b.pos.x + rx * 0.05
      pos[i * 3 + 1] = b.pos.y + ry * 0.05
      pos[i * 3 + 2] = b.pos.z + rz * 0.05
      vel[i * 3] = (b.dir.x * 0.9 + rx * 0.8) * sp
      vel[i * 3 + 1] = (b.dir.y * 0.9 + ry * 0.8) * sp
      vel[i * 3 + 2] = (b.dir.z * 0.9 + rz * 0.8) * sp
      life[i] = 1
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry && m.geometry !== this.data.soma && m.geometry !== this.data.dendrites && m.geometry !== this.data.axon && m.geometry !== this.data.myelin) m.geometry.dispose()
      const mat = m.material as THREE.Material | undefined
      mat?.dispose()
    })
  }
}
