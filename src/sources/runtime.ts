import type { SourceApi } from './types'

import { startEngine } from '../scramjet/client'

let resolveSource: (source: SourceApi) => void = () => {}
let source = new Promise<SourceApi>((resolve) => {
  resolveSource = resolve
})

export const setSource = (next: SourceApi) => {
  resolveSource(next)
  source = Promise.resolve(next)
}

const callSource = async <Result>(call: (api: SourceApi) => Promise<Result>, retry = true) => {
  try {
    const current = await Promise.race([
      source,
      startEngine().then((next) => {
        setSource(next)
        return next
      }),
    ])
    return await call(current)
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('yt-client:'))) throw error
    const next = await startEngine()
    setSource(next)
    if (!retry) throw new Error('youtube: continuation expired after engine restart')
    return call(next)
  }
}

export const sourceApi = {
  home: async (cursor?: string) => callSource((api) => api.home(cursor), cursor === undefined),
  search: async (query: string, cursor?: string) => callSource((api) => api.search(query, cursor), cursor === undefined),
  video: async (id: string) => callSource((api) => api.video(id)),
  channel: async (id: string, cursor?: string) => callSource((api) => api.channel(id, cursor), cursor === undefined),
  watch: async (id: string) => callSource((api) => api.watch(id)),
  comments: async (videoId: string, cursor?: string) => callSource((api) => api.comments(videoId, cursor), cursor === undefined),
} satisfies SourceApi
