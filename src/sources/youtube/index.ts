import type { Source, SourceChannel, SourceCommentPage, SourceVideoPage } from '../types'

import { Innertube } from 'youtubei.js/web'

import { normalizeChannel, normalizeCommentThread, normalizeFeedVideo, normalizeLockupVideo, normalizeVideoDetails, normalizeWatchMeta } from './normalize'

type Feed = {
  videos: Iterable<unknown>
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<Feed>
}

type ChannelFeed = Feed & {
  metadata?: unknown
  has_videos?: boolean
  getVideos?: () => Promise<ChannelFeed>
}

type CommentsFeed = {
  contents: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<CommentsFeed>
}

type YoutubeClient = {
  getHomeFeed(): Promise<Feed>
  search(query: string): Promise<Feed>
  getBasicInfo(id: string): Promise<{ basic_info?: unknown }>
  getChannel(id: string): Promise<ChannelFeed>
  getComments(videoId: string): Promise<CommentsFeed>
  actions: {
    execute(endpoint: '/next', args: { videoId: string, racyCheckOk: boolean, contentCheckOk: boolean, parse: true }): Promise<unknown>
  }
}

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
}

const pageItems = (feed: Feed) => {
  const videos = [...feed.videos].map(normalizeFeedVideo).filter((video) => video !== undefined)
  if (videos.length > 0) return videos
  // new-layout feeds (channel Videos tab) ship LockupView nodes, which
  // youtubei.js's videos getter does not include — read them off the memo.
  const lockups = feed.memo?.get('LockupView') ?? []
  return [...lockups].map(normalizeLockupVideo).filter((video) => video !== undefined)
}

export const createYoutubeSource = ({ fetch, createClient }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as Promise<YoutubeClient>
  const continuations = new Map<string, () => Promise<SourceVideoPage>>()
  const commentContinuations = new Map<string, () => Promise<SourceCommentPage>>()
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

  const commentPage = (comments: CommentsFeed): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: [...comments.contents].map(normalizeCommentThread).filter((comment) => comment !== undefined),
    }
    if (comments.has_continuation) {
      const cursor = `youtube:${++cursorId}`
      commentContinuations.set(cursor, async () => commentPage(await comments.getContinuation()))
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
    // A single /next call carries everything the watch page needs on top of
    // playback (which fetches /player separately): one tunneled round trip.
    watch: async (id) => normalizeWatchMeta(
      await (await client).actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        parse: true,
      }),
      id,
    ),
    comments: async (videoId, cursor) => {
      if (cursor) {
        const next = commentContinuations.get(cursor)
        if (!next) throw new Error(`youtube: unknown continuation ${cursor}`)
        commentContinuations.delete(cursor)
        return next()
      }
      try {
        return commentPage(await (await client).getComments(videoId))
      } catch (error) {
        // videos with comments turned off make youtubei.js throw
        // "Comments page did not have any content." — an expected state, not a failure.
        if (error instanceof Error && /did not have any content/i.test(error.message)) {
          return { items: [], disabled: true }
        }
        throw error
      }
    },
  }
}
