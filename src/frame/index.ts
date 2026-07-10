import type { FrameApi } from './protocol'

import { expose } from 'osra'

import { createYoutubeSource } from '../sources/youtube'
import { innertube, getSabrSource } from './innertube'
import { createSabrSession } from './sabr'
import { FRAME_CONNECT, FRAME_READY } from './protocol'

const source = createYoutubeSource({
  fetch: globalThis.fetch.bind(globalThis),
  createClient: () => innertube,
})

const sessions = new Map<string, ReturnType<typeof createSabrSession>>()
let sessionId = 0

const api = {
  home: source.home,
  search: source.search,
  video: source.video,
  channel: source.channel,
  openPlayback: async (videoId, maxHeight) => {
    const id = `playback:${++sessionId}`
    const session = createSabrSession(await getSabrSource(videoId), maxHeight)
    sessions.set(id, session)
    return {
      id,
      durationMs: session.durationMs,
      videoFormats: session.videoFormats,
      audioFormats: session.audioFormats,
      selectedVideoKey: session.videoFormat.key,
      selectedAudioKey: session.audioFormat.key,
    }
  },
  requestSegment: async (request) => {
    const session = sessions.get(request.sessionId)
    if (!session) throw new Error(`youtube: unknown playback session ${request.sessionId}`)
    return session.requestSegment(request)
  },
  selectVideoFormat: async (id, key) => {
    const session = sessions.get(id)
    if (!session) throw new Error(`youtube: unknown playback session ${id}`)
    session.selectVideoFormat(key)
  },
  closePlayback: async (id) => {
    sessions.get(id)?.close()
    sessions.delete(id)
  },
} satisfies FrameApi

window.addEventListener('message', (event) => {
  if (event.data?.type !== FRAME_CONNECT || !event.ports[0]) return
  const port = event.ports[0]
  port.start()
  port.postMessage({ type: FRAME_READY })
  expose(api, {
    key: FRAME_CONNECT,
    transport: { receive: port, emit: port },
  })
}, { once: true })
