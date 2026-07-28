import type { SabrFormat } from 'googlevideo/shared-types'

import { buildSabrFormat, FormatKeyUtils } from 'googlevideo/utils'
import { Constants, Innertube, Platform, Types, UniversalCache, Utils, YT } from 'youtubei.js/web'

import type { PlaybackFormat } from './protocol'

import { mintPoToken, recoverPoTokenSession, warmPoTokenSession } from './botguard'
import type { Storyboard } from './storyboard'

import { egressFetch } from './egress'
import { playableFormats } from './formats'
import { parseStoryboards } from './storyboard'
import { GVS_ORIGIN_KEY, VISITOR_DATA_KEY } from './identity'

export { GVS_ORIGIN_KEY }

type YoutubeFormat = {
  itag: number
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

Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties: string[] = []
  if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`)
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
  return new Function(`${data.output}\nreturn { ${properties.join(', ')} }`)()
}

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

// document.cookie is scramjet-trapped to the shared jar; SAPISID is not
// httpOnly, so its presence is the signed-in probe and the string itself is
// what youtubei.js needs to compute SAPISIDHASH.
const readAuthCookie = () => {
  try {
    return document.cookie.includes('SAPISID=') ? document.cookie : undefined
  } catch {
    return undefined
  }
}

export const hasSessionCookie = () => readAuthCookie() !== undefined

// Frozen at boot: the cookie is baked into the Innertube clients below, and
// any auth change rebuilds the whole engine frame anyway.
const authCookie = readAuthCookie()

export const catalogInnertube = Innertube.create({
  fetch: globalThis.fetch.bind(globalThis),
  generate_session_locally: false,
  retrieve_innertube_config: true,
  retrieve_player: false,
  // Reusing the visitor id keeps persisted PoTokens valid across page loads.
  visitor_data: readVisitorData(),
  // A SAPISID-bearing jar means the user is signed in: passing the cookie
  // flips youtubei.js into SAPISIDHASH + X-Goog-Authuser mode — identity
  // cookies arriving without a matching Authorization header get 401s.
  ...(authCookie && { cookie: authCookie }),
}).then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  // retrieve_innertube_config can hand back a canary/experiment clientVersion
  // (e.g. "2.20260710.06.00-canary_experiment_2.20260708.00.00") — YouTube's
  // public innertube API then rejects EVERY request with FAILED_PRECONDITION.
  // (Seen on Firefox: its proxied-request fingerprint gets bucketed into the
  // canary experiment where Chromium gets the stable version.) Pin it back to a
  // plain stable X.YYYYMMDD.NN.NN version — the stable one is embedded at the
  // tail of the canary string; fall back to the pinned version otherwise.
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
    // Persists the analyzed player script so later loads skip the base.js
    // download and extraction entirely.
    cache: new UniversalCache(true),
    visitor_data: context.client.visitorData,
    user_agent: context.client.userAgent,
    ...(authCookie && { cookie: authCookie }),
  })
})

// Warm the botguard/PoToken session as soon as the frame boots (unless a
// persisted token already covers it) so it overlaps the player download and,
// on browse-first navigation, finishes before the first video is even opened.
void catalogInnertube
  .then((client) => {
    const context = client.session.context as unknown as InnertubeContext
    warmPoTokenSession(context, context.client.visitorData)
  })
  .catch(() => {})

// The googlevideo edge host that streams end up redirected to is stable across
// videos, so dial it at frame boot: the first segment request then reuses a
// live connection instead of paying redirect + TLS setup.
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

// The player response sits early in the watch page, well before the bulk of
// the document (ytInitialData, UI payload): parse it incrementally off the
// stream and drop the rest of the transfer as soon as it closes.
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

// The watch-page fetch can be kicked as soon as the videoId is known (route
// resolution), well before the player subtree mounts and calls openPlayback.
// Memoized by id so getSabrSource reuses the in-flight transfer instead of
// starting its own ~500ms fetch; getSabrSource consumes-and-evicts it (below).
const playbackResponseCache = new Map<string, Promise<Record<string, unknown>>>()

export const prefetchInitialPlayerResponse = (videoId: string) => {
  const cached = playbackResponseCache.get(videoId)
  if (cached) return cached
  const promise = fetchInitialPlayerResponse(videoId)
  playbackResponseCache.set(videoId, promise)
  // A rejected prefetch must not poison the real open: drop it so getSabrSource
  // refetches cleanly.
  promise.catch(() => {
    if (playbackResponseCache.get(videoId) === promise) playbackResponseCache.delete(videoId)
  })
  // Bound the map — only a handful of prefetched-but-unopened ids matter at once.
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

const playbackFormat = (format: YoutubeFormat): PlaybackFormat | undefined => {
  if (!format.init_range || !format.mime_type) return undefined
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
  }
}

// The watch page renders its own card for a live stream rather than mounting a
// player, so this is a backstop: it catches a video that went live between the
// page load and the open, and it must stay recognizable to the retry ladder,
// which does not retry it.
export const LIVE_UNSUPPORTED = 'youtube: live streams are not playable in this client yet'

export type SabrSource = {
  videoId: string
  durationMs: number
  manifest: string
  streamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  playbackFormats: PlaybackFormat[]
  storyboards: Storyboard[]
  clientInfo: Record<string, unknown>
  mint(): Promise<string>
  recoverMint(): Promise<void>
}

export const getSabrSource = async (videoId: string): Promise<SabrSource> => {
  // The watch page depends on nothing else: fetch it while the player client
  // and botguard session come up. Reuse a prefetch fired at route resolution if
  // one is in flight, then evict — a session refresh / retry re-enters here for
  // fresh streaming URLs and must not reuse this response. Only the page's
  // /player API alternative is NOT an option: anonymous /player calls yield
  // preview-tier (~60s) SABR sessions (see the "past one minute" browser test).
  const rawPromise = prefetchInitialPlayerResponse(videoId)
  playbackResponseCache.delete(videoId)
  void rawPromise.catch(() => {})
  // Warm the egress connection to the streaming host as soon as it is known so
  // the first segment request skips the tunneled TCP+TLS dial.
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
  // The playback registration beacon is fire-and-forget: it must not gate the
  // player, and a failed beacon is not worth failing playback over.
  void rawPromise.then((raw) => registerPlayback(raw, nonce, beaconFormats(raw))).catch(() => {})
  const client = await innertube
  const context = client.session.context as unknown as InnertubeContext
  const raw = await rawPromise
  const info = new YT.VideoInfo([{ data: raw } as never], client.actions, Utils.generateRandomString(16))
  if (info.playability_status?.status !== 'OK') {
    throw new Error(`youtube: ${info.playability_status?.reason ?? info.playability_status?.status ?? 'not playable'}`)
  }
  const streaming = info.streaming_data
  /* Live is refused here, ahead of any SABR work, so it fails as one clear
     statement rather than as a toDash exception three retries deep.

     What was measured (2026-07-28, against a live stream): the WEB watch page
     carries NO dashManifestUrl and NO hlsManifestUrl, only
     serverAbrStreamingUrl. The per-format `url` values it does carry answer 403
     with an empty body on every variant tried: bare, with &sq, with a minted
     &pot, with &alr=yes, and with &cpn/&c/&cver. So neither of the two cheap
     routes exists for this client: there is no manifest to proxy, and the
     direct segment URLs are not served. Live on web is SABR, and reaching it
     means driving the SABR session with live semantics behind a hand-written
     dynamic MPD, which is its own piece of work.

     `is_live` rather than `is_live_content`, which stays true for the VOD a
     finished stream leaves behind. */
  if (info.basic_info?.is_live) throw new Error(LIVE_UNSUPPORTED)
  if (!streaming?.server_abr_streaming_url) throw new Error('youtube: SABR URL is missing')
  const rawFormats = playableFormats(streaming.adaptive_formats ?? []) as unknown as YoutubeFormat[]
  const playbackFormats = rawFormats.map(playbackFormat).filter((format) => format !== undefined)
  // The manifest must advertise EXACTLY the formats the SABR session can serve,
  // so it is filtered by format KEY rather than by itag. Filtering by itag is
  // not enough: a DRC or dubbed audio track shares itag 251 with the plain one
  // and differs only in xtags, so it passed the itag filter into the manifest
  // while being excluded from the session's format list. Auto ABR never chose
  // it, but any manual variant switch could, and then every segment request for
  // it failed with "unknown audio format 251:...".
  const allowedKeys = new Set(playbackFormats.map((format) => format.key))
  const [manifest, decipheredUrl] = await Promise.all([
    info.toDash({
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
  // The WEB GVS/streaming poToken is bound to the VIDEO ID, not the visitor or
  // datasync id: YouTube moved web playback to video-id-bound tokens, and a
  // session/visitor-bound token now only earns the ~60s StreamProtectionStatus=2
  // preview before media is withheld. (Ref: LuanRT/kira mintAsWebsafeString(videoId),
  // FreeTube #8137, yt-dlp PO Token Guide.) The botguard session itself stays
  // visitor/attestation-bound; only the mint's content binding is the video id.
  const mintIdentifier = videoId
  // The boot-time warmup builds the shared botguard session (keyed on visitor
  // data); this re-check is a no-op once that session is live, and otherwise
  // kicks it off so the per-video mint below has a real minter to use.
  warmPoTokenSession(context, mintIdentifier)
  return {
    videoId,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1_000,
    manifest,
    streamingUrl: url.toString(),
    ustreamerConfig,
    formats: rawFormats.map((format) => buildSabrFormat(format as never)),
    playbackFormats,
    // VideoInfo does not surface the storyboard spec, so it is read straight
    // off the raw player response.
    storyboards: parseStoryboards((raw as {
      storyboards?: { playerStoryboardSpecRenderer?: { spec?: string } }
    }).storyboards?.playerStoryboardSpecRenderer?.spec),
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

