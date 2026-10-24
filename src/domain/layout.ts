import type { Analysis } from './graph'

export const BLOCK = { w: 1.5, h: 0.7, d: 1 } as const
const GAP_X = 0.12
const GAP_Z = 0.12
const LAYER_H = BLOCK.h + 0.06

export interface Placement {
  x: number
  y: number
  z: number
}

export interface Layout {
  placements: Placement[]
  /** Bounding box of the tower, used to frame the camera. */
  width: number
  depth: number
  height: number
}

/**
 * One slab per height level, leaves at the bottom and the searched package on top. Inside a
 * level, blocks are ordered by where their dependencies sit, so struts stay short and tidy.
 */
export function layoutTower(analysis: Analysis): Layout {
  const { graph, deps, heights } = analysis
  const placements: Placement[] = graph.nodes.map(() => ({ x: 0, y: 0, z: 0 }))
  const levels = new Map<number, number[]>()
  graph.nodes.forEach((_, i) => {
    const h = heights[i] ?? 0
    const list = levels.get(h)
    if (list) list.push(i)
    else levels.set(h, [i])
  })
  const placed = new Set<number>()
  let width = 0
  let depth = 0
  const sorted = [...levels.keys()].sort((a, b) => a - b)
  for (const h of sorted) {
    const ids = levels.get(h) ?? []
    const key = (i: number) => {
      const xs = (deps[i] ?? []).filter((d) => placed.has(d)).map((d) => placements[d]?.x ?? 0)
      return xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
    }
    ids.sort((a, b) => key(a) - key(b) || a - b)
    const n = ids.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)))
    const rows = Math.ceil(n / cols)
    ids.forEach((id, slot) => {
      const c = slot % cols
      const r = Math.floor(slot / cols)
      const p = placements[id]
      if (!p) return
      p.x = (c - (cols - 1) / 2) * (BLOCK.w + GAP_X)
      p.z = (r - (rows - 1) / 2) * (BLOCK.d + GAP_Z)
      p.y = h * LAYER_H + BLOCK.h / 2
    })
    ids.forEach((id) => placed.add(id))
    width = Math.max(width, cols * (BLOCK.w + GAP_X))
    depth = Math.max(depth, rows * (BLOCK.d + GAP_Z))
  }
  const top = Math.max(0, ...heights)
  return { placements, width, depth, height: (top + 1) * LAYER_H }
}
