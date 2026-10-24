import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, type LineSegments } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { fallLevels } from '../domain/graph'
import type { Analysis } from '../domain/graph'
import type { Layout } from '../domain/layout'
import { Blocks } from './Blocks'

const BG = '#D9D2FF'

interface Props {
  analysis: Analysis
  layout: Layout
  pulled: number | null
  reducedMotion: boolean
  recording: boolean
  onPull: (index: number) => void
  onCanvas: (canvas: HTMLCanvasElement) => void
}

/** Thin lines from each package to what it depends on. Lines that touch a fallen block disappear. */
function Struts({ analysis, layout, pulled }: Pick<Props, 'analysis' | 'layout' | 'pulled'>) {
  const lines = useRef<LineSegments>(null)
  const geometry = useMemo(() => new BufferGeometry(), [])
  useLayoutEffect(() => {
    const gone = new Set<number>()
    if (pulled !== null) {
      gone.add(pulled)
      for (const i of fallLevels(analysis.dependents, pulled).keys()) gone.add(i)
    }
    const out: number[] = []
    for (const [from, to] of analysis.graph.edges) {
      if (gone.has(from) || gone.has(to)) continue
      const a = layout.placements[from]
      const b = layout.placements[to]
      if (a && b) out.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(out), 3))
    geometry.computeBoundingSphere()
  }, [analysis, layout, pulled, geometry])
  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#111111" transparent opacity={0.16} />
    </lineSegments>
  )
}

function Framing({ layout }: { layout: Layout }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.size)
  useLayoutEffect(() => {
    const size = Math.max(layout.height * 1.15, layout.width, layout.depth)
    // On a tall, narrow screen the width decides the distance, not the height. The fallen pile spreads wider than the tower.
    const half = Math.tan(((38 / 2) * Math.PI) / 180)
    const aspect = viewport.width / Math.max(1, viewport.height)
    const fitWidth = (Math.max(layout.width, layout.depth) * 1.6) / (2 * half * aspect)
    const distance = Math.max(14, size * 1.75, fitWidth)
    camera.position.set(distance * 0.5, layout.height * 0.55 + distance * 0.22, distance * 0.95)
    if (controls) {
      controls.target.set(0, layout.height * 0.38, 0)
      controls.update()
    } else {
      camera.lookAt(0, layout.height * 0.38, 0)
    }
    invalidate()
  }, [layout, camera, controls, invalidate, viewport])
  return null
}

export function Scene({
  analysis,
  layout,
  pulled,
  reducedMotion,
  recording,
  onPull,
  onCanvas,
}: Props) {
  const span = Math.max(layout.width, layout.depth, layout.height) * 0.9 + 6
  const label = pulled === null ? null : layout.placements[pulled]
  const name = pulled === null ? '' : (analysis.graph.nodes[pulled]?.name ?? '')
  return (
    <Canvas
      className="canvas"
      frameloop={recording ? 'always' : 'demand'}
      shadows="basic"
      dpr={recording ? 1 : [1, 2]}
      camera={{ fov: 38, near: 0.5, far: 400 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => onCanvas(gl.domElement)}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 70, 190]} />
      <ambientLight intensity={1.35} />
      <directionalLight
        castShadow
        position={[-span * 0.5, span * 1.6, span * 0.7]}
        intensity={2.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={1}
        shadow-camera-far={span * 5}
        shadow-bias={-0.0004}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshToonMaterial color="#C9C0F7" />
      </mesh>
      <Blocks
        analysis={analysis}
        layout={layout}
        pulled={pulled}
        reducedMotion={reducedMotion}
        onPull={onPull}
      />
      <Struts analysis={analysis} layout={layout} pulled={pulled} />
      {label && (
        <Html
          position={[label.x, label.y + 1.1, label.z]}
          center
          zIndexRange={[4, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="sticker">pulled: {name}</div>
        </Html>
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        minDistance={6}
        maxDistance={140}
        maxPolarAngle={Math.PI / 2 - 0.04}
      />
      <Framing layout={layout} />
    </Canvas>
  )
}
