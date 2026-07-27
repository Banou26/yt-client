import type { Source, SourceChannel, SourceCommentPage, SourceLikeStatus, SourceNotificationLevel, SourceVideo, SourceVideoPage } from '../types'

import { Innertube } from 'youtubei.js/web'

import { normalizeChannel, normalizeCommentThread, normalizeFeedVideo, normalizeLockupVideo, normalizeSession, normalizeVideoDetails, normalizeWatchMeta } from './normalize'

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
  account: {
    getInfo(): Promise<unknown>
  }
  interact: {
    subscribe(channelId: string): Promise<unknown>
    unsubscribe(channelId: string): Promise<unknown>
    setNotificationPreferences(channelId: string, type: SourceNotificationLevel): Promise<unknown>
  }
  session: {
    logged_in: boolean
  }
  actions: {
    execute(endpoint: '/next', args: { videoId: string, racyCheckOk: boolean, contentCheckOk: boolean, parse: true }): Promise<unknown>
    execute(endpoint: '/like/like' | '/like/dislike' | '/like/removelike', args: { target: { videoId: string } }): Promise<unknown>
  }
}

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
  signedIn?: () => boolean
}

const pageItems = (feed: Feed) => {
  // youtubei.js's `videos` getter surfaces legacy Video/GridVideo nodes but NOT
  // LockupView, and a modern feed (the signed-in home grid, channel Videos tab)
  // MIXES the two. Merging rather than either/or is essential: a single stray
  // legacy video used to short-circuit the LockupView branch and hide the whole
  // grid — the signed-in home then showed just that one video.
  const seen = new Set<string>()
  const items: SourceVideo[] = []
  const add = (video: SourceVideo | undefined) => {
    if (video && !seen.has(video.id)) {
      seen.add(video.id)
      items.push(video)
    }
  }
  for (const node of feed.videos) add(normalizeFeedVideo(node))
  for (const node of feed.memo?.get('LockupView') ?? []) add(normalizeLockupVideo(node))
  return items
}

// Cursors used to be one-shot: reading one deleted it, so any repeat of the same
// query threw `unknown continuation`. urql re-executes queries on remount and on
// back-navigation, so the second page of a feed died as soon as the user opened a
// video and came back. Pages are memoized per cursor instead, and the cursor
// carries the feed it belongs to so a home cursor cannot continue a search.
const CONTINUATION_LIMIT = 64

