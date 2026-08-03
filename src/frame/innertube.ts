import type { SabrFormat } from 'googlevideo/shared-types'

import { buildSabrFormat, FormatKeyUtils } from 'googlevideo/utils'
import { Constants, Innertube, Platform, Types, UniversalCache, Utils, YT } from 'youtubei.js/web'

import type { PlaybackFormat } from './protocol'

import { mintPoToken, recoverPoTokenSession, warmPoTokenSession } from './botguard'
import type { CaptionSource } from './captions'
import type { Storyboard } from './storyboard'

import { parseCaptionTracks } from './captions'
import { egressFetch } from './egress'
import { playableFormats } from './formats'
import { parseStoryboards } from './storyboard'
import { GVS_ORIGIN_KEY, readAccountIndex, VISITOR_DATA_KEY } from './identity'

export { GVS_ORIGIN_KEY }

type YoutubeFormat = {
  itag: number
  target_duration_dec?: number
  width?: number
  height?: number
  bitrate: number
  average_bitrate?: number
  mime_type: string
  quality_label?: string
  xtags?: string
  is_drc?: boolean
  is_dubbed?: boolean
  is_auto_dubbed?: boolean
  is_descriptive?: boolean
  has_audio: boolean
  has_video: boolean
  language?: string | null
  audio_track?: { id: string }
  init_range?: { start: number, end: number }
  index_range?: { start: number, end: number }
}

type InnertubeContext = {
  client: {
    visitorData: string
    clientVersion: string
    clientName: string
    osName: string
    osVersion: string
    userAgent: string
  }
}

const FALLBACK_CLIENT_VERSION = '2.20260618.05.00'

;(Constants as unknown as { CLIENTS: { WEB: { VERSION: string } } }).CLIENTS.WEB.VERSION = FALLBACK_CLIENT_VERSION

/* Evaluates only what youtubei.js already built: Player.decipher appends its own processor ending in
   `return process(n, sp, s)`, so `env` is deliberately unused. Do not re-add a second `return` reading
   `exportedVars.nFunction`/`sigFunction`: neither name exists in youtubei.js 17.0.1, whose only export is `nsigFunction`. */
Platform.shim.eval = async (data: Types.BuildScriptResult, _env: Record<string, Types.VMPrimative>) =>
  new Function(data.output)()

const readVisitorData = () => {
  try {
    return localStorage.getItem(VISITOR_DATA_KEY) ?? undefined
  } catch {
    return undefined
  }
}

const storeVisitorData = (visitorData: string) => {
  try {
    localStorage.setItem(VISITOR_DATA_KEY, visitorData)
  } catch {}
}

const readAuthCookie = () => {
  try {
    return document.cookie.includes('SAPISID=') ? document.cookie : undefined
  } catch {
    return undefined
  }
}

export const hasSessionCookie = () => readAuthCookie() !== undefined

const authCookie = readAuthCookie()

const accountIndex = readAccountIndex()

export const catalogInnertube = Innertube.create({
  fetch: globalThis.fetch.bind(globalThis),
  generate_session_locally: false,
  retrieve_innertube_config: true,
  retrieve_player: false,
  visitor_data: readVisitorData(),
  ...(authCookie && { cookie: authCookie }),
  ...(authCookie && accountIndex !== undefined && { account_index: accountIndex }),
}).then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  // retrieve_innertube_config can hand back a canary/experiment clientVersion; YouTube's public innertube API then rejects EVERY request with FAILED_PRECONDITION.
  const rawVersion = context.client.clientVersion
  if (rawVersion && !/^\d+\.\d{8}\.\d{2}\.\d{2}$/.test(rawVersion)) {
    context.client.clientVersion = rawVersion.match(/(\d+\.\d{8}\.\d{2}\.\d{2})$/)?.[1] ?? FALLBACK_CLIENT_VERSION
  }
  storeVisitorData(context.client.visitorData)
  return client
})

const innertube = catalogInnertube.then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  return Innertube.create({
    fetch: globalThis.fetch.bind(globalThis),
    generate_session_locally: true,
    retrieve_innertube_config: false,
    retrieve_player: true,
    cache: new UniversalCache(true),
    visitor_data: context.client.visitorData,
    user_agent: context.client.userAgent,
    ...(authCookie && { cookie: authCookie }),
    ...(authCookie && accountIndex !== undefined && { account_index: accountIndex }),
  })
})

void catalogInnertube
  .then((client) => {
    const context = client.session.context as unknown as InnertubeContext
    warmPoTokenSession(context, context.client.visitorData)
  })
  .catch(() => {})

