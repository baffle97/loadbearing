// Fetches the preset graphs once and stores them compactly, so the first screen needs no network.
import { writeFileSync } from 'node:fs'

const PRESETS = [
  { pkg: 'eslint-plugin-react', version: '7.37.5', pull: 'es-errors' },
  { pkg: '@aws-sdk/client-s3', version: '3.1156.0', pull: 'tslib' },
  { pkg: 'firebase', version: '13.1.0', pull: 'tslib' },
  { pkg: 'babel-loader', version: '10.1.1', pull: 'yocto-queue' },
]
const out = []
for (const { pkg, version, pull } of PRESETS) {
  const url = `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(pkg)}/versions/${version}:dependencies`
  const data = await (await fetch(url)).json()
  const nodes = data.nodes.map((n) => `${n.versionKey.name}@${n.versionKey.version}`)
  const self = data.nodes.findIndex((n) => n.relation === 'SELF')
  if (self !== 0) throw new Error(`${pkg}: expected root at index 0, got ${self}`)
  const edges = data.edges.filter((e) => e.fromNode !== e.toNode).map((e) => [e.fromNode, e.toNode])
  out.push({ name: pkg, version, nodes, edges, pull })
  console.log(pkg, version, nodes.length, 'nodes', edges.length, 'edges')
}
writeFileSync(new URL('../src/data/presets.json', import.meta.url), JSON.stringify(out))
