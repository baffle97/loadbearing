import { describe, expect, it } from 'vitest'
import { analyse } from '../domain/graph'
import { PRESETS, presetGraph } from './presets'

describe('bundled presets', () => {
  it.each(PRESETS)('$name: the tiny block really does take down a big share', ({ name, pull }) => {
    const loaded = presetGraph(name)
    expect(loaded).not.toBeNull()
    const a = analyse((loaded as NonNullable<typeof loaded>).graph)
    const index = a.graph.nodes.findIndex((n) => n.name === pull)
    expect(index).toBeGreaterThan(0)
    expect((a.blast[index] ?? 0) / a.graph.nodes.length).toBeGreaterThan(0.3)
    expect(
      a.graph.edges.every(([f, t]) => f < a.graph.nodes.length && t < a.graph.nodes.length),
    ).toBe(true)
  })
})
