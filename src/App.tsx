import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GraphError, fetchGraph } from './data/fetchGraph'
import type { LoadedGraph } from './data/fetchGraph'
import { PRESETS, presetGraph } from './data/presets'
import { analyse, riskiestBlock, trim } from './domain/graph'
import { layoutTower } from './domain/layout'
import { usePrefersReducedMotion } from './lib/reducedMotion'
import { download, pickFormat, startRecording } from './lib/record'
import type { Overlay } from './lib/record'
import { Tooltip } from './ui/Tooltip'

// The 3D scene (three + physics) loads after the search bar has painted.
const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

const MAX_BLOCKS = 300
const CLIP_MS = 10_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Source {
  loaded: LoadedGraph
  live: boolean
}

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string }

function initialFromUrl(): { pkg: string; pull: string | null } {
  const params = new URLSearchParams(window.location.search)
  return { pkg: params.get('pkg') ?? PRESETS[0]?.name ?? '', pull: params.get('pull') }
}

export default function App() {
  const reducedMotion = usePrefersReducedMotion()
  const [start] = useState(initialFromUrl)
  const [source, setSource] = useState<Source>(() => {
    const preset = presetGraph(start.pkg) ?? presetGraph(PRESETS[0]?.name ?? '')
    if (!preset) throw new Error('bundled presets are missing')
    return { loaded: preset, live: false }
  })
  const [query, setQuery] = useState(start.pkg)
  const [status, setStatus] = useState<Status>(() =>
    start.pkg && !presetGraph(start.pkg) ? { kind: 'loading' } : { kind: 'idle' },
  )
  const [pulled, setPulled] = useState<number | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [clip, setClip] = useState<'idle' | 'recording'>('idle')
  const [clipError, setClipError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const wantedPull = useRef<string | null>(start.pull)
  // What the recorder paints on top of the 3D canvas; kept in a ref so recording never re-renders.
  const overlay = useRef<Overlay | null>(null)

  const full = useMemo(() => analyse(source.loaded.graph), [source])
  const trimmed = useMemo(() => trim(full, MAX_BLOCKS), [full])
  const shown = useMemo(
    () => (trimmed.hidden === 0 ? full : analyse(trimmed.graph)),
    [trimmed, full],
  )
  const layout = useMemo(() => layoutTower(shown), [shown])
  const fullIndex = useCallback((i: number) => trimmed.original[i] ?? i, [trimmed])
  const blastOf = useCallback((i: number) => full.blast[fullIndex(i)] ?? 0, [full, fullIndex])
  const total = full.graph.nodes.length

  const rebuild = useCallback(() => {
    setPulled(null)
    setEpoch((e) => e + 1)
    history.replaceState(null, '', `?pkg=${encodeURIComponent(source.loaded.name)}`)
  }, [source])

  const pull = useCallback(
    (index: number) => {
      setPulled(index)
      const name = shown.graph.nodes[index]?.name ?? ''
      history.replaceState(
        null,
        '',
        `?pkg=${encodeURIComponent(source.loaded.name)}&pull=${encodeURIComponent(name)}`,
      )
    },
    [shown, source],
  )

  // A shared link such as ?pkg=eslint-plugin-react&pull=es-errors pulls that block once it is built.
  // The ref is cleared inside the timer, not before it: StrictMode runs this effect twice in dev,
  // and clearing early would let the first cleanup cancel the only pull.
  useEffect(() => {
    const wanted = wantedPull.current
    if (!wanted) return
    const index = shown.graph.nodes.findIndex((n) => n.name === wanted)
    if (index <= 0) return
    const id = setTimeout(() => {
      wantedPull.current = null
      pull(index)
    }, 900)
    return () => clearTimeout(id)
  }, [shown, pull])

  const run = useCallback(async (name: string) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    try {
      const loaded = await fetchGraph(name, { signal: controller.signal })
      setSource({ loaded, live: true })
      setPulled(null)
      setEpoch((e) => e + 1)
      setStatus({ kind: 'idle' })
      history.replaceState(null, '', `?pkg=${encodeURIComponent(loaded.name)}`)
    } catch (error) {
      if (controller.signal.aborted) return
      setStatus({
        kind: 'error',
        message:
          error instanceof GraphError
            ? error.message
            : 'Something went wrong while loading that package.',
      })
    }
  }, [])

  const load = useCallback(
    (name: string) => {
      setStatus({ kind: 'loading' })
      void run(name)
    },
    [run],
  )

  // Opening a link for a package that is not bundled loads it live.
  useEffect(() => {
    // Fetching on mount syncs with an external system; run() only sets state after its await.
    // oxlint-disable-next-line react/set-state-in-effect
    if (start.pkg && !presetGraph(start.pkg)) void run(start.pkg)
  }, [start, run])

  const choosePreset = (name: string) => {
    const preset = presetGraph(name)
    if (!preset) return
    abort.current?.abort()
    setQuery(name)
    setSource({ loaded: preset, live: false })
    setPulled(null)
    setEpoch((e) => e + 1)
    setStatus({ kind: 'idle' })
    history.replaceState(null, '', `?pkg=${encodeURIComponent(name)}`)
  }

  const recordClip = async () => {
    const el = canvas.current
    if (!el || clip !== 'idle') return
    setClipError(null)
    if (!pickFormat()) {
      setClipError('This browser cannot record video. Try Chrome.')
      return
    }
    setClip('recording')
    try {
      setPulled(null)
      setEpoch((e) => e + 1)
      await sleep(900)
      const recorder = startRecording(canvas.current ?? el, () => overlay.current)
      const started = performance.now()
      await sleep(1300)
      setPulled(riskiestBlock(shown))
      await sleep(Math.max(0, CLIP_MS - (performance.now() - started)))
      download(
        await recorder.stop(),
        `loadbearing-${source.loaded.name.replace(/[^a-z0-9]+/gi, '-')}`,
      )
    } catch {
      setClipError('Recording failed. Reload the page and try again.')
    } finally {
      setClip('idle')
    }
  }

  const describe = (index: number) => {
    const node = shown.graph.nodes[index]
    const n = blastOf(index)
    return {
      title: `${node?.name ?? ''}@${node?.version ?? ''}`,
      detail:
        n === 0
          ? 'Nothing depends on this.'
          : `${n} ${n === 1 ? 'package depends' : 'packages depend'} on this. Click to pull.`,
    }
  }

  const pulledNode = pulled === null ? null : shown.graph.nodes[pulled]
  const fell = pulled === null ? 0 : blastOf(pulled)
  const percent = Math.round((fell / total) * 100)
  const pulledName = pulledNode?.name ?? null
  useEffect(() => {
    overlay.current = pulledName
      ? { headline: `${fell} of ${total}`, detail: `packages fell when ${pulledName} was pulled` }
      : null
  }, [pulledName, fell, total])
  const ranked = useMemo(
    () =>
      shown.graph.nodes
        .map((node, i) => ({ node, i, n: blastOf(i) }))
        .filter((x) => x.i !== shown.graph.root)
        .sort((a, b) => b.n - a.n)
        .slice(0, 8),
    [shown, blastOf],
  )

  return (
    <div className="app">
      <header className="top">
        <h1>Loadbearing</h1>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault()
            load(query)
          }}
        >
          <label className="sr" htmlFor="pkg">
            npm package name
          </label>
          <input
            id="pkg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="npm package, e.g. firebase"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="go" type="submit" disabled={status.kind === 'loading'}>
            {status.kind === 'loading' ? 'Loading…' : 'Build tower'}
          </button>
        </form>
        <ul className="chips" aria-label="Examples">
          {PRESETS.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => choosePreset(p.name)}
                aria-pressed={source.loaded.name === p.name}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      </header>

      <main className="stage">
        <Suspense fallback={<p className="loading">Stacking blocks…</p>}>
          <Scene
            key={epoch}
            analysis={shown}
            layout={layout}
            pulled={pulled}
            reducedMotion={reducedMotion}
            recording={clip === 'recording'}
            onPull={pull}
            onCanvas={(el) => {
              canvas.current = el
            }}
          />
        </Suspense>

        <output className="hud" aria-live="polite">
          {status.kind === 'error' ? (
            <>
              <strong className="big">Can’t build that</strong>
              <p>{status.message}</p>
              <button type="button" onClick={() => choosePreset(PRESETS[0]?.name ?? '')}>
                Show {PRESETS[0]?.name}
              </button>
            </>
          ) : pulledNode ? (
            <>
              <strong className="big">
                {fell} of {total}
              </strong>
              <p>
                packages fell when you pulled <code>{pulledNode.name}</code>.
              </p>
              <small>
                That is {percent}% of {source.loaded.name}@{source.loaded.version}.
              </small>
              <button type="button" onClick={rebuild}>
                Rebuild tower
              </button>
            </>
          ) : (
            <>
              <strong className="big">{total} packages</strong>
              <p>
                make up <code>{source.loaded.name}</code>. Click a block to pull it. Small blocks
                near the bottom hold the most up.
              </p>
              <button type="button" onClick={() => pull(riskiestBlock(shown))}>
                Pull the riskiest block
              </button>
            </>
          )}
        </output>

        <aside className="list">
          <h2>Pull a block</h2>
          <ul>
            {ranked.map(({ node, i, n }) => (
              <li key={i}>
                <span>
                  {node.name}
                  <small>{n} depend on it</small>
                </span>
                <button
                  type="button"
                  disabled={pulled !== null}
                  onClick={() => pull(i)}
                  aria-label={`Pull ${node.name}, ${n} packages depend on it`}
                >
                  Pull
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <Tooltip describe={describe} />
      </main>

      <footer className="bottom">
        <button
          type="button"
          className="rec"
          onClick={() => void recordClip()}
          disabled={clip === 'recording'}
        >
          {clip === 'recording' ? 'Recording…' : 'Record 10 s clip'}
        </button>
        <p>
          {source.loaded.name}@{source.loaded.version}
          {source.live ? ' · live from deps.dev' : ' · bundled snapshot'}
          {source.loaded.newerVersion
            ? ` · ${source.loaded.newerVersion} is too new to be resolved yet`
            : ''}
          {trimmed.hidden > 0 ? ` · showing ${MAX_BLOCKS} of ${total} blocks` : ''}
          {' · public npm data only · nothing is tracked'}
        </p>
        {clipError && (
          <p className="clip-error" role="alert">
            {clipError}
          </p>
        )}
      </footer>
    </div>
  )
}
