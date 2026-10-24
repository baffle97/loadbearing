import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Color,
  DataTexture,
  BackSide,
  NearestFilter,
  Object3D,
  RedFormat,
  type InstancedMesh,
  type Vector3,
} from 'three'
import { fallLevels } from '../domain/graph'
import type { Analysis } from '../domain/graph'
import { BLOCK } from '../domain/layout'
import type { Layout } from '../domain/layout'
import { setHover } from '../lib/hoverBus'
import type { TowerPhysics } from './physics'

const PALETTE = ['#C6F432', '#FF5FA2', '#FFD60A', '#3DD6F5', '#FF8A3D'].map((c) => new Color(c))
const ROOT = new Color('#FFFFFF')
const HOVER = new Color('#111111')
const OUTLINE = 0.055

function colorOf(index: number, height: number, isRoot: boolean): Color {
  return isRoot ? ROOT : (PALETTE[(height * 3 + index) % PALETTE.length] as Color)
}

interface Props {
  analysis: Analysis
  layout: Layout
  pulled: number | null
  reducedMotion: boolean
  onPull: (index: number) => void
}

export function Blocks({ analysis, layout, pulled, reducedMotion, onPull }: Props) {
  const n = analysis.graph.nodes.length
  const body = useRef<InstancedMesh>(null)
  const outline = useRef<InstancedMesh>(null)
  const physics = useRef<TowerPhysics | null>(null)
  const queuedPull = useRef<number | null>(null)
  const active = useRef(false)
  const sincePull = useRef(0)
  const hovered = useRef<number | null>(null)
  const { invalidate, camera } = useThree()
  const controls = useThree((st) => st.controls) as { target: Vector3; update: () => void } | null
  const lookFrom = useRef(0)
  const dummy = useMemo(() => new Object3D(), [])

  // Cel-shading ramp: three flat brightness steps, so faces read as hard planes, not gradients.
  const ramp = useMemo(() => {
    const t = new DataTexture(new Uint8Array([120, 195, 255]), 3, 1, RedFormat)
    t.minFilter = t.magFilter = NearestFilter
    t.needsUpdate = true
    return t
  }, [])

  const write = (
    i: number,
    x: number,
    y: number,
    z: number,
    q?: [number, number, number, number],
    scale = 1,
  ) => {
    dummy.position.set(x, y, z)
    if (q) dummy.quaternion.set(q[0], q[1], q[2], q[3])
    else dummy.quaternion.identity()
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    body.current?.setMatrixAt(i, dummy.matrix)
    dummy.scale.set(
      scale * (1 + (2 * OUTLINE) / BLOCK.w),
      scale * (1 + (2 * OUTLINE) / BLOCK.h),
      scale * (1 + (2 * OUTLINE) / BLOCK.d),
    )
    dummy.updateMatrix()
    outline.current?.setMatrixAt(i, dummy.matrix)
  }

  const flush = () => {
    if (body.current) body.current.instanceMatrix.needsUpdate = true
    if (outline.current) outline.current.instanceMatrix.needsUpdate = true
    invalidate()
  }

  // Standing pose and colours.
  useLayoutEffect(() => {
    for (let i = 0; i < n; i++) {
      const p = layout.placements[i]
      if (!p) continue
      write(i, p.x, p.y, p.z)
      body.current?.setColorAt(i, colorOf(i, analysis.heights[i] ?? 0, i === analysis.graph.root))
    }
    if (body.current?.instanceColor) body.current.instanceColor.needsUpdate = true
    // Bounds must cover the whole scene, or fallen blocks get culled at the edges.
    body.current?.computeBoundingSphere()
    flush()
    // eslint-disable-next-line react/exhaustive-deps
  }, [analysis, layout])

  const start = (index: number) => {
    const world = physics.current
    if (!world) return
    const p = layout.placements[index]
    if (p) write(index, p.x, p.y, p.z, undefined, 0) // the pulled block pops out of existence
    world.pull(fallLevels(analysis.dependents, index))
    sincePull.current = 0
    lookFrom.current = controls?.target.y ?? 0
    active.current = true
    flush()
  }

  useEffect(() => {
    let dead = false
    let created: TowerPhysics | undefined
    // Rapier ships its WASM inline (~2 MB), so it loads as its own chunk while the tower is already on screen.
    void import('./physics')
      .then((m) => m.TowerPhysics.create(layout))
      .then((world) => {
        if (dead) {
          world.dispose()
          return
        }
        created = world
        physics.current = world
        if (queuedPull.current !== null) start(queuedPull.current)
      })
    return () => {
      dead = true
      physics.current = null
      created?.dispose()
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [layout, analysis])

  useEffect(() => {
    if (pulled === null) {
      queuedPull.current = null
      return
    }
    queuedPull.current = pulled
    // The block under the pointer is gone: drop the tooltip, the highlight and the pointer cursor.
    paint(null)
    document.body.style.cursor = ''
    setHover(null)
    if (physics.current) start(pulled)
    // eslint-disable-next-line react/exhaustive-deps
  }, [pulled])

  useFrame((_, dt) => {
    const world = physics.current
    if (!world || !active.current) return
    sincePull.current += dt
    // Slow motion for the first moments, so the wave up the tower can be seen.
    const speed = reducedMotion || sincePull.current > 1.6 ? 1 : 0.5
    const moving = world.step(dt * speed)
    for (const i of world.released()) {
      const pose = world.pose(i)
      if (pose) write(i, pose.x, pose.y, pose.z, [pose.qx, pose.qy, pose.qz, pose.qw])
    }
    const shake = reducedMotion ? 0 : Math.max(0, 1 - sincePull.current / 0.7) * 0.09
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake
      camera.position.y += (Math.random() - 0.5) * shake
    }
    // Ease the view down to the pile, so the wreck is in frame once the tower is gone.
    if (controls && !reducedMotion) {
      const t = Math.min(1, sincePull.current / 3)
      controls.target.y = lookFrom.current + (1.4 - lookFrom.current) * (t * t * (3 - 2 * t))
      controls.update()
    }
    flush()
    if (!moving) active.current = false
  })

  const paint = (index: number | null) => {
    const mesh = body.current
    if (!mesh) return
    const prev = hovered.current
    if (prev === index) return
    if (prev !== null)
      mesh.setColorAt(
        prev,
        colorOf(prev, analysis.heights[prev] ?? 0, prev === analysis.graph.root),
      )
    if (index !== null) mesh.setColorAt(index, HOVER)
    hovered.current = index
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    invalidate()
  }

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (pulled !== null || e.instanceId === undefined) return
    paint(e.instanceId)
    document.body.style.cursor = 'pointer'
    setHover({ index: e.instanceId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  const out = () => {
    paint(null)
    document.body.style.cursor = ''
    setHover(null)
  }

  return (
    <>
      <instancedMesh
        ref={body}
        args={[undefined, undefined, n]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onPointerMove={over}
        onPointerOut={out}
        onClick={(e) => {
          e.stopPropagation()
          if (pulled === null && e.instanceId !== undefined && e.delta < 6) onPull(e.instanceId)
        }}
      >
        <boxGeometry args={[BLOCK.w, BLOCK.h, BLOCK.d]} />
        <meshToonMaterial gradientMap={ramp} />
      </instancedMesh>
      <instancedMesh
        ref={outline}
        args={[undefined, undefined, n]}
        frustumCulled={false}
        raycast={() => null}
      >
        <boxGeometry args={[BLOCK.w, BLOCK.h, BLOCK.d]} />
        <meshBasicMaterial color="#111111" side={BackSide} />
      </instancedMesh>
    </>
  )
}
