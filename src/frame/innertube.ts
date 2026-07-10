import type { SabrFormat } from 'googlevideo/shared-types'

import { buildSabrFormat, FormatKeyUtils } from 'googlevideo/utils'
import { Constants, Innertube, Platform, Types, Utils, YT } from 'youtubei.js/web'

import type { PlaybackFormat } from './protocol'

import { mintPoToken, preparePoToken } from './botguard'

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

export const catalogInnertube = Innertube.create({
  fetch: globalThis.fetch.bind(globalThis),
  generate_session_locally: true,
  retrieve_innertube_config: false,
  retrieve_player: false,
})

const innertube = catalogInnertube.then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  return Innertube.create({
    fetch: globalThis.fetch.bind(globalThis),
    generate_session_locally: true,
    retrieve_innertube_config: false,
    retrieve_player: true,
    visitor_data: context.client.visitorData,
    user_agent: context.client.userAgent,
  })
})

const extractInitialPlayerResponse = (html: string) => {
  const marker = html.indexOf('ytInitialPlayerResponse')
  if (marker < 0) throw new Error('youtube: player response is missing')
  const start = html.indexOf('{', marker)
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
  throw new Error('youtube: player response is incomplete')
}

const registerPlayback = async (raw: Record<string, unknown>, nonce: string, formats: YoutubeFormat[]) => {
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
  if (!response.ok) throw new Error(`youtube: playback registration returned ${response.status}`)
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
  }
}

export type SabrSource = {
  videoId: string
  durationMs: number
  manifest: string
  streamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  playbackFormats: PlaybackFormat[]
  clientInfo: Record<string, unknown>
  mint(): Promise<string>
}

export const getSabrSource = async (videoId: string): Promise<SabrSource> => {
  const catalogClient = await catalogInnertube
  const preparedPoToken = preparePoToken(catalogClient.session.context as unknown as InnertubeContext)
  void preparedPoToken.catch(() => {})
  const client = await innertube
  const context = client.session.context as unknown as InnertubeContext
  const html = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`).then((response) => response.text())
  const raw = extractInitialPlayerResponse(html)
  const info = new YT.VideoInfo([{ data: raw } as never], client.actions, Utils.generateRandomString(16))
  if (info.playability_status?.status !== 'OK') {
    throw new Error(`youtube: ${info.playability_status?.reason ?? info.playability_status?.status ?? 'not playable'}`)
  }
  const streaming = info.streaming_data
  if (!streaming?.server_abr_streaming_url) throw new Error('youtube: SABR URL is missing')
  const rawFormats = (streaming.adaptive_formats ?? []).filter((format) => {
    if (!format.has_audio || format.has_video) return true
    return !format.xtags && !format.is_drc && !format.is_dubbed && !format.is_auto_dubbed && !format.is_descriptive
  }) as unknown as YoutubeFormat[]
  const datasyncId = (raw as {
    responseContext?: { mainAppWebResponseContext?: { datasyncId?: string } }
  }).responseContext?.mainAppWebResponseContext?.datasyncId?.split('||')[0]
  const allowedFormats = new Set(rawFormats.map((format) => format.itag))
  const nonce = Utils.generateRandomString(16)
  const [manifest, decipheredUrl] = await Promise.all([
    info.toDash({
      format_filter: (format: YoutubeFormat) => !allowedFormats.has(format.itag),
      manifest_options: { is_sabr: true, include_thumbnails: false },
    } as never),
    client.session.player!.decipher(streaming.server_abr_streaming_url),
    registerPlayback(raw, nonce, rawFormats),
    preparedPoToken,
  ])
  const url = new URL(decipheredUrl)
  url.searchParams.set('alr', 'yes')
  url.searchParams.set('cpn', nonce)
  const ustreamerConfig = info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
  if (!ustreamerConfig) throw new Error('youtube: ustreamer configuration is missing')
  return {
    videoId,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1_000,
    manifest,
    streamingUrl: url.toString(),
    ustreamerConfig,
    formats: rawFormats.map((format) => buildSabrFormat(format as never)),
    playbackFormats: rawFormats.map(playbackFormat).filter((format) => format !== undefined),
    clientInfo: {
      clientName: Number((Constants.CLIENT_NAME_IDS as Record<string, string>)[context.client.clientName]),
      clientVersion: context.client.clientVersion,
      osName: context.client.osName,
      osVersion: context.client.osVersion,
    },
    mint: () => mintPoToken(datasyncId ?? videoId, context),
  }
}
