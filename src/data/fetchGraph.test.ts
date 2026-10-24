import { describe, expect, it } from 'vitest'
import { GraphError, fetchGraph, isValidPackageName } from './fetchGraph'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const deps = (names: string[]) => ({
  nodes: names.map((n, i) => ({
    versionKey: { name: n, version: '1.0.0' },
    relation: i === 0 ? 'SELF' : 'DIRECT',
  })),
  edges: names.slice(1).map((_, i) => ({ fromNode: 0, toNode: i + 1 })),
})

/** Routes a URL substring to a canned response. */
function router(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [needle, make] of Object.entries(routes)) if (url.includes(needle)) return make()
    return json({}, 404)
  }) as typeof fetch
}

const versions = (list: [string, string][]) => ({
  versions: list.map(([version, publishedAt]) => ({ versionKey: { version }, publishedAt })),
})

describe('isValidPackageName', () => {
  it('accepts normal, scoped and old mixed-case names', () => {
    for (const ok of ['express', '@aws-sdk/client-s3', 'JSONStream', 'left-pad', 'a.b_c~d']) {
      expect(isValidPackageName(ok)).toBe(true)
    }
  })
  it('rejects anything that could change the URL', () => {
    for (const bad of [
      '',
      ' ',
      '../etc',
      'a/b',
      'a?x=1',
      'a#b',
      'a b',
      '@scope',
      'x'.repeat(215),
      '<script>',
    ]) {
      expect(isValidPackageName(bad)).toBe(false)
    }
  })
})

describe('fetchGraph', () => {
  it('steps back to an older release when the newest is not resolved yet', async () => {
    const fetchImpl = router({
      '/versions/2.0.0:dependencies': () => json({ error: 'dependencies not found' }, 404),
      '/versions/1.9.0:dependencies': () => json(deps(['pkg', 'a', 'b'])),
      '/packages/pkg': () =>
        json(
          versions([
            ['1.9.0', '2026-10-01T00:00:00Z'],
            ['2.0.0', '2026-10-23T00:00:00Z'],
            ['3.0.0-beta.1', '2026-10-24T00:00:00Z'],
          ]),
        ),
    })
    const loaded = await fetchGraph('pkg', { fetchImpl })
    expect(loaded.version).toBe('1.9.0')
    expect(loaded.newerVersion).toBe('2.0.0')
    expect(loaded.graph.nodes).toHaveLength(3)
  })

  it('ignores prereleases when choosing the version', async () => {
    const fetchImpl = router({
      '/versions/1.0.0:dependencies': () => json(deps(['pkg', 'a'])),
      '/packages/pkg': () =>
        json(
          versions([
            ['1.0.0', '2026-01-01T00:00:00Z'],
            ['2.0.0-rc.1', '2026-10-01T00:00:00Z'],
          ]),
        ),
    })
    expect((await fetchGraph('pkg', { fetchImpl })).version).toBe('1.0.0')
  })

  it.each([
    ['unknown package', router({}), 'not-found'],
    [
      'no dependencies',
      router({
        '/versions/': () => json(deps(['pkg'])),
        '/packages/pkg': () => json(versions([['1.0.0', '2026-01-01T00:00:00Z']])),
      }),
      'no-dependencies',
    ],
    ['rate limit', router({ '/packages/pkg': () => json({}, 429) }), 'rate-limited'],
    ['server error', router({ '/packages/pkg': () => json({}, 500) }), 'offline'],
    ['bad shape', router({ '/packages/pkg': () => json({ nope: true }) }), 'bad-data'],
    [
      'all releases unresolved',
      router({
        '/versions/': () => json({}, 404),
        '/packages/pkg': () => json(versions([['1.0.0', '2026-01-01T00:00:00Z']])),
      }),
      'unresolved',
    ],
  ])('reports %s as %s', async (_label, fetchImpl, kind) => {
    await expect(fetchGraph('pkg', { fetchImpl })).rejects.toMatchObject({ kind })
  })

  it('treats a network failure as offline', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    await expect(fetchGraph('pkg', { fetchImpl })).rejects.toMatchObject({ kind: 'offline' })
  })

  it('rejects an edge that points outside the node list', async () => {
    const fetchImpl = router({
      '/versions/1.0.0:dependencies': () =>
        json({
          nodes: [{ versionKey: { name: 'pkg', version: '1.0.0' } }],
          edges: [{ fromNode: 0, toNode: 9 }],
        }),
      '/packages/pkg': () => json(versions([['1.0.0', '2026-01-01T00:00:00Z']])),
    })
    await expect(fetchGraph('pkg', { fetchImpl })).rejects.toBeInstanceOf(GraphError)
  })

  it('never calls the network for an invalid name', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return json({})
    }) as typeof fetch
    await expect(fetchGraph('../x', { fetchImpl })).rejects.toMatchObject({ kind: 'invalid-name' })
    expect(calls).toBe(0)
  })

  it('encodes scoped names in the request URL', async () => {
    const seen: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(String(input))
      return json({}, 404)
    }) as typeof fetch
    await fetchGraph('@aws-sdk/client-s3', { fetchImpl }).catch(() => undefined)
    expect(seen[0]).toContain('%40aws-sdk%2Fclient-s3')
  })
})
