import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildNeuron } from '../lib/neuron'
import { NeuronSim, glowTexture } from '../lib/neuron-sim'

type Props = {
  /** Smoothed 0→1 colour progress, owned by the page. */
  progressRef: RefObject<number>
  /** Soma position as viewport fractions, for the ripple. */
  onSpike: (x: number, y: number) => void
  reducedMotion: boolean
}

const FOV = 35

function Scene({ progressRef, onSpike, reducedMotion }: Props) {
  const { size, camera, gl } = useThree()
  const glow = useMemo(glowTexture, [])
  const neuron = useMemo(() => new NeuronSim(buildNeuron(7), { glow, autoInterval: reducedMotion ? 0 : 2.6 }), [glow, reducedMotion])
  const rig = useRef<THREE.Group>(null)

  useEffect(() => {
    const v = new THREE.Vector3()
    neuron.onSpike = () => {
      neuron.group.getWorldPosition(v).project(camera)
      onSpike((v.x + 1) / 2, (1 - v.y) / 2)
    }
  }, [neuron, camera, onSpike])

  useEffect(() => () => { neuron.dispose(); glow.dispose() }, [neuron, glow])

  // Title + button sit bottom-left (card.io layout), so the cell takes the upper right.
  const wide = size.width / size.height > 1.1
  const layout = wide
    ? { position: [-0.5, 1.9, 0] as const, rotation: -0.15, scale: 0.74 }
    : { position: [-1.5, 4.5, 0] as const, rotation: -0.5, scale: 0.42 }

  useFrame((state, delta) => {
    neuron.setPointScale((state.size.height * state.viewport.dpr) / (2 * Math.tan((FOV * Math.PI) / 360)))
    neuron.update(Math.min(delta, 0.05), progressRef.current ?? 0)
    if (rig.current && !reducedMotion) {
      const t = state.clock.elapsedTime
      const ty = Math.sin(t * 0.16) * 0.22 + state.pointer.x * 0.12
      const tx = Math.sin(t * 0.11) * 0.06 - state.pointer.y * 0.06
      rig.current.rotation.y += (ty - rig.current.rotation.y) * 0.04
      rig.current.rotation.x += (tx - rig.current.rotation.x) * 0.04
    }
  })

  return (
    <group ref={rig}>
      <group position={layout.position} rotation={[0, 0, layout.rotation]} scale={layout.scale}>
        <primitive object={neuron.group} />
        {/* Generous invisible hit target around the soma: click to fire. */}
        <mesh
          onClick={(e) => {
            e.stopPropagation()
            neuron.fire()
          }}
          onPointerOver={() => (gl.domElement.style.cursor = 'pointer')}
          onPointerOut={() => (gl.domElement.style.cursor = '')}
        >
          <sphereGeometry args={[2, 16, 12]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
    </group>
  )
}

export default memo(function NeuronCanvas(props: Props) {
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 0, 20], fov: FOV, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden
    >
      <Scene {...props} />
    </Canvas>
  )
})
