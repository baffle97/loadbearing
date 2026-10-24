import { describe, expect, it } from 'vitest'
import { analyse, computeHeights, riskiestBlock, transitiveDependents, trim } from './graph'
import type { Graph } from './graph'
import { layoutTower } from './layout'

const node = (name: string) => ({ name, version: '1.0.0' })

/** app -> lib -> util -> tiny, and app -> util */
const chain: Graph = {
  root: 0,
  nodes: [node('app'), node('lib'), node('util'), node('tiny')],
  edges: [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 2],
  ],
}

describe('computeHeights', () => {
  it('puts leaves at 0 and counts the longest path', () => {
    const a = analyse(chain)
    expect(a.heights).toEqual([3, 2, 1, 0])
  })

  it('survives a cycle instead of looping forever', () => {
    const cyclic: Graph = {
      root: 0,
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        [0, 1],
        [1, 2],
        [2, 1],
      ],
    }
    const heights = computeHeights(analyse(cyclic).deps)
    expect(heights).toHaveLength(3)
    expect(heights.every((h) => Number.isFinite(h))).toBe(true)
  })

  it('does not overflow the stack on a very deep chain', () => {
    const n = 20000
    const deps = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : []))
    expect(computeHeights(deps)[0]).toBe(n - 1)
  })
})

describe('transitiveDependents', () => {
  it('returns every package that would break', () => {
    const a = analyse(chain)
    expect(transitiveDependents(a.dependents, 3).sort()).toEqual([0, 1, 2])
    expect(transitiveDependents(a.dependents, 2).sort()).toEqual([0, 1])
    expect(transitiveDependents(a.dependents, 0)).toEqual([])
  })

  it('never lists the block itself, even inside a cycle', () => {
    const cyclic: Graph = {
      root: 0,
      nodes: [node('a'), node('b')],
      edges: [
        [0, 1],
        [1, 0],
      ],
    }
    expect(transitiveDependents(analyse(cyclic).dependents, 1)).toEqual([0])
  })
})

describe('riskiestBlock', () => {
  it('picks the block that breaks the most, never the root', () => {
    expect(riskiestBlock(analyse(chain))).toBe(3)
  })
})

describe('trim', () => {
  it('returns the graph untouched when it is small enough', () => {
    const t = trim(analyse(chain), 10)
    expect(t.hidden).toBe(0)
    expect(t.graph).toBe(chain)
  })

  it('keeps the root and the highest blast-radius blocks, drops the rest', () => {
    const t = trim(analyse(chain), 3)
    expect(t.hidden).toBe(1)
    expect(t.original[0]).toBe(0)
    expect(t.original).toContain(3)
    expect(t.original).toContain(2)
    expect(t.original).not.toContain(1)
    expect(t.graph.edges.every(([f, to]) => f < 3 && to < 3)).toBe(true)
  })
})

describe('layoutTower', () => {
  it('stacks leaves below dependents and keeps blocks from overlapping', () => {
    const a = analyse(chain)
    const l = layoutTower(a)
    expect(l.placements[3]?.y).toBeLessThan(l.placements[2]?.y ?? 0)
    expect(l.placements[0]?.y).toBeGreaterThan(l.placements[1]?.y ?? 0)
    const wide: Graph = {
      root: 0,
      nodes: [node('root'), ...Array.from({ length: 30 }, (_, i) => node(`leaf${i}`))],
      edges: Array.from({ length: 30 }, (_, i) => [0, i + 1] as [number, number]),
    }
    const w = layoutTower(analyse(wide))
    const seen = new Set(
      w.placements.map((p) => `${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.z.toFixed(2)}`),
    )
    expect(seen.size).toBe(wide.nodes.length)
  })
})
