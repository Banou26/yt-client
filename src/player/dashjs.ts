import type { FrameApi } from '../frame/protocol'

// Play yt-client's SABR-via-frame stream through dash.js (no Shaka). The frame
// emits a SegmentBase DASH manifest whose base URLs are sabr://<track>?key=<fmt>.
// We (1) rewrite it to a time-based SegmentTemplate so dash.js drops its eager
// per-representation sidx indexing (~20 fetches → 3), and rewrite sabr:// →
// https://sabr.invalid/ so dash.js resolves the URLs; then (2) a request
// interceptor turns each segment request into a FrameApi.requestSegment call and
// hands dash.js the bytes back via a blob URL.
import * as dashjs from 'dashjs'

type Args = {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  startTime: number
  signal: AbortSignal
  onError(error: unknown): void
}

// SegmentBase (sidx byte-ranges) → time-based SegmentTemplate. Segments are ~5s
// and the frame returns the covering segment for any startMs, so an approximate
// template duration is fine — the interceptor keys the time off dash.js's
// per-segment mediaStartTime, not the nominal duration.
const toTemplate = (xml: string) => xml.replace(
  /<BaseURL>(sabr:\/\/[^<]+)<\/BaseURL>\s*<SegmentBase[^>]*>\s*<Initialization[^>]*\/>\s*<\/SegmentBase>/g,
  (_m, base) => `<SegmentTemplate initialization="${base}&init" media="${base}&sq=$Number$" duration="5000" timescale="1000" startNumber="1"/>`,
)

export const startDashPlayback = async ({ api, video, videoId, startTime, signal, onError }: Args) => {
  if (signal.aborted) throw signal.reason
  const maxHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  const session = await api.openPlayback(videoId, maxHeight)
  if (signal.aborted) throw signal.reason

  const manifestXml = toTemplate(session.manifest).replaceAll('sabr://', 'https://sabr.invalid/')
  const manifestUrl = URL.createObjectURL(new Blob([manifestXml], { type: 'application/dash+xml' }))

  let generation = 0
  let requestNumber = 0
  let destroyed = false
  const blobUrls = new Set<string>()

  const player = dashjs.MediaPlayer().create()
  // Match the initial (and ongoing) quality to the player size, like Shaka's
  // abr.restrictToElementSize — otherwise dash.js grabs a huge 4K/AV1 first
  // segment and first-frame balloons.
  player.updateSettings({
    streaming: {
      abr: {
        limitBitrateByPortal: true,
        usePixelRatioInLimitBitrateByPortal: true,
      },
      buffer: {
        // Start playback as soon as the first segment is decodable instead of
        // over-buffering first (Shaka used rebufferingGoal:0 for the same effect).
        initialBufferLevel: 1,
      },
    },
  })

  const interceptor = async (req: { url: string, headers?: Record<string, string>, range?: unknown, customData?: { request?: { mediaStartTime?: number | null, range?: unknown } } }) => {
    let host = ''
    try { host = new URL(req.url).host } catch { return req }
    if (host !== 'sabr.invalid') return req
    try {
      const u = new URL(req.url)
      const track = (u.pathname.replace(/^\//, '') || 'audio') as 'audio' | 'video'
      const formatKey = u.searchParams.get('key') ?? ''
      const fr = req.customData?.request ?? {}
      // dash.js computes mediaStartTime from the SegmentTemplate: null on the init
      // template fetch, a real time on media segments.
      const hasStart = fr.mediaStartTime != null && Number.isFinite(Number(fr.mediaStartTime))
      const kind: 'init' | 'media' = hasStart ? 'media' : 'init'
      const startTimeMs = hasStart ? Math.round(Number(fr.mediaStartTime) * 1000) : 0
      const seg = await api.requestSegment({
        requestId: `dash:${++requestNumber}`,
        sessionId: session.id,
        generation,
        track,
        kind,
        formatKey,
        startTimeMs,
        snapshot: {
          currentTimeMs: video.currentTime * 1000,
          playbackRate: video.playbackRate,
          bandwidthEstimate: 10_000_000,
          viewportWidth: Math.max(1, video.clientWidth),
          viewportHeight: Math.max(1, video.clientHeight),
        },
      })
      if (seg.end || !seg.data) return req
      const blob = URL.createObjectURL(new Blob([seg.data]))
      blobUrls.add(blob)
      req.url = blob
      // Strip range hints so dash.js reads the whole blob (= exactly this segment).
      if (req.headers) { delete req.headers.Range; delete req.headers.range }
      req.range = undefined
      if (req.customData?.request) req.customData.request.range = null
      return req
    } catch {
      return req
    }
  }
  player.addRequestInterceptor(interceptor as never)

  player.on('error' as never, ((e: { error?: { message?: string, code?: number } }) => {
    if (!destroyed) onError(new Error(`dash: ${e?.error?.message ?? e?.error?.code ?? 'error'}`))
  }) as never)

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
