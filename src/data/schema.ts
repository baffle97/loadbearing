import { z } from 'zod'
import type { Graph } from '../domain/graph'

const versionKey = z.object({ name: z.string().optional(), version: z.string() })

export const packageResponse = z.object({
  versions: z.array(
    z.object({
      versionKey,
      publishedAt: z.string().optional(),
      isDefault: z.boolean().optional(),
    }),
  ),
})

export const dependenciesResponse = z.object({
  nodes: z.array(
    z.object({
      versionKey: z.object({ name: z.string(), version: z.string() }),
      relation: z.string().optional(),
    }),
  ),
  edges: z.array(z.object({ fromNode: z.number().int().min(0), toNode: z.number().int().min(0) })),
})

/** Turns a validated deps.dev response into our Graph. Throws if an edge points outside the nodes. */
export function toGraph(data: z.infer<typeof dependenciesResponse>): Graph {
  const n = data.nodes.length
  const rootAt = data.nodes.findIndex((node) => node.relation === 'SELF')
  const root = rootAt === -1 ? 0 : rootAt
  const edges: [number, number][] = []
  for (const e of data.edges) {
    if (e.fromNode >= n || e.toNode >= n) throw new Error('edge points outside the node list')
    if (e.fromNode !== e.toNode) edges.push([e.fromNode, e.toNode])
  }
  return { root, nodes: data.nodes.map((node) => node.versionKey), edges }
}

/** Compact form used for the bundled preset graphs. */
export const presetFile = z.array(
  z.object({
    name: z.string(),
    version: z.string(),
    nodes: z.array(z.string()),
    edges: z.array(z.tuple([z.number().int(), z.number().int()])),
    pull: z.string(),
  }),
)
