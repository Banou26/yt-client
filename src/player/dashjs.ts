import type { FrameApi } from '../frame/protocol'

// Route A probe: play yt-client's SABR-via-frame stream through dash.js (no Shaka).
// The frame produces a SegmentBase DASH manifest whose BaseURLs are sabr://<track>?key=<fmt>;
// we rewrite those to https://sabr.invalid/<track>?key=<fmt> so dash.js resolves them, then a
// request interceptor turns each segment request into a FrameApi.requestSegment call and hands
// dash.js the bytes back via a blob URL.
import * as dashjs from 'dashjs'

type Args = {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  startTime: number
  signal: AbortSignal
  onError(error: unknown): void
}

const rangeFrom = (value: unknown): { start: number, end: number } | undefined => {
  if (typeof value !== 'string') return undefined
  const m = value.match(/(\d+)-(\d+)/)
  return m ? { start: Number(m[1]), end: Number(m[2]) } : undefined
}

export const startDashPlayback = async ({ api, video, videoId, startTime, signal, onError }: Args) => {
  if (signal.aborted) throw signal.reason
  const maxHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  const session = await api.openPlayback(videoId, maxHeight)
  if (signal.aborted) throw signal.reason

  const manifestXml = session.manifest.replaceAll('sabr://', 'https://sabr.invalid/')
  const manifestUrl = URL.createObjectURL(new Blob([manifestXml], { type: 'application/dash+xml' }))

  let generation = 0
  let requestNumber = 0
  let logged = 0
  let destroyed = false
  const blobUrls = new Set<string>()

  const player = dashjs.MediaPlayer().create()

  const interceptor = async (req: any) => {
    let host = ''
    try { host = new URL(req.url).host } catch { return req }
    if (host !== 'sabr.invalid') return req
    try {
      const u = new URL(req.url)
      const track = (u.pathname.replace(/^\//, '') || 'audio') as 'audio' | 'video'
      const formatKey = u.searchParams.get('key') ?? ''
      const fr = req.customData?.request ?? {}
      const rangeStr = fr.range ?? req.headers?.Range ?? req.headers?.range ?? req.range
      // dash.js labels SegmentBase index fetches 'MediaSegment' too; the real signal is
      // mediaStartTime — null on the init/sidx byte-range reads, set on actual media.
      const hasStart = fr.mediaStartTime !== null && fr.mediaStartTime !== undefined && Number.isFinite(Number(fr.mediaStartTime))
      const kind: 'init' | 'media' = hasStart ? 'media' : 'init'
      const range = rangeFrom(rangeStr)
      const startTimeMs = hasStart ? Math.round(Number(fr.mediaStartTime) * 1000) : 0
      if (logged < 8) {
        logged++
        console.log('[DASHREQ]', JSON.stringify({
          key: formatKey, action: fr.action, index: fr.index, mediaStartTime: fr.mediaStartTime,
          duration: fr.duration, mediaType: fr.mediaType, frRange: fr.range, bytesTotal: fr.bytesTotal,
          partial: fr.isPartialSegmentRequest, derivedKind: kind, derivedStart: startTimeMs,
        }))
      }
      const seg = await api.requestSegment({
        requestId: `dash:${++requestNumber}`,
        sessionId: session.id,
        generation,
        track,
        kind,
        formatKey,
        range,
        startTimeMs,
        snapshot: {
          currentTimeMs: video.currentTime * 1000,
          playbackRate: video.playbackRate,
          bandwidthEstimate: 10_000_000,
          viewportWidth: Math.max(1, video.clientWidth),
          viewportHeight: Math.max(1, video.clientHeight),
        },
      })
      if (seg.end || !seg.data) {
        console.log('[DASHREQ] no-data', track, kind, 'end=', seg.end)
        return req
      }
      const blob = URL.createObjectURL(new Blob([seg.data]))
      blobUrls.add(blob)
      req.url = blob
      // Strip every range hint so dash.js reads the whole blob (= exactly this segment).
      if (req.headers) { delete req.headers.Range; delete req.headers.range }
      req.range = undefined
      if (req.customData?.request) req.customData.request.range = null
      return req
    } catch (error) {
      console.log('[DASHREQ] err', (error as Error).message)
      return req
    }
  }
  player.addRequestInterceptor(interceptor)

  player.on('error' as any, (e: any) => {
    console.log('[DASHERR]', JSON.stringify(e?.error ?? e).slice(0, 500))
    if (!destroyed) onError(new Error(`dash: ${e?.error?.message ?? e?.error?.code ?? 'error'}`))
  })
  player.on('playbackError' as any, (e: any) => console.log('[DASHPBERR]', JSON.stringify(e).slice(0, 300)))
  player.on('manifestLoaded' as any, () => console.log('[DASH] manifestLoaded'))
  player.on('streamInitialized' as any, () => console.log('[DASH] streamInitialized'))

  const seeking = () => { generation += 1 }
  video.addEventListener('seeking', seeking)

  player.initialize(video, manifestUrl, true, startTime || undefined)

  const destroy = async () => {
    if (destroyed) return
    destroyed = true
    video.removeEventListener('seeking', seeking)
    try { player.destroy() } catch {}
    for (const b of blobUrls) URL.revokeObjectURL(b)
    URL.revokeObjectURL(manifestUrl)
    await api.closePlayback(session.id).catch(() => {})
  }
  signal.addEventListener('abort', () => void destroy(), { once: true })

  return { player, destroy }
}