try {
  const gvsOrigin = localStorage.getItem(GVS_ORIGIN_KEY)
  if (gvsOrigin) {
    void egressFetch(`${gvsOrigin}/generate_204`, { method: 'GET' })
      .then((response) => response.body?.cancel())
      .catch(() => {})
  }
} catch {}

const scanInitialPlayerResponse = (html: string): Record<string, unknown> | undefined => {
  const marker = html.indexOf('ytInitialPlayerResponse')
  if (marker < 0) return undefined
  const start = html.indexOf('{', marker)
  if (start < 0) return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return JSON.parse(html.slice(start, index + 1)) as Record<string, unknown>
  }
  return undefined
}

const extractInitialPlayerResponse = (html: string) => {
  const parsed = scanInitialPlayerResponse(html)
  if (!parsed) throw new Error('youtube: player response is missing')
  return parsed
}

const fetchInitialPlayerResponse = async (videoId: string) => {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`)
  const reader = response.body?.getReader()
  if (!reader) return extractInitialPlayerResponse(await response.text())
  const decoder = new TextDecoder()
  let html = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    html += decoder.decode(chunk.value, { stream: true })
    const parsed = scanInitialPlayerResponse(html)
    if (parsed) {
      void reader.cancel().catch(() => {})
      return parsed
    }
  }
  html += decoder.decode()
  return extractInitialPlayerResponse(html)
}

const playbackResponseCache = new Map<string, Promise<Record<string, unknown>>>()

export const prefetchInitialPlayerResponse = (videoId: string) => {
  const cached = playbackResponseCache.get(videoId)
  if (cached) return cached
  const promise = fetchInitialPlayerResponse(videoId)
  playbackResponseCache.set(videoId, promise)
  promise.catch(() => {
    if (playbackResponseCache.get(videoId) === promise) playbackResponseCache.delete(videoId)
  })
  if (playbackResponseCache.size > 6) {
    const oldest = playbackResponseCache.keys().next().value
    if (oldest !== undefined && oldest !== videoId) playbackResponseCache.delete(oldest)
  }
  return promise
}

type BeaconFormat = Pick<YoutubeFormat, 'itag' | 'has_audio' | 'has_video'>

const registerPlayback = async (raw: Record<string, unknown>, nonce: string, formats: BeaconFormat[]) => {
  const base = (raw as {
    playbackTracking?: { videostatsPlaybackUrl?: { baseUrl?: string } }
  }).playbackTracking?.videostatsPlaybackUrl?.baseUrl
  if (!base) return
  const url = new URL(base)
  url.searchParams.set('ver', '2')
  url.searchParams.set('cpn', nonce)
  const audio = formats.find((format) => format.has_audio && !format.has_video)
  const video = formats.find((format) => format.has_video)
  if (audio) url.searchParams.set('afmt', String(audio.itag))
  if (video) url.searchParams.set('fmt', String(video.itag))
  const response = await fetch(url, { method: 'POST' })
  if (!response.ok) console.warn(`youtube: playback registration returned ${response.status}`)
}

const beaconFormats = (raw: Record<string, unknown>): BeaconFormat[] => {
  const adaptive = (raw as {
    streamingData?: { adaptiveFormats?: { itag?: number, mimeType?: string }[] }
  }).streamingData?.adaptiveFormats ?? []
  return adaptive.flatMap((format) => {
    if (!format.itag || !format.mimeType) return []
    return [{
      itag: format.itag,
      has_video: format.mimeType.startsWith('video'),
      has_audio: format.mimeType.startsWith('audio'),
    }]
  })
}

/* `init_range` is required for VOD and absent for live. It still gates VOD on purpose: letting range-less
   formats through there admits ones the VOD manifest cannot describe and playback stops before the first
   frame. Requiring it unconditionally is what dropped every live format before a session could be built. */
const playbackFormat = (format: YoutubeFormat, isLive: boolean): PlaybackFormat | undefined => {
  if (!format.mime_type) return undefined
  if (!isLive && !format.init_range) return undefined
  const sabr = buildSabrFormat(format as never)
  const key = FormatKeyUtils.fromFormat(sabr)
  if (!key) return undefined
  return {
    key,
    itag: format.itag,
    mimeType: format.mime_type,
    bitrate: format.average_bitrate ?? format.bitrate,
    width: format.width,
    height: format.height,
    qualityLabel: format.quality_label,
    audioTrackId: format.audio_track?.id,
    language: format.language ?? undefined,
    initRange: format.init_range,
    indexRange: format.index_range,
    targetDurationMs: format.target_duration_dec ? format.target_duration_dec * 1_000 : undefined,
  }
}

export type SabrSource = {
  videoId: string
  isLive: boolean
  durationMs: number
  manifest: string
  streamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  playbackFormats: PlaybackFormat[]
  storyboards: Storyboard[]
  captions: CaptionSource[]
  clientInfo: Record<string, unknown>
  mint(): Promise<string>
  recoverMint(): Promise<void>
}

export const getSabrSource = async (videoId: string): Promise<SabrSource> => {
  // The /player API alternative is NOT an option: anonymous /player calls yield preview-tier (~60s) SABR sessions.
  const rawPromise = prefetchInitialPlayerResponse(videoId)
  // Consumed and EVICTED: a session refresh or retry re-enters here needing fresh streaming URLs and must not reuse the cached response.
  playbackResponseCache.delete(videoId)
  void rawPromise.catch(() => {})
  void rawPromise.then((raw) => {
    const streamingUrl = (raw as {
      streamingData?: { serverAbrStreamingUrl?: string }
    }).streamingData?.serverAbrStreamingUrl
    if (!streamingUrl) return
    return egressFetch(`${new URL(streamingUrl).origin}/generate_204`, { method: 'GET' })
      .then((response) => response.body?.cancel())
  }).catch(() => {})
  const catalogClient = await catalogInnertube
  const catalogContext = catalogClient.session.context as unknown as InnertubeContext
  warmPoTokenSession(catalogContext, catalogContext.client.visitorData)
  const nonce = Utils.generateRandomString(16)
  void rawPromise.then((raw) => registerPlayback(raw, nonce, beaconFormats(raw))).catch(() => {})
  const client = await innertube
  const context = client.session.context as unknown as InnertubeContext
  const raw = await rawPromise
  const info = new YT.VideoInfo([{ data: raw } as never], client.actions, Utils.generateRandomString(16))
  if (info.playability_status?.status !== 'OK') {
    throw new Error(`youtube: ${info.playability_status?.reason ?? info.playability_status?.status ?? 'not playable'}`)
  }
  const streaming = info.streaming_data
  /* `is_live` rather than `is_live_content`, which stays true for the VOD a finished stream leaves behind. */
  const isLive = info.basic_info?.is_live === true
  if (!streaming?.server_abr_streaming_url) throw new Error('youtube: SABR URL is missing')
  const rawFormats = playableFormats(streaming.adaptive_formats ?? []) as unknown as YoutubeFormat[]
  const playbackFormats = rawFormats
    .map((format) => playbackFormat(format, isLive))
    .filter((format) => format !== undefined)
  // The manifest must advertise EXACTLY the formats the SABR session can serve, so it is filtered by format KEY rather than by itag: a DRC or dubbed audio track shares itag 251 with the plain one and differs only in xtags.
  const allowedKeys = new Set(playbackFormats.map((format) => format.key))
  const [manifest, decipheredUrl] = await Promise.all([
    isLive ? Promise.resolve('') : info.toDash({
      format_filter: (format: YoutubeFormat) => {
        const key = FormatKeyUtils.fromFormat(buildSabrFormat(format as never))
        return !key || !allowedKeys.has(key)
      },
      manifest_options: { is_sabr: true, include_thumbnails: false },
    } as never),
    client.session.player!.decipher(streaming.server_abr_streaming_url),
  ])
  const url = new URL(decipheredUrl)
  url.searchParams.set('alr', 'yes')
  url.searchParams.set('cpn', nonce)
  const ustreamerConfig = info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
  if (!ustreamerConfig) throw new Error('youtube: ustreamer configuration is missing')
  // The WEB GVS/streaming poToken is bound to the VIDEO ID, not the visitor or datasync id; the botguard session itself stays visitor/attestation-bound.
  const mintIdentifier = videoId
  warmPoTokenSession(context, mintIdentifier)
  return {
    videoId,
    isLive,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1_000,
    manifest,
    streamingUrl: url.toString(),
    ustreamerConfig,
    formats: rawFormats.map((format) => buildSabrFormat(format as never)),
    playbackFormats,
    storyboards: parseStoryboards((raw as {
      storyboards?: { playerStoryboardSpecRenderer?: { spec?: string } }
    }).storyboards?.playerStoryboardSpecRenderer?.spec),
    captions: parseCaptionTracks(info.captions),
    clientInfo: {
      clientName: Number((Constants.CLIENT_NAME_IDS as Record<string, string>)[context.client.clientName]),
      clientVersion: context.client.clientVersion,
      osName: context.client.osName,
      osVersion: context.client.osVersion,
    },
    mint: () => mintPoToken(mintIdentifier, context),
    recoverMint: () => recoverPoTokenSession(context),
  }
}

