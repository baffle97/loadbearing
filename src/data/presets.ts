import type { Graph } from '../domain/graph'
import type { LoadedGraph } from './fetchGraph'
import presetsJson from './presets.json'
import { presetFile } from './schema'

const presets = presetFile.parse(presetsJson)

export interface Preset {
  name: string
  version: string
  /** Name of the tiny block that makes the best demo. */
  pull: string
}

export const PRESETS: Preset[] = presets.map(({ name, version, pull }) => ({ name, version, pull }))

export function presetGraph(name: string): LoadedGraph | null {
  const p = presets.find((x) => x.name === name)
  if (!p) return null
  const nodes = p.nodes.map((full) => {
    const at = full.lastIndexOf('@')
    return { name: full.slice(0, at), version: full.slice(at + 1) }
  })
  const graph: Graph = { root: 0, nodes, edges: p.edges }
  return { name: p.name, version: p.version, graph }
}