const createContinuations = <Page>() => {
  type Entry = { kind: string, load: () => Promise<Page>, result?: Promise<Page> }
  const entries = new Map<string, Entry>()
  let cursorId = 0

  const register = (kind: string, load: () => Promise<Page>) => {
    const cursor = `youtube:${kind}:${++cursorId}`
    entries.set(cursor, { kind, load })
    // Insertion order is eviction order, and `resolve` re-inserts on read, so
    // the cursors a user is actually paging through stay live.
    while (entries.size > CONTINUATION_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return cursor
  }

  const resolve = (kind: string, cursor: string) => {
    const entry = entries.get(cursor)
    if (!entry) throw new Error(`youtube: unknown continuation ${cursor}`)
    if (entry.kind !== kind) throw new Error(`youtube: continuation ${cursor} belongs to ${entry.kind}, not ${kind}`)
    if (!entry.result) {
      const result = entry.load()
      entry.result = result
      // A failed page must not be cached as the answer forever: drop it so the
      // next attempt refetches rather than replaying a transient network error.
      void result.catch(() => {
        if (entry.result === result) entry.result = undefined
      })
    }
    entries.delete(cursor)
    entries.set(cursor, entry)
    return entry.result
  }

  return { register, resolve }
}

const LIKE_ENDPOINT = {
  LIKE: '/like/like',
  DISLIKE: '/like/dislike',
  INDIFFERENT: '/like/removelike',
} as const satisfies Record<SourceLikeStatus, string>

// A write against a signed-out session comes back as an opaque innertube error,
// so it is refused up front with something the UI can act on.
const requireSignIn = (client: YoutubeClient, action: string) => {
  if (!client.session.logged_in) throw new Error(`youtube: sign in to ${action}`)
}

export const createYoutubeSource = ({ fetch, createClient, signedIn }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as Promise<YoutubeClient>
  const videoContinuations = createContinuations<SourceVideoPage>()
  const commentContinuations = createContinuations<SourceCommentPage>()
  const channels = new Map<string, SourceChannel>()

  const page = (kind: string, feed: Feed): SourceVideoPage => {
    const result: SourceVideoPage = { items: pageItems(feed) }
    if (feed.has_continuation) {
      result.cursor = videoContinuations.register(kind, async () => page(kind, await feed.getContinuation()))
    }
    return result
  }

  const commentPage = (videoId: string, comments: CommentsFeed): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: [...comments.contents].map(normalizeCommentThread).filter((comment) => comment !== undefined),
    }
    if (comments.has_continuation) {
      result.cursor = commentContinuations.register(
        `comments:${videoId}`,
        async () => commentPage(videoId, await comments.getContinuation()),
      )
    }
    return result
  }

  return {
    id: 'youtube',
    home: async (cursor) => cursor
      ? videoContinuations.resolve('home', cursor)
      : page('home', await (await client).getHomeFeed()),
    // The query is part of the kind so a cursor from one search cannot page
    // another one's results after the user types something new.
    search: async (query, cursor) => cursor
      ? videoContinuations.resolve(`search:${query}`, cursor)
      : page(`search:${query}`, await (await client).search(query)),
    video: async (id) => normalizeVideoDetails((await (await client).getBasicInfo(id)).basic_info),
    channel: async (id, cursor) => {
      let channel = channels.get(id)
      if (cursor) {
        if (!channel) throw new Error(`youtube: channel ${id} is not loaded`)
        return { channel, videos: await videoContinuations.resolve(`channel:${id}`, cursor) }
      }
      const result = await (await client).getChannel(id)
      channel = normalizeChannel(result, id)
      channels.set(id, channel)
      const videos = result.has_videos && result.getVideos ? await result.getVideos() : result
      return { channel, videos: page(`channel:${id}`, videos) }
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
      if (cursor) return commentContinuations.resolve(`comments:${videoId}`, cursor)
      try {
        return commentPage(videoId, await (await client).getComments(videoId))
      } catch (error) {
        // videos with comments turned off make youtubei.js throw
        // "Comments page did not have any content." — an expected state, not a failure.
        if (error instanceof Error && /did not have any content/i.test(error.message)) {
          return { items: [], disabled: true }
        }
        throw error
      }
    },
    // youtubei.js's InteractionManager issues like/dislike with client: 'TV',
    // but this frame pins a WEB session (a specific WEB clientVersion, a WEB
    // visitor id and a cookie jar bound to it), and a context swap mid-session
    // is exactly what has produced FAILED_PRECONDITION here before. The
    // endpoint is the same either way, so it is called directly on the WEB
    // client instead of through the manager.
    rateVideo: async (id, status) => {
      const active = await client
      requireSignIn(active, 'rate a video')
      await active.actions.execute(LIKE_ENDPOINT[status], { target: { videoId: id } })
      // Only identity and the changed field are real; `related` satisfies the
      // non-null list without being fetched back. See the Mutation comment in
      // src/worker/schema.gql.
      return { id, likeStatus: status, related: [] }
    },
    setSubscribed: async (channelId, subscribed) => {
      const active = await client
      requireSignIn(active, 'change a subscription')
      await (subscribed ? active.interact.subscribe(channelId) : active.interact.unsubscribe(channelId))
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known, id: channelId, name: known?.name ?? '', isSubscribed: subscribed }
      // Keep the cache honest so a later channel() read does not hand back the
      // pre-write state.
      if (known) channels.set(channelId, next)
      return next
    },
    setNotificationLevel: async (channelId, level) => {
      const active = await client
      requireSignIn(active, 'change notifications')
      await active.interact.setNotificationPreferences(channelId, level)
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known, id: channelId, name: known?.name ?? '', notificationLevel: level }
      if (known) channels.set(channelId, next)
      return next
    },
    // Signed-in state comes from the cookie jar probe; the accounts_list call
    // only decorates it, so its failure must not read back as signed out.
    session: async () => {
      if (!signedIn?.()) return { signedIn: false }
      try {
        return normalizeSession(await (await client).account.getInfo())
      } catch {
        return { signedIn: true }
      }
    },
  }
}
