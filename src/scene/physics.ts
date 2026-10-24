import RAPIER from '@dimforge/rapier3d-compat'
import { BLOCK } from '../domain/layout'
import type { Layout } from '../domain/layout'

const GROUND = 0x0001
const FALLEN = 0x0004
const groups = (membership: number, filter: number) => (membership << 16) | filter

const STEP = 1 / 60
const LEVEL_DELAY = 0.13
const MAX_DELAY = 1.8

let ready: Promise<void> | undefined
function initRapier(): Promise<void> {
  ready ??= RAPIER.init()
  return ready
}

export interface Pose {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
}

/**
 * Standing blocks are not simulated at all: they are just positions. When a block is pulled,
 * every block that depended on it is given a dynamic body (in waves, nearest first) and falls.
 * Falling blocks only collide with the ground and with each other, so they drop through the
 * blocks that were never affected instead of coming to rest on them.
 */
export class TowerPhysics {
  private readonly world: RAPIER.World
  private readonly bodies = new Map<number, RAPIER.RigidBody>()
  private pending: { index: number; at: number }[] = []
  private clock = 0
  private acc = 0
  private seed = 1

  private readonly layout: Layout

  private constructor(layout: Layout, world: RAPIER.World) {
    this.layout = layout
    this.world = world
  }

  static async create(layout: Layout): Promise<TowerPhysics> {
    await initRapier()
    const world = new RAPIER.World({ x: 0, y: -14, z: 0 })
    world.timestep = STEP
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(120, 0.5, 120)
        .setFriction(0.9)
        .setCollisionGroups(groups(GROUND, FALLEN)),
      ground,
    )
    return new TowerPhysics(layout, world)
  }

  /** Deterministic pseudo-random in [-1, 1], so a collapse looks the same in a recording and in a test. */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return (this.seed / 2147483647) * 2 - 1
  }

  /** Schedules the fall of every dependent of a pulled block. `levels` is from fallLevels(). */
  pull(levels: Map<number, number>): void {
    this.pending = [...levels].map(([index, level]) => ({
      index,
      at: this.clock + Math.min(MAX_DELAY, level * LEVEL_DELAY),
    }))
  }

  private release(index: number): void {
    const p = this.layout.placements[index]
    if (!p || this.bodies.has(index)) return
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinvel(this.rand() * 0.7, -0.6, this.rand() * 0.7)
        .setAngvel({ x: this.rand() * 1.4, y: this.rand() * 0.8, z: this.rand() * 1.4 })
        .setCcdEnabled(true),
    )
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BLOCK.w / 2, BLOCK.h / 2, BLOCK.d / 2)
        .setFriction(0.9)
        .setRestitution(0.12)
        .setCollisionGroups(groups(FALLEN, GROUND | FALLEN)),
      body,
    )
    this.bodies.set(index, body)
  }

  /** Advances the simulation. Returns true while anything is still moving or waiting to fall. */
  step(dt: number): boolean {
    this.acc += Math.min(dt, 0.1)
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.clock += STEP
      if (this.pending.length > 0) {
        const due = this.pending.filter((x) => x.at <= this.clock)
        if (due.length > 0) {
          this.pending = this.pending.filter((x) => x.at > this.clock)
          for (const { index } of due) this.release(index)
        }
      }
      this.world.step()
    }
    if (this.pending.length > 0) return true
    for (const body of this.bodies.values()) if (!body.isSleeping()) return true
    return false
  }

  has(index: number): boolean {
    return this.bodies.has(index)
  }

  released(): number[] {
    return [...this.bodies.keys()]
  }

  pose(index: number): Pose | null {
    const body = this.bodies.get(index)
    if (!body) return null
    const t = body.translation()
    const r = body.rotation()
    return { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w }
  }

  dispose(): void {
    this.world.free()
  }
}
