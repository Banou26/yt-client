import type { Source, SourceChannel, SourceVideoPage } from '../types'

import { Innertube } from 'youtubei.js/web'

import { normalizeChannel, normalizeFeedVideo, normalizeVideoDetails } from './normalize'

type Feed = {
  videos: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<Feed>
}

type ChannelFeed = Feed & {
  metadata?: unknown
  has_videos?: boolean
  getVideos?: () => Promise<ChannelFeed>
}

type YoutubeClient = {
  getHomeFeed(): Promise<Feed>
  search(query: string): Promise<Feed>
  getBasicInfo(id: string): Promise<{ basic_info?: unknown }>
  getChannel(id: string): Promise<ChannelFeed>
}

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
}

const pageItems = (feed: Feed) =>
  [...feed.videos].map(normalizeFeedVideo).filter((video) => video !== undefined)

export const createYoutubeSource = ({ fetch, createClient }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as Promise<YoutubeClient>
  const continuations = new Map<string, () => Promise<SourceVideoPage>>()
  const channels = new Map<string, SourceChannel>()
  let cursorId = 0

  const page = (feed: Feed): SourceVideoPage => {
    const result: SourceVideoPage = { items: pageItems(feed) }
    if (feed.has_continuation) {
      const cursor = `youtube:${++cursorId}`
      continuations.set(cursor, async () => page(await feed.getContinuation()))
      result.cursor = cursor
    }
    return result
  }

  const continuation = async (cursor: string) => {
    const next = continuations.get(cursor)
    if (!next) throw new Error(`youtube: unknown continuation ${cursor}`)
    continuations.delete(cursor)
    return next()
  }

  return {
    id: 'youtube',
    home: async (cursor) => cursor
      ? continuation(cursor)
      : page(await (await client).getHomeFeed()),
    search: async (query, cursor) => cursor
      ? continuation(cursor)
      : page(await (await client).search(query)),
    video: async (id) => normalizeVideoDetails((await (await client).getBasicInfo(id)).basic_info),
    channel: async (id, cursor) => {
      let channel = channels.get(id)
      if (cursor) {
        if (!channel) throw new Error(`youtube: channel ${id} is not loaded`)
        return { channel, videos: await continuation(cursor) }
      }
      const result = await (await client).getChannel(id)
      channel = normalizeChannel(result, id)
      channels.set(id, channel)
      const videos = result.has_videos && result.getVideos ? await result.getVideos() : result
      return { channel, videos: page(videos) }
    },
  }
}
