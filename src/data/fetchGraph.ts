import type { Graph } from '../domain/graph'
import { dependenciesResponse, packageResponse, toGraph } from './schema'

const API = 'https://api.deps.dev/v3/systems/npm/packages'
const TIMEOUT_MS = 10_000
const MAX_VERSIONS_TRIED = 5

export type GraphErrorKind =
  | 'invalid-name'
  | 'not-found'
  | 'no-dependencies'
  | 'unresolved'
  | 'rate-limited'
  | 'offline'
  | 'bad-data'

export class GraphError extends Error {
  readonly kind: GraphErrorKind
  constructor(kind: GraphErrorKind, message: string) {
    super(message)
    this.name = 'GraphError'
    this.kind = kind
  }
}

export interface LoadedGraph {
  name: string
  version: string
  /** Set when the newest release could not be resolved yet and an older one is shown. */
  newerVersion?: string
  graph: Graph
}

export interface FetchOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

// npm package names: optional @scope/, then letters, digits and . _ ~ -. Checked before any URL is built.
const NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i

export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NAME.test(name)
}

async function getJson(url: string, opts: FetchOptions): Promise<unknown | null> {
  const doFetch = opts.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await doFetch(url, { signal })
  } catch (error) {
    if (opts.signal?.aborted) throw error
    throw new GraphError(
      'offline',
      'Could not reach deps.dev. Check your connection and try again.',
    )
  }
  if (res.status === 404) return null
  if (res.status === 429) {
    throw new GraphError(
      'rate-limited',
      'deps.dev is rate limiting this browser. Wait a minute and try again.',
    )
  }
  if (!res.ok) throw new GraphError('offline', `deps.dev answered with status ${res.status}.`)
  try {
    return await res.json()
  } catch {
    throw new GraphError('bad-data', 'deps.dev returned something that is not JSON.')
  }
}

export async function fetchGraph(rawName: string, opts: FetchOptions = {}): Promise<LoadedGraph> {
  const name = rawName.trim()
  if (!isValidPackageName(name)) {
    throw new GraphError('invalid-name', `"${name}" is not a valid npm package name.`)
  }
  const encoded = encodeURIComponent(name)
  const pkgJson = await getJson(`${API}/${encoded}`, opts)
  if (pkgJson === null)
    throw new GraphError('not-found', `No npm package called "${name}" was found.`)
  const pkg = packageResponse.safeParse(pkgJson)
  if (!pkg.success)
    throw new GraphError('bad-data', 'deps.dev returned an unexpected package shape.')

  // Newest stable first. Brand-new releases often are not resolved yet, so we step back.
  const stable = pkg.data.versions
    .filter((v) => !v.versionKey.version.includes('-'))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, MAX_VERSIONS_TRIED)
  if (stable.length === 0) throw new GraphError('not-found', `"${name}" has no stable release.`)

  const newest = stable[0]?.versionKey.version
  for (const candidate of stable) {
    const version = candidate.versionKey.version
    const json = await getJson(
      `${API}/${encoded}/versions/${encodeURIComponent(version)}:dependencies`,
      opts,
    )
    if (json === null) continue
    const parsed = dependenciesResponse.safeParse(json)
    if (!parsed.success)
      throw new GraphError('bad-data', 'deps.dev returned an unexpected dependency shape.')
    let graph: Graph
    try {
      graph = toGraph(parsed.data)
    } catch {
      throw new GraphError('bad-data', 'deps.dev returned a broken dependency graph.')
    }
    if (graph.nodes.length <= 1) {
      throw new GraphError(
        'no-dependencies',
        `${name}@${version} has no dependencies, so there is nothing to stack.`,
      )
    }
    return {
      name,
      version,
      graph,
      ...(newest && newest !== version ? { newerVersion: newest } : {}),
    }
  }
  throw new GraphError(
    'unresolved',
    `deps.dev has not resolved a recent release of "${name}" yet. Try again later.`,
  )
}
