import { describe, expect, it } from 'vitest'
import { presetGraph } from '../data/presets'
import { analyse, fallLevels } from '../domain/graph'
import type { Graph } from '../domain/graph'
import { layoutTower } from '../domain/layout'
import { TowerPhysics } from './physics'

const node = (name: string) => ({ name, version: '1.0.0' })

async function collapse(graph: Graph, pulledName: string, seconds: number) {
  const a = analyse(graph)
  const layout = layoutTower(a)
  const pulled = graph.nodes.findIndex((n) => n.name === pulledName)
  const levels = fallLevels(a.dependents, pulled)
  const world = await TowerPhysics.create(layout)
  world.pull(levels)
  for (let t = 0; t < seconds * 60; t++) world.step(1 / 60)
  return { a, layout, pulled, levels, world }
}

describe('TowerPhysics', () => {
  const chain: Graph = {
    root: 0,
    nodes: [node('app'), node('lib'), node('util'), node('tiny'), node('other')],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
    ],
  }

  it('drops exactly the dependents and leaves everything else standing', async () => {
    const { world, pulled, levels } = await collapse(chain, 'tiny', 5)
    expect(world.has(pulled)).toBe(false)
    expect(new Set(world.released())).toEqual(new Set(levels.keys()))
    expect(world.has(4)).toBe(false)
    world.dispose()
  })

  it('lets fallen blocks come to rest on the ground, not through it', async () => {
    const { world, layout, levels } = await collapse(chain, 'tiny', 6)
    for (const index of levels.keys()) {
      const pose = world.pose(index)
      expect(pose).not.toBeNull()
      expect(pose?.y).toBeGreaterThan(0.1)
      expect(pose?.y).toBeLessThan((layout.placements[index]?.y ?? 0) + 0.01)
    }
    world.dispose()
  })

  it('falls in waves: the nearest dependent is released before the farthest', async () => {
    const a = analyse(chain)
    const world = await TowerPhysics.create(layoutTower(a))
    world.pull(fallLevels(a.dependents, 3))
    for (let t = 0; t < 20; t++) world.step(1 / 60)
    expect(world.has(2)).toBe(true)
    expect(world.has(0)).toBe(false)
    world.dispose()
  })

  it('settles a real 125-package collapse with nothing lost or exploded', async () => {
    const loaded = presetGraph('eslint-plugin-react')
    if (!loaded) throw new Error('preset missing')
    const { world, levels } = await collapse(loaded.graph, 'es-errors', 12)
    expect(levels.size).toBe(82)
    for (const index of levels.keys()) {
      const pose = world.pose(index)
      expect(pose).not.toBeNull()
      for (const v of [pose?.x, pose?.y, pose?.z]) expect(Number.isFinite(v)).toBe(true)
      expect(pose?.y).toBeGreaterThan(0.05)
      expect(Math.abs(pose?.x ?? 0)).toBeLessThan(60)
    }
    expect(world.step(1 / 60)).toBe(false)
    world.dispose()
  })
})
