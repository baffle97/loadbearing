export interface Recording {
  blob: Blob
  extension: 'mp4' | 'webm'
}

/** X accepts MP4 and MOV, not WebM, so MP4 (H.264) is tried first. */
export function pickFormat(): { mime: string; extension: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const options = [
    { mime: 'video/mp4;codecs=avc1', extension: 'mp4' as const },
    { mime: 'video/mp4', extension: 'mp4' as const },
    { mime: 'video/webm;codecs=vp9', extension: 'webm' as const },
    { mime: 'video/webm', extension: 'webm' as const },
  ]
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null
}

export interface Overlay {
  headline: string
  detail: string
}

const MAX_WIDTH = 1920
const INK = '#111111'

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  scale: number,
  overlay: Overlay,
  brand: string,
): void {
  const pad = 28 * scale
  const w = 460 * scale
  const h = 150 * scale
  const x = pad
  const y = pad
  ctx.save()
  ctx.fillStyle = INK
  ctx.fillRect(x + 8 * scale, y + 8 * scale, w, h)
  ctx.fillStyle = '#FFD60A'
  ctx.fillRect(x, y, w, h)
  ctx.lineWidth = 4 * scale
  ctx.strokeStyle = INK
  ctx.strokeRect(x, y, w, h)
  ctx.fillStyle = INK
  ctx.textBaseline = 'top'
  ctx.font = `800 ${52 * scale}px Unbounded, sans-serif`
  ctx.fillText(overlay.headline, x + 20 * scale, y + 16 * scale)
  ctx.font = `700 ${22 * scale}px "Onest Variable", sans-serif`
  ctx.fillText(overlay.detail, x + 20 * scale, y + 92 * scale, w - 40 * scale)
  ctx.font = `800 ${22 * scale}px Unbounded, sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.fillText(brand, pad, ctx.canvas.height - pad)
  ctx.restore()
}

/**
 * Records the 3D canvas with the result sticker and a small brand mark drawn on top, because the
 * HUD is HTML and would otherwise be missing from the clip. Output is capped to 1920 px wide.
 */
export function startRecording(
  source: HTMLCanvasElement,
  getOverlay: () => Overlay | null,
  fps = 60,
): { stop: () => Promise<Recording> } {
  const format = pickFormat()
  if (!format) throw new Error('This browser cannot record video.')
  const scale = Math.min(1, MAX_WIDTH / source.width)
  const out = document.createElement('canvas')
  // H.264 needs even dimensions.
  out.width = Math.max(2, Math.round((source.width * scale) / 2) * 2)
  out.height = Math.max(2, Math.round((source.height * scale) / 2) * 2)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not create a recording surface.')
  let frame = 0
  const paint = () => {
    ctx.drawImage(source, 0, 0, out.width, out.height)
    const overlay = getOverlay()
    if (overlay) drawOverlay(ctx, out.width / 1440, overlay, 'Loadbearing')
    frame = requestAnimationFrame(paint)
  }
  paint()

  const stream = out.captureStream(fps)
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: 8_000_000,
  })
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  })
  recorder.start(250)
  return {
    stop: () =>
      new Promise<Recording>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            cancelAnimationFrame(frame)
            for (const track of stream.getTracks()) track.stop()
            resolve({ blob: new Blob(chunks, { type: format.mime }), extension: format.extension })
          },
          { once: true },
        )
        recorder.stop()
      }),
  }
}

export function download(recording: Recording, name: string): void {
  const url = URL.createObjectURL(recording.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.${recording.extension}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
