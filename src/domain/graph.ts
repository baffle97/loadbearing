export interface PkgNode {
  name: string
  version: string
}

/** `edges` hold [from, to]: package `from` depends on package `to`. Node `root` is the searched package. */
export interface Graph {
  root: number
  nodes: PkgNode[]
  edges: [number, number][]
}

export function adjacency(graph: Graph) {
  const deps: number[][] = graph.nodes.map(() => [])
  const dependents: number[][] = graph.nodes.map(() => [])
  for (const [from, to] of graph.edges) {
    deps[from]?.push(to)
    dependents[to]?.push(from)
  }
  return { deps, dependents }
}

/**
 * Height = longest path down to a leaf. Leaves are 0. Cycle-safe: an edge that points back
 * into the current path is ignored. Iterative, so a deep graph cannot overflow the stack.
 */
export function computeHeights(deps: number[][]): number[] {
  const n = deps.length
  const height = new Array<number>(n).fill(0)
  const state = new Uint8Array(n) // 0 new, 1 on path, 2 done
  for (let start = 0; start < n; start++) {
    if (state[start] !== 0) continue
    const stack: { v: number; i: number }[] = [{ v: start, i: 0 }]
    state[start] = 1
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (!top) break
      const children = deps[top.v] ?? []
      if (top.i < children.length) {
        const child = children[top.i++]
        if (child !== undefined && state[child] === 0) {
          state[child] = 1
          stack.push({ v: child, i: 0 })
        }
        continue
      }
      let best = 0
      for (const child of children) {
        if (state[child] === 2) best = Math.max(best, (height[child] ?? 0) + 1)
      }
      height[top.v] = best
      state[top.v] = 2
      stack.pop()
    }
  }
  return height
}

/** Every package that would break if `index` were removed: all transitive dependents. */
export function transitiveDependents(dependents: number[][], index: number): number[] {
  const seen = new Set<number>()
  const stack = [index]
  while (stack.length > 0) {
    const current = stack.pop() as number
    for (const parent of dependents[current] ?? []) {
      if (parent !== index && !seen.has(parent)) {
        seen.add(parent)
        stack.push(parent)
      }
    }
  }
  return [...seen]
}

export interface Analysis {
  graph: Graph
  deps: number[][]
  dependents: number[][]
  heights: number[]
  /** blast[i] = number of packages that fall when i is pulled. */
  blast: number[]
}

export function analyse(graph: Graph): Analysis {
  const { deps, dependents } = adjacency(graph)
  const heights = computeHeights(deps)
  const blast = graph.nodes.map((_, i) => transitiveDependents(dependents, i).length)
  return { graph, deps, dependents, heights, blast }
}

export interface Trimmed {
  graph: Graph
  /** Index in the original graph for every node of the trimmed graph. */
  original: number[]
  hidden: number
}

/**
 * Keeps the root plus the blocks with the biggest blast radius, so the tiny load-bearing
 * leaves (the whole point) always survive and the dull middle is what gets dropped.
 */
export function trim(analysis: Analysis, max: number): Trimmed {
  const { graph, blast } = analysis
  const total = graph.nodes.length
  if (total <= max) {
    return { graph, original: graph.nodes.map((_, i) => i), hidden: 0 }
  }
  const ranked = graph.nodes
    .map((_, i) => i)
    .filter((i) => i !== graph.root)
    .sort((a, b) => (blast[b] ?? 0) - (blast[a] ?? 0) || a - b)
    .slice(0, max - 1)
  const original = [graph.root, ...ranked.sort((a, b) => a - b)]
  const remap = new Map(original.map((o, i) => [o, i]))
  const edges: [number, number][] = []
  for (const [from, to] of graph.edges) {
    const f = remap.get(from)
    const t = remap.get(to)
    if (f !== undefined && t !== undefined) edges.push([f, t])
  }
  return {
    graph: { root: 0, nodes: original.map((o) => graph.nodes[o] as PkgNode), edges },
    original,
    hidden: total - original.length,
  }
}

export function riskiestBlock(analysis: Analysis): number {
  let best = -1
  let bestBlast = -1
  analysis.graph.nodes.forEach((_, i) => {
    if (i === analysis.graph.root) return
    const b = analysis.blast[i] ?? 0
    if (b > bestBlast) {
      best = i
      bestBlast = b
    }
  })
  return best
}

/**
 * Breadth-first distance from the pulled block up through its dependents. The closest
 * dependents get level 1 and fall first, so the collapse travels up the tower like a wave.
 */
export function fallLevels(dependents: number[][], pulled: number): Map<number, number> {
  const levels = new Map<number, number>()
  let frontier = [pulled]
  let level = 0
  const seen = new Set<number>([pulled])
  while (frontier.length > 0) {
    level++
    const next: number[] = []
    for (const v of frontier) {
      for (const parent of dependents[v] ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent)
          levels.set(parent, level)
          next.push(parent)
        }
      }
    }
    frontier = next
  }
  return levels
}
