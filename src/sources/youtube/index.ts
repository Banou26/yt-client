import type { Source, SourceChannel, SourceChannelPage, SourceChannelTab, SourceCommentPage, SourceLikeStatus, SourceLiveChatMessage, SourceLiveChatPage, SourceNotificationLevel, SourcePlaylist, SourcePlaylistItem, SourcePlaylistListPage, SourcePlaylistPage, SourcePlaylistPrivacy, SourceSearchFeature, SourceSearchFilters, SourceSearchPage, SourceSearchResult, SourceHomePage, SourceNotificationPage, SourcePostPage, SourceSectionedVideoPage, SourceShort, SourceShortsPage, SourceVideo, SourceVideoPage } from '../types'

import { Innertube } from 'youtubei.js/web'

import { normalizeChannel, normalizeCommentThread, normalizeCommentView, normalizeLiveChatMessage, normalizeFeedChannel, normalizeFeedVideo, normalizeGridPlaylist, normalizeLockupVideo, normalizeNotification, normalizePlaylistDetails, normalizePlaylistItem, normalizePlaylistLockup, normalizeChannelAbout, normalizeCommunityPost, normalizeSearchChannel, normalizeSession, normalizeShortsLockup, normalizeVideoDetails, normalizeWatchMeta } from './normalize'

type Feed = {
  videos: Iterable<unknown>
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<Feed>
}

type FilterChip = {
  title?: unknown
  is_selected?: boolean
  endpoint?: { payload?: { token?: string, params?: string } }
}

type HomeFeedResponse = Feed & {
  filter_chips?: FilterChip[]
  applyFilter?: (chip: FilterChip) => Promise<HomeFeedResponse>
}

type SectionedFeed = Feed & {
  sections?: { header?: { title?: unknown }, contents?: Iterable<unknown> }[]
  removeVideo?: (videoId: string, pagesToLoad?: number) => Promise<unknown>
}

type ChannelsFeed = {
  channels?: Iterable<unknown>
}

export type YoutubeSearchFilters = {
  upload_date?: string
  type?: string
  duration?: string
  prioritize?: string
  features?: string[]
}

type SearchFeed = Feed & {
  results?: Iterable<unknown>
  refinements?: string[]
  estimated_results?: number
}

type ChannelFeed = Feed & {
  metadata?: unknown
  has_home?: boolean
  has_videos?: boolean
  has_shorts?: boolean
  has_live_streams?: boolean
  has_releases?: boolean
  has_podcasts?: boolean
  has_courses?: boolean
  has_playlists?: boolean
  has_community?: boolean
  has_search?: boolean
  sort_filters?: string[]
  getHome?: () => Promise<ChannelFeed>
  getVideos?: () => Promise<ChannelFeed>
  getShorts?: () => Promise<ChannelFeed>
  getLiveStreams?: () => Promise<ChannelFeed>
  getReleases?: () => Promise<ChannelFeed>
  getPodcasts?: () => Promise<ChannelFeed>
  getCourses?: () => Promise<ChannelFeed>
  getPlaylists?: () => Promise<ChannelFeed>
  getCommunity?: () => Promise<ChannelFeed>
  getAbout?: () => Promise<unknown>
  has_about?: boolean
  applySort?: (sort: string) => Promise<ChannelFeed>
  search?: (query: string) => Promise<ChannelFeed>
}

type PostsFeed = Feed & {
  posts?: Iterable<unknown>
}

type ContinuationNode = {
  endpoint?: { call(actions: unknown, args: { parse: true }): Promise<unknown> }
  button?: { endpoint?: { call(actions: unknown, args: { parse: true }): Promise<unknown> } }
}

type CommentThreadNode = {
  comment_replies_data?: { contents?: Iterable<unknown> } | null
}

type EndpointNode = {
  call(actions: unknown, args?: Record<string, unknown>): Promise<unknown>
}

type CommentActionNode = {
  like_command?: EndpointNode
  dislike_command?: EndpointNode
  unlike_command?: EndpointNode
  undislike_command?: EndpointNode
  reply_command?: { dialog?: { reply_button?: { endpoint?: EndpointNode } } }
}

type WatchNextContainer = {
  contents_memo?: { get(type: string): unknown[] | undefined }
}

// A ContinuationItem hangs its next page off its own endpoint on the first hop and off a "Load more" button afterwards.
const findContinuation = (nodes: Iterable<unknown>): EndpointNode | undefined => {
  for (const node of nodes) {
    const item = node as ContinuationNode
    const endpoint = item?.button?.endpoint ?? item?.endpoint
    if (endpoint) return endpoint
  }
  return undefined
}

type ContinuationResponse = {
  on_response_received_endpoints_memo?: Map<string, unknown[]>
}

type ReelEntry = {
  payload?: {
    videoId?: string
    thumbnail?: { thumbnails?: { url?: string, width?: number, height?: number }[] }
    unserializedPrefetchData?: {
      playerResponse?: { videoDetails?: { title?: string } }
    }
  }
}

type ShortsSequence = {
  basic_info?: unknown
  watch_next_feed?: ReelEntry[]
  wn_has_continuation: boolean
  getWatchNextContinuation(): Promise<ShortsSequence>
}

const normalizeReelEntry = (entry: ReelEntry): SourceShort | undefined => {
  const id = entry?.payload?.videoId
  if (!id) return undefined
  const poster = [...(entry.payload?.thumbnail?.thumbnails ?? [])]
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
  return {
    id,
    poster,
    title: entry.payload?.unserializedPrefetchData?.playerResponse?.videoDetails?.title,
  }
}

type NotificationsFeed = {
  contents?: Iterable<unknown>
  getContinuation(): Promise<NotificationsFeed>
}

type CommentsFeed = {
  contents: Iterable<unknown>
  header?: { comments_count?: unknown, count?: unknown }
  has_continuation: boolean
  getContinuation(): Promise<CommentsFeed>
}

type PlaylistsFeed = {
  playlists?: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistsFeed>
}

type LiveChatEmitter = {
  on(event: 'chat-update', listener: (action: LiveChatAction) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'end', listener: () => void): void
  start(): void
  stop(): void
  sendMessage(text: string): Promise<unknown>
}

type LiveChatAction = {
  type?: string
  item?: unknown
  target_item_id?: string
}

type VideoInfoWithChat = {
  livechat?: unknown
  getLiveChat(): LiveChatEmitter
}

type PlaylistFeed = {
  info?: unknown
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistFeed>
}

// `browse/edit_playlist` forwards the array verbatim, so an action it does not know is silently ignored rather than rejected.
type PlaylistEditAction = {
  action: string
  addedVideoId?: string
  setVideoId?: string
  movedSetVideoIdPredecessor?: string
  playlistName?: string
  playlistDescription?: string
  playlistPrivacy?: SourcePlaylistPrivacy
}

type ApiResponse = {
  success?: boolean
  data?: { playlistId?: string }
}

export type YoutubeClient = {
  getHomeFeed(): Promise<HomeFeedResponse>
  getSubscriptionsFeed(): Promise<SectionedFeed>
  getHistory(): Promise<SectionedFeed>
  getChannelsFeed(): Promise<ChannelsFeed>
  search(query: string, filters?: YoutubeSearchFilters): Promise<SearchFeed>
  getSearchSuggestions(query: string, previousQuery?: string): Promise<string[]>
  getBasicInfo(id: string): Promise<{ basic_info?: unknown }>
  getShortsVideoInfo(id: string): Promise<ShortsSequence>
  getChannel(id: string): Promise<ChannelFeed>
  resolveURL(url: string): Promise<{ payload?: { browseId?: string } }>
  getInfo(id: string): Promise<VideoInfoWithChat>
  getComments(videoId: string, sortBy?: 'TOP_COMMENTS' | 'NEWEST_FIRST'): Promise<CommentsFeed>
  getNotifications(): Promise<NotificationsFeed>
  getUnseenNotificationsCount(): Promise<number>
  getPlaylists(): Promise<PlaylistsFeed>
  getPlaylist(id: string): Promise<PlaylistFeed>
  account: {
    getInfo(): Promise<unknown>
  }
  interact: {
    comment(videoId: string, text: string): Promise<unknown>
    subscribe(channelId: string): Promise<unknown>
    unsubscribe(channelId: string): Promise<unknown>
    setNotificationPreferences(channelId: string, type: SourceNotificationLevel): Promise<unknown>
  }
  session: {
    logged_in: boolean
  }
  actions: {
    // `playlistId` and `playlistIndex` are the keys /next actually reads: a raw `index` key would go out untouched and be ignored.
    execute(endpoint: '/next', args: { videoId: string, racyCheckOk: boolean, contentCheckOk: boolean, playlistId?: string, playlistIndex?: number, parse: true }): Promise<unknown>
    execute(endpoint: '/like/like' | '/like/dislike' | '/like/removelike', args: { target: { videoId: string } }): Promise<unknown>
    execute(endpoint: 'browse/edit_playlist', args: { playlistId: string, actions: PlaylistEditAction[] }): Promise<ApiResponse>
    execute(endpoint: 'playlist/create', args: { title: string, videoIds: string[], privacyStatus?: SourcePlaylistPrivacy, description?: string }): Promise<ApiResponse>
    execute(endpoint: 'playlist/delete', args: { playlistId: string }): Promise<ApiResponse>
  }
}

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
  signedIn?: () => boolean
}

const shortsItems = (feed: Feed) => {
  const seen = new Set<string>()
  const items: SourceVideo[] = []
  for (const node of feed.memo?.get('ShortsLockupView') ?? []) {
    const short = normalizeShortsLockup(node)
    if (short && !seen.has(short.id)) {
      seen.add(short.id)
      items.push(short)
    }
  }
  return items
}

/**
 * The videos on a page.
 *
 * `includeShorts` is false for a feed that renders its own Shorts shelf: the
 * home grid puts them in a carousel row, so leaving them in the flat list too
 * would show every short twice. A channel's Shorts TAB is the opposite case,
 * where the shorts are the grid.
 */
const pageItems = (feed: Feed, { includeShorts = true }: { includeShorts?: boolean } = {}) => {
  // The `videos` getter surfaces legacy Video/GridVideo nodes but NOT LockupView, and a modern feed MIXES the two: merging rather than either/or is essential.
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
  if (includeShorts) for (const short of shortsItems(feed)) add(short)
  return items
}

const pagePlaylists = (feed: Feed) => {
  const seen = new Set<string>()
  const playlists: SourcePlaylist[] = []
  const add = (playlist: SourcePlaylist | undefined) => {
    if (playlist && !seen.has(playlist.id)) {
      seen.add(playlist.id)
      playlists.push(playlist)
    }
  }
  for (const node of feed.memo?.get('LockupView') ?? []) add(normalizePlaylistLockup(node))
  for (const node of feed.memo?.get('GridPlaylist') ?? []) add(normalizeGridPlaylist(node))
  // Releases and Podcasts serve the legacy `Playlist` renderer, which declares the same fields as GridPlaylist and so needs no normalizer of its own.
  for (const node of feed.memo?.get('Playlist') ?? []) add(normalizeGridPlaylist(node))
  return playlists
}

const CONTINUATION_LIMIT = 64

const createContinuations = <Page>() => {
  type Entry = { kind: string, load: () => Promise<Page>, result?: Promise<Page> }
  const entries = new Map<string, Entry>()
  let cursorId = 0

  const register = (kind: string, load: () => Promise<Page>) => {
    const cursor = `youtube:${kind}:${++cursorId}`
    entries.set(cursor, { kind, load })
    // Insertion order is eviction order, and `resolve` re-inserts on read, so the cursors a user is actually paging through stay live.
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
      void result.catch(() => {
        if (entry.result === result) entry.result = undefined
      })
    }
    entries.delete(cursor)
    entries.set(cursor, entry)
    return entry.result
  }

  const kindOf = (cursor: string) => entries.get(cursor)?.kind

  return { register, resolve, kindOf }
}

// Comment actions are opaque protobuf endpoints minted per comment per session: there is no id or token that can be rebuilt from the comment id.
const ACTION_LIMIT = 256

type CommentActions = {
  like?: EndpointNode
  dislike?: EndpointNode
  unlike?: EndpointNode
  undislike?: EndpointNode
  reply?: EndpointNode
}

const createActionRegistry = () => {
  const entries = new Map<string, { commentId: string, actions: CommentActions }>()
  let actionId = 0

  const register = (commentId: string, actions: CommentActions) => {
    const token = `youtube:comment:${++actionId}`
    entries.set(token, { commentId, actions })
    while (entries.size > ACTION_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return token
  }

  const resolve = (token: string) => {
    const entry = entries.get(token)
    if (!entry) {
      throw new Error('youtube: this comment is no longer available, reload the page and try again')
    }
    entries.delete(token)
    entries.set(token, entry)
    return entry
  }

  return { register, resolve }
}

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  const node = value as { text?: string, toString?: () => string } | undefined
  if (node?.text) return node.text
  const stringified = node?.toString?.()
  return stringified && stringified !== 'N/A' ? stringified : undefined
}

const chipId = (chip: { endpoint?: { payload?: { token?: string, params?: string } } }) =>
  chip.endpoint?.payload?.token ?? chip.endpoint?.payload?.params

// removeVideo defaults to scanning a single page, so anything the user has scrolled past would report 'Unable to find video in watch history'.
const HISTORY_REMOVAL_PAGES = 10

// filter_chips THROWS when a feed carries no chip bar (and when it carries more than one), so it cannot be read with optional chaining.
const filterChipsOf = (feed: { filter_chips?: FilterChip[] }): FilterChip[] => {
  try {
    return feed.filter_chips ?? []
  } catch {
    return []
  }
}

const UPSTREAM_FEATURE = {
  HD: 'hd',
  SUBTITLES: 'subtitles',
  CREATIVE_COMMONS: 'creative_commons',
  THREE_D: '3d',
  LIVE: 'live',
  PURCHASED: 'purchased',
  FOUR_K: '4k',
  THREE_SIXTY: '360',
  LOCATION: 'location',
  HDR: 'hdr',
  VR180: 'vr180',
} as const satisfies Record<SourceSearchFeature, string>

const unlessAll = (value: string | undefined) =>
  value === undefined || value === 'ALL' ? undefined : value.toLowerCase()

const upstreamFilters = (filters: SourceSearchFilters | undefined): YoutubeSearchFilters | undefined => {
  if (!filters) return undefined
  const mapped: YoutubeSearchFilters = {
    upload_date: unlessAll(filters.uploadDate),
    type: unlessAll(filters.type),
    duration: unlessAll(filters.duration),
    prioritize: unlessAll(filters.sortBy),
    features: filters.features?.map((feature) => UPSTREAM_FEATURE[feature]),
  }
  return Object.values(mapped).some((value) => value !== undefined && value.length !== 0) ? mapped : undefined
}

const filterKey = (filters: SourceSearchFilters | undefined) =>
  [
    filters?.uploadDate ?? '',
    filters?.type ?? '',
    filters?.duration ?? '',
    filters?.sortBy ?? '',
    [...(filters?.features ?? [])].sort().join('+'),
  ].join('|')

// Upstream's display order, which is also the order the tab strip renders in.
const CHANNEL_TABS = [
  { tab: 'HOME', has: 'has_home', open: 'getHome' },
  { tab: 'VIDEOS', has: 'has_videos', open: 'getVideos' },
  { tab: 'SHORTS', has: 'has_shorts', open: 'getShorts' },
  { tab: 'LIVE', has: 'has_live_streams', open: 'getLiveStreams' },
  { tab: 'RELEASES', has: 'has_releases', open: 'getReleases' },
  { tab: 'PODCASTS', has: 'has_podcasts', open: 'getPodcasts' },
  { tab: 'COURSES', has: 'has_courses', open: 'getCourses' },
  { tab: 'PLAYLISTS', has: 'has_playlists', open: 'getPlaylists' },
  { tab: 'COMMUNITY', has: 'has_community', open: 'getCommunity' },
] as const satisfies readonly { tab: SourceChannelTab, has: keyof ChannelFeed, open: keyof ChannelFeed }[]

const availableChannelTabs = (feed: ChannelFeed): SourceChannelTab[] => {
  // Annotated rather than inferred: CHANNEL_TABS is narrower than the tab union, so an inferred element type rejects the two appended tabs. Do not drop the annotation.
  const tabs: SourceChannelTab[] = CHANNEL_TABS
    .filter((entry) => feed[entry.has] === true)
    .map((entry) => entry.tab)
  if (feed.has_about === true) tabs.push('ABOUT')
  if (feed.has_search === true) tabs.push('SEARCH')
  return tabs
}

const defaultChannelTab = (available: SourceChannelTab[]): SourceChannelTab =>
  available.find((tab) => tab === 'VIDEOS') ?? available[0] ?? 'HOME'

const openChannelTab = async (
  feed: ChannelFeed,
  tab: SourceChannelTab,
  query: string | undefined,
): Promise<ChannelFeed> => {
  if (tab === 'ABOUT') return feed
  if (tab === 'SEARCH') {
    if (!query || !feed.search) return feed
    return feed.search(query)
  }
  const entry = CHANNEL_TABS.find((candidate) => candidate.tab === tab)
  const open = entry && feed[entry.open]
  if (typeof open !== 'function') return feed
  // `.call(feed)` rather than `open()`: every one of these is a prototype method that reaches for `this.getTabByURL`.
  return (open as (this: ChannelFeed) => Promise<ChannelFeed>).call(feed)
}

const LIKE_ENDPOINT = {
  LIKE: '/like/like',
  DISLIKE: '/like/dislike',
  INDIFFERENT: '/like/removelike',
} as const satisfies Record<SourceLikeStatus, string>

const requireSignIn = (client: YoutubeClient, action: string) => {
  if (!client.session.logged_in) throw new Error(`youtube: sign in to ${action}`)
}

export const createYoutubeSource = ({ fetch, createClient, signedIn }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as unknown as Promise<YoutubeClient>
  const videoContinuations = createContinuations<SourceVideoPage>()
  const sectionContinuations = createContinuations<SourceSectionedVideoPage>()
  const commentContinuations = createContinuations<SourceCommentPage>()
  const playlistContinuations = createContinuations<SourcePlaylistPage>()
  const playlistListContinuations = createContinuations<SourcePlaylistListPage>()
  const searchContinuations = createContinuations<SourceSearchPage>()
  const homeContinuations = createContinuations<SourceHomePage>()
  const shortsContinuations = createContinuations<SourceShortsPage>()
  const postContinuations = createContinuations<SourcePostPage>()
  const commentActions = createActionRegistry()
  const notificationContinuations = createContinuations<SourceNotificationPage>()
  const liveChatContinuations = createContinuations<SourceLiveChatPage>()

  type LiveChatSession = {
    chat: LiveChatEmitter
    buffer: SourceLiveChatMessage[]
    removed: string[]
    ended: boolean
    failure?: Error
    lastReadAt: number
    wake: () => void
    arrived: Promise<void>
  }
  const liveChatSessions = new Map<string, LiveChatSession>()

  // A ceiling so the request never looks hung upstream and the UI gets a heartbeat.
  const LIVE_CHAT_WAIT_MS = 6_000
  // The FIRST call waits only briefly: the emitter's opening fetch usually carries the backlog, but a quiet chat has nothing to catch and the full wait would hold the panel blank for six seconds.
  const LIVE_CHAT_OPEN_GRACE_MS = 1_000
  const LIVE_CHAT_IDLE_MS = 60_000
  const LIVE_CHAT_BUFFER_LIMIT = 300

  const closeLiveChat = (videoId: string) => {
    const session = liveChatSessions.get(videoId)
    if (!session) return
    liveChatSessions.delete(videoId)
    session.ended = true
    try {
      session.chat.stop()
    } catch {}
    session.wake()
  }

  const armLiveChatWake = (session: LiveChatSession) => {
    session.arrived = new Promise<void>((resolve) => {
      session.wake = resolve
    })
  }

  const openLiveChat = async (videoId: string) => {
    const existing = liveChatSessions.get(videoId)
    if (existing) return existing
    // getInfo(), never getBasicInfo(): live chat hangs off the /next half of the response and getBasicInfo only issues /player, so its result carries no `livechat` and getLiveChat() throws on it.
    const info = await (await client).getInfo(videoId)
    // getLiveChat() THROWS when the video carries no chat, so absence is checked rather than caught.
    if (!info.livechat) return undefined
    const session: LiveChatSession = {
      chat: info.getLiveChat(),
      buffer: [],
      removed: [],
      ended: false,
      lastReadAt: Date.now(),
      wake: () => {},
      arrived: Promise.resolve(),
    }
    armLiveChatWake(session)
    const push = (action: LiveChatAction) => {
      if (action.target_item_id) {
        session.removed.push(action.target_item_id)
      } else if (action.item) {
        const message = normalizeLiveChatMessage(action.item)
        if (!message) return
        session.buffer.push(message)
        if (session.buffer.length > LIVE_CHAT_BUFFER_LIMIT) {
          session.buffer.splice(0, session.buffer.length - LIVE_CHAT_BUFFER_LIMIT)
        }
      } else return
      session.wake()
    }
    session.chat.on('chat-update', push)
    session.chat.on('error', (error) => {
      session.failure = error
      session.wake()
    })
    session.chat.on('end', () => {
      session.ended = true
      session.wake()
    })
    liveChatSessions.set(videoId, session)
    session.chat.start()
    return session
  }

  const drainLiveChat = (videoId: string, session: LiveChatSession): SourceLiveChatPage => {
    session.lastReadAt = Date.now()
    const items = session.buffer.splice(0, session.buffer.length)
    const removedIds = session.removed.splice(0, session.removed.length)
    const page: SourceLiveChatPage = { items }
    if (removedIds.length) page.removedIds = removedIds
    // No cursor once the stream is over: that is what stops the client polling.
    if (session.ended) {
      closeLiveChat(videoId)
      return page
    }
    const kind = `livechat:${videoId}`
    page.cursor = liveChatContinuations.register(kind, async () => {
      const current = liveChatSessions.get(videoId)
      if (!current) {
        const reopened = await openLiveChat(videoId)
        if (!reopened) return { items: [], disabled: true }
        return drainLiveChat(videoId, reopened)
      }
      if (!current.buffer.length && !current.removed.length && !current.ended) {
        const waited = current.arrived
        armLiveChatWake(current)
        await Promise.race([waited, new Promise((resolve) => setTimeout(resolve, LIVE_CHAT_WAIT_MS))])
      }
      if (current.failure) {
        const failure = current.failure
        current.failure = undefined
        throw failure
      }
      return drainLiveChat(videoId, current)
    })
    return page
  }

  const reapIdleLiveChats = (keep: string) => {
    const now = Date.now()
    for (const [videoId, session] of liveChatSessions) {
      if (videoId !== keep && now - session.lastReadAt > LIVE_CHAT_IDLE_MS) closeLiveChat(videoId)
    }
  }
  // Short-lived rather than permanent: the header carries subscribe state, and a channel pinned for the session would keep serving the pre-write value.
  // Memoizes one browse per channel: every tab switch used to re-browse it, with About and Community each browsing a SECOND time, and that burst of overlapping POSTs to /browse is what surfaced as an intermittent 405 from the endpoint.
  const CHANNEL_TTL_MS = 60_000
  const channelFetches = new Map<string, { at: number, result: Promise<ChannelFeed> }>()

  const resolveHandle = async (handle: string) => {
    const endpoint = await (await client)
      .resolveURL(`https://www.youtube.com/${handle}`)
      .catch(() => { throw new Error(`youtube: no channel with the handle ${handle}`) })
    const browseId = (endpoint as { payload?: { browseId?: string } }).payload?.browseId
    if (!browseId) throw new Error(`youtube: ${handle} does not resolve to a channel`)
    return browseId
  }

  const fetchChannel = async (id: string) => {
    const cached = channelFetches.get(id)
    if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached.result
    const result = id.startsWith('@')
      ? resolveHandle(id).then((browseId) => (client).then((active) => active.getChannel(browseId)))
      : (await client).getChannel(id)
    channelFetches.set(id, { at: Date.now(), result })
    void result.catch(() => {
      if (channelFetches.get(id)?.result === result) channelFetches.delete(id)
    })
    return result
  }
  const channels = new Map<string, {
    channel: SourceChannel
    page: Omit<SourceChannelPage, 'channel' | 'videos'>
  }>()
  const knownPlaylists = new Map<string, SourcePlaylist>()

  const homePage = (kind: string, feed: Feed): SourceHomePage => {
    const result: SourceHomePage = {
      items: pageItems(feed, { includeShorts: false }),
      shorts: shortsItems(feed),
    }
    if (feed.has_continuation) {
      result.cursor = homeContinuations.register(kind, async () => homePage(kind, await feed.getContinuation()))
    }
    return result
  }

  const page = (kind: string, feed: Feed): SourceVideoPage => {
    const result: SourceVideoPage = { items: pageItems(feed), playlists: pagePlaylists(feed) }
    if (feed.has_continuation) {
      result.cursor = videoContinuations.register(kind, async () => page(kind, await feed.getContinuation()))
    }
    return result
  }

  // Search rows are read off `results` rather than the `videos` getter, which emits only videos and would drop channel and playlist hits.
  const searchPage = (kind: string, feed: SearchFeed): SourceSearchPage => {
    const results: SourceSearchResult[] = []
    const seen = new Set<string>()
    for (const node of feed.results ?? []) {
      const video = normalizeFeedVideo(node) ?? normalizeLockupVideo(node)
      if (video) {
        if (seen.has(`video:${video.id}`)) continue
        seen.add(`video:${video.id}`)
        results.push({ ...video, kind: 'video' })
        continue
      }
      const playlist = normalizePlaylistLockup(node) ?? normalizeGridPlaylist(node)
      if (playlist) {
        if (seen.has(`playlist:${playlist.id}`)) continue
        seen.add(`playlist:${playlist.id}`)
        results.push({ ...playlist, kind: 'playlist' })
        continue
      }
      const channel = normalizeSearchChannel(node)
      if (channel && !seen.has(`channel:${channel.id}`)) {
        seen.add(`channel:${channel.id}`)
        results.push({ ...channel, kind: 'channel' })
      }
    }
    const result: SourceSearchPage = {
      results,
      refinements: feed.refinements ?? [],
      estimatedResults: feed.estimated_results,
    }
    if (feed.has_continuation) {
      result.cursor = searchContinuations.register(
        kind,
        async () => searchPage(kind, await feed.getContinuation() as SearchFeed),
      )
    }
    return result
  }

  const notificationClicks = new Map<string, EndpointNode>()

  const notificationPage = (feed: NotificationsFeed): SourceNotificationPage => {
    const items = [...(feed.contents ?? [])].flatMap((node) => {
      const notification = normalizeNotification(node)
      if (!notification) return []
      const click = (node as { record_click_endpoint?: EndpointNode }).record_click_endpoint
      if (click) notificationClicks.set(notification.id, click)
      return [notification]
    })
    const result: SourceNotificationPage = { items }
    // No has_continuation on this menu, so the cursor is minted unconditionally and an exhausted one simply comes back empty.
    if (items.length > 0) {
      result.cursor = notificationContinuations.register(
        'notifications',
        async () => notificationPage(await feed.getContinuation()),
      )
    }
    return result
  }

  const relatedPage = (kind: string, memo: Map<string, unknown[]> | undefined): SourceVideoPage => {
    const seen = new Set<string>()
    const items: SourceVideo[] = []
    const add = (video: SourceVideo | undefined) => {
      if (video && !seen.has(video.id)) {
        seen.add(video.id)
        items.push(video)
      }
    }
    for (const node of memo?.get('CompactVideo') ?? []) add(normalizeFeedVideo(node))
    for (const node of memo?.get('LockupView') ?? []) add(normalizeLockupVideo(node))
    const result: SourceVideoPage = { items, playlists: [] }
    const next = findContinuation(memo?.get('ContinuationItem') ?? [])
    if (next) result.cursor = registerRelated(kind.replace(/^related:/, ''), next)
    return result
  }

  // The reel sequence PAGES BY MUTATION: getWatchNextContinuation() overwrites watch_next_feed on the same object and returns `this`.
  const shortsPage = (info: ShortsSequence, seed?: SourceShort): SourceShortsPage => {
    const seen = new Set<string>()
    const items: SourceShort[] = []
    const add = (short: SourceShort | undefined) => {
      if (short && !seen.has(short.id)) {
        seen.add(short.id)
        items.push(short)
      }
    }
    // The seed's still comes off basic_info, the 16:9 letterboxed frame; when the sequence also lists the seed it carries the true portrait frame.
    const own = (info.watch_next_feed ?? []).find((entry) => entry.payload?.videoId === seed?.id)
    add(seed && { ...seed, poster: normalizeReelEntry(own ?? {})?.poster ?? seed.poster })
    for (const entry of info.watch_next_feed ?? []) add(normalizeReelEntry(entry))
    const result: SourceShortsPage = { items }
    if (info.wn_has_continuation) {
      result.cursor = shortsContinuations.register('shorts', async () => {
        return shortsPage(await info.getWatchNextContinuation())
      })
    }
    return result
  }

  // An anonymous home carries no shorts, which is why an anonymous Shorts feed is legitimately empty rather than broken.
  const seedShort = async (active: YoutubeClient) => {
    if (!active.session.logged_in) return undefined
    const feed = await active.getHomeFeed()
    return shortsItems(feed)[0]?.id
  }

  const registerRelated = (videoId: string, endpoint: EndpointNode): string => {
    const kind = `related:${videoId}`
    return videoContinuations.register(kind, async () => {
      const response = await endpoint.call((await client).actions, { parse: true }) as ContinuationResponse
      return relatedPage(kind, response.on_response_received_endpoints_memo)
    })
  }

  const postPage = (kind: string, feed: PostsFeed): SourcePostPage => {
    const result: SourcePostPage = {
      items: [...(feed.posts ?? [])].map(normalizeCommunityPost).filter((post) => post !== undefined),
    }
    if (feed.has_continuation) {
      result.cursor = postContinuations.register(
        kind,
        async () => postPage(kind, await feed.getContinuation() as PostsFeed),
      )
    }
    return result
  }

  const sectionedPage = (kind: string, feed: SectionedFeed): SourceSectionedVideoPage => {
    const sections = (feed.sections ?? []).flatMap((section) => {
      const items = [...(section.contents ?? [])]
        .map((node) => normalizeFeedVideo(node) ?? normalizeLockupVideo(node))
        .filter((video) => video !== undefined)
      if (items.length === 0) return []
      return [{ title: text(section.header?.title), items }]
    })
    const result: SourceSectionedVideoPage = {
      sections: sections.length > 0 ? sections : [{ items: pageItems(feed) }],
    }
    if (feed.has_continuation) {
      result.cursor = sectionContinuations.register(
        kind,
        async () => sectionedPage(kind, await feed.getContinuation() as SectionedFeed),
      )
    }
    return result
  }

  const actionsToken = (node: unknown, commentId: string) => {
    const commands = node as CommentActionNode | undefined
    const actions: CommentActions = {
      like: commands?.like_command,
      dislike: commands?.dislike_command,
      unlike: commands?.unlike_command,
      undislike: commands?.undislike_command,
      // Resolved through the reply command's DIALOG, mirroring CommentView.reply(): the command endpoint alone opens a dialog instead of posting.
      reply: commands?.reply_command?.dialog?.reply_button?.endpoint,
    }
    if (!actions.like && !actions.dislike && !actions.reply) return undefined
    return commentActions.register(commentId, actions)
  }

  const repliesPage = (kind: string, memo: Map<string, unknown[]> | undefined): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: (memo?.get('CommentView') ?? []).flatMap((node) => {
        const comment = normalizeCommentView(node)
        return comment ? [{ ...comment, actionsToken: actionsToken(node, comment.id) }] : []
      }),
    }
    const next = (memo?.get('ContinuationItem') ?? [])[0] as ContinuationNode | undefined
    const button = next?.button?.endpoint ?? next?.endpoint
    if (button) {
      result.cursor = commentContinuations.register(kind, async () => {
        const response = await button.call((await client).actions, { parse: true }) as ContinuationResponse
        return repliesPage(kind, response.on_response_received_endpoints_memo)
      })
    }
    return result
  }

  const commentPage = (kind: string, comments: CommentsFeed): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: [...comments.contents].flatMap((node) => {
        const comment = normalizeCommentThread(node)
        if (!comment) return []
        const thread = node as CommentThreadNode
        const continuation = [...(thread.comment_replies_data?.contents ?? [])]
          .find((item) => (item as ContinuationNode).endpoint !== undefined) as ContinuationNode | undefined
        const token = actionsToken((node as { comment?: unknown }).comment, comment.id)
        if (!continuation?.endpoint) return [{ ...comment, actionsToken: token }]
        const repliesKind = `replies:${comment.id}`
        const endpoint = continuation.endpoint
        return [{
          ...comment,
          actionsToken: token,
          repliesCursor: commentContinuations.register(repliesKind, async () => {
            const response = await endpoint.call((await client).actions, { parse: true }) as ContinuationResponse
            return repliesPage(repliesKind, response.on_response_received_endpoints_memo)
          }),
        }]
      }),
      countText: text(comments.header?.comments_count) ?? text(comments.header?.count),
    }
    if (comments.has_continuation) {
      result.cursor = commentContinuations.register(
        kind,
        async () => commentPage(kind, await comments.getContinuation()),
      )
    }
    return result
  }

  // The `items` getter casts the page's whole video set in one go and throws on anything outside its union; PlaylistVideo is the one renderer carrying set_video_id.
  const playlistItems = (feed: PlaylistFeed) =>
    (feed.memo?.get('PlaylistVideo') ?? [])
      .map(normalizePlaylistItem)
      .filter((item) => item !== undefined)

  // The playlist entity is threaded through every page rather than re-read: a continuation response carries no header and no sidebar.
  const playlistPage = (id: string, playlist: SourcePlaylist, feed: PlaylistFeed, items: SourcePlaylistItem[]): SourcePlaylistPage => {
    const result: SourcePlaylistPage = { playlist, items }
    if (feed.has_continuation) {
      result.cursor = playlistContinuations.register(`playlist:${id}`, async () => {
        const next = await feed.getContinuation()
        return playlistPage(id, playlist, next, playlistItems(next))
      })
    }
    return result
  }

  const rememberPlaylist = (playlist: SourcePlaylist) => {
    knownPlaylists.set(playlist.id, playlist)
    return playlist
  }

  // Only the changed fields are real; none of the edit endpoints hands back a parseable playlist.
  const writtenPlaylist = (id: string, changed: Partial<SourcePlaylist>): SourcePlaylist => {
    const known = knownPlaylists.get(id)
    // `title: known?.title ?? ''` mirrors how setSubscribed fills Channel.name: the schema forbids null there, and the mutation document is not supposed to select it unless the write set it.
    const next: SourcePlaylist = { ...known, id, title: known?.title ?? '', ...changed }
    // Guarded deliberately: a write must not mint a stub that a later read of the library would then be merged into.
    if (known) knownPlaylists.set(id, next)
    return next
  }

  // youtubei.js's PlaylistManager wrappers pay a browse to translate video ids into set video ids, and one of them ships a broken body, so the endpoint is called directly.
  const editPlaylist = async (id: string, reason: string, actions: PlaylistEditAction[]) => {
    const active = await client
    requireSignIn(active, reason)
    await active.actions.execute('browse/edit_playlist', { playlistId: id, actions })
  }

  const playlistListPage = (feed: PlaylistsFeed): SourcePlaylistListPage => {
    const result: SourcePlaylistListPage = {
      items: [...(feed.playlists ?? [])]
        .map((node) => normalizePlaylistLockup(node) ?? normalizeGridPlaylist(node))
        .filter((playlist) => playlist !== undefined)
        .map(rememberPlaylist),
    }
    if (feed.has_continuation) {
      result.cursor = playlistListContinuations.register(
        'playlists',
        async () => playlistListPage(await feed.getContinuation()),
      )
    }
    return result
  }

  return {
    id: 'youtube',
    home: async (chip, cursor) => {
      const kind = chip ? `home:${chip}` : 'home'
      if (cursor) {
        const next = await homeContinuations.resolve(kind, cursor)
        return { items: next.items, shorts: next.shorts, chips: [], cursor: next.cursor }
      }
      const feed = await (await client).getHomeFeed()
      const chips = filterChipsOf(feed)
      const filter = chip ? chips.find((candidate) => chipId(candidate) === chip) : undefined
      const filtered = filter && feed.applyFilter ? await feed.applyFilter(filter) : feed
      const result = homePage(kind, filtered)
      return {
        items: result.items,
        shorts: result.shorts,
        // Chips come from the unfiltered response: the filtered one echoes back a reduced set that would make the rail collapse after one click.
        chips: chips.flatMap((candidate) => {
          const id = chipId(candidate)
          const label = text(candidate.title)
          if (!id || !label) return []
          return [{ id, label, selected: candidate.is_selected === true || id === chip }]
        }),
        cursor: result.cursor,
      }
    },
    // Playback is deliberately NOT taken from the sequence even though it prefetches a player response: that would trade a proven path for a preview-tier one.
    shorts: async (seed, cursor) => {
      if (cursor) return shortsContinuations.resolve('shorts', cursor)
      const active = await client
      const from = seed ?? await seedShort(active)
      if (!from) return { items: [] }
      const info = await active.getShortsVideoInfo(from)
      const details = (info.basic_info ?? {}) as { id?: string, title?: string, thumbnail?: { url?: string, width?: number }[] }
      const seeded: SourceShort | undefined = details.id
        ? {
            id: details.id,
            title: details.title,
            poster: [...(details.thumbnail ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
          }
        : undefined
      return shortsPage(info, seeded)
    },
    subscriptions: async (cursor) => {
      if (cursor) return videoContinuations.resolve('subscriptions', cursor)
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      return page('subscriptions', await active.getSubscriptionsFeed())
    },
    history: async (cursor) => {
      if (cursor) return sectionContinuations.resolve('history', cursor)
      const active = await client
      requireSignIn(active, 'see your history')
      return sectionedPage('history', await active.getHistory())
    },
    subscribedChannels: async () => {
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      const feed = await active.getChannelsFeed()
      return [...(feed.channels ?? [])]
        .map(normalizeFeedChannel)
        .filter((channel) => channel !== undefined)
    },
    search: async (query, filters, cursor) => {
      const kind = `search:${query}:${filterKey(filters)}`
      if (cursor) return searchContinuations.resolve(kind, cursor)
      return searchPage(kind, await (await client).search(query, upstreamFilters(filters)))
    },
    searchSuggestions: async (query, previousQuery) => {
      if (query.trim() === '') return []
      try {
        return await (await client).getSearchSuggestions(query, previousQuery)
      } catch {
        return []
      }
    },
    video: async (id) => normalizeVideoDetails((await (await client).getBasicInfo(id)).basic_info),
    channel: async (id, tab, sort, query, cursor) => {
      const kind = `channel:${id}:${tab ?? 'DEFAULT'}:${sort ?? ''}:${query ?? ''}`
      const known = channels.get(id)
      if (cursor) {
        if (!known) throw new Error(`youtube: channel ${id} is not loaded`)
        return {
          ...known.page,
          channel: known.channel,
          videos: await videoContinuations.resolve(kind, cursor),
        }
      }
      const result = await fetchChannel(id)
      const channel = normalizeChannel(result, id)
      const availableTabs = availableChannelTabs(result)
      const selected = tab && availableTabs.includes(tab) ? tab : defaultChannelTab(availableTabs)
      let feed = await openChannelTab(result, selected, query)
      const sortOptions = feed.sort_filters ?? []
      const appliedSort = sort && sortOptions.includes(sort) ? sort : undefined
      if (appliedSort && feed.applySort) feed = await feed.applySort(appliedSort)
      const rest = { availableTabs, tab: selected, sortOptions, appliedSort }
      channels.set(id, { channel, page: rest })
      return { ...rest, channel, videos: page(kind, feed) }
    },
    channelAbout: async (id) => {
      const result = await fetchChannel(id)
      if (result.has_about !== true || !result.getAbout) return undefined
      return normalizeChannelAbout(await result.getAbout.call(result))
    },
    communityPosts: async (channelId, cursor) => {
      const kind = `community:${channelId}`
      if (cursor) return postContinuations.resolve(kind, cursor)
      const result = await fetchChannel(channelId)
      if (result.has_community !== true || !result.getCommunity) return { items: [] }
      return postPage(kind, await result.getCommunity.call(result) as PostsFeed)
    },
    watch: async (id, playlistId, playlistIndex) => {
      const response = await (await client).actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        // Omitted rather than sent as undefined: a 0 index is meaningful and must survive.
        ...(playlistId ? { playlistId } : {}),
        ...(playlistIndex === undefined ? {} : { playlistIndex }),
        parse: true,
      })
      const meta = normalizeWatchMeta(response, id)
      if (!meta) return undefined
      // Read off secondary_results rather than the memo, which also holds the comments entry's ContinuationItem.
      const watchNext = (response as WatchNextContainer).contents_memo?.get('TwoColumnWatchNextResults')?.[0]
      const secondary = (watchNext as { secondary_results?: unknown[] } | undefined)?.secondary_results ?? []
      const nested = secondary.flatMap((node) => [...((node as { contents?: unknown[] })?.contents ?? [])])
      const continuation = findContinuation([...secondary, ...nested])
      if (!continuation) return meta
      return { ...meta, relatedCursor: registerRelated(id, continuation) }
    },
    relatedVideos: async (cursor) => {
      const kind = videoContinuations.kindOf(cursor)
      if (kind !== undefined && !kind.startsWith('related:')) {
        throw new Error(`youtube: continuation ${cursor} belongs to ${kind}, not a watch sidebar`)
      }
      return videoContinuations.resolve(kind ?? 'related:unknown', cursor)
    },
    commentReplies: async (cursor) => {
      const kind = commentContinuations.kindOf(cursor)
      if (kind !== undefined && !kind.startsWith('replies:')) {
        throw new Error(`youtube: continuation ${cursor} belongs to ${kind}, not a reply thread`)
      }
      return commentContinuations.resolve(kind ?? 'replies:unknown', cursor)
    },
    comments: async (videoId, sort, cursor) => {
      const kind = `comments:${videoId}:${sort ?? 'TOP'}`
      if (cursor) return commentContinuations.resolve(kind, cursor)
      try {
        const upstreamSort = sort === 'NEWEST' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'
        return commentPage(kind, await (await client).getComments(videoId, upstreamSort))
      } catch (error) {
        if (error instanceof Error && /did not have any content/i.test(error.message)) {
          return { items: [], disabled: true }
        }
        throw error
      }
    },
    playlists: async (cursor) => {
      if (cursor) return playlistListContinuations.resolve('playlists', cursor)
      const active = await client
      requireSignIn(active, 'see your playlists')
      return playlistListPage(await active.getPlaylists())
    },
    // Deliberately not sign-in gated: a public playlist opens signed out.
    playlist: async (id, cursor) => {
      if (cursor) return playlistContinuations.resolve(`playlist:${id}`, cursor)
      const feed = await (await client).getPlaylist(id)
      const items = playlistItems(feed)
      const details = normalizePlaylistDetails(feed, id)
      // The cover has to be resolved before the continuation closure captures the playlist: page two would otherwise hand back the same entity with its cover cleared.
      const playlist = rememberPlaylist({ ...details, thumbnail: details.thumbnail ?? items[0]?.video.thumbnail })
      return playlistPage(id, playlist, feed, items)
    },
    // youtubei.js's InteractionManager issues like/dislike with client: 'TV', but this frame pins a WEB session, and a context swap mid-session produces FAILED_PRECONDITION.
    rateVideo: async (id, status) => {
      const active = await client
      requireSignIn(active, 'rate a video')
      await active.actions.execute(LIKE_ENDPOINT[status], { target: { videoId: id } })
      return { id, likeStatus: status, related: [], descriptionRuns: [] }
    },
    removeFromHistory: async (videoId) => {
      const active = await client
      requireSignIn(active, 'change your history')
      // A FRESH feed every time: removeVideo replaces its instance's contents when it has to page forward.
      const history = await active.getHistory()
      if (!history.removeVideo) throw new Error('youtube: this history feed cannot be edited')
      await history.removeVideo(videoId, HISTORY_REMOVAL_PAGES)
      return videoId
    },
    liveChat: async (videoId, cursor) => {
      reapIdleLiveChats(videoId)
      if (cursor) return liveChatContinuations.resolve(`livechat:${videoId}`, cursor)
      const session = await openLiveChat(videoId)
      if (!session) return { items: [], disabled: true }
      if (!session.buffer.length && !session.ended) {
        const waited = session.arrived
        armLiveChatWake(session)
        await Promise.race([waited, new Promise((resolve) => setTimeout(resolve, LIVE_CHAT_OPEN_GRACE_MS))])
      }
      return drainLiveChat(videoId, session)
    },

    sendLiveChatMessage: async (videoId, textBody) => {
      const active = await client
      requireSignIn(active, 'send a live chat message')
      const session = liveChatSessions.get(videoId)
      if (!session) throw new Error('youtube: live chat is not open for this video')
      await session.chat.sendMessage(textBody)
      return true
    },

    postComment: async (videoId, textBody) => {
      const active = await client
      requireSignIn(active, 'post a comment')
      await active.interact.comment(videoId, textBody)
      return true
    },
    replyToComment: async (token, textBody) => {
      const active = await client
      requireSignIn(active, 'reply to a comment')
      const { actions } = commentActions.resolve(token)
      if (!actions.reply) throw new Error('youtube: replies are turned off for this comment')
      // `commentText` is the key the reply button's endpoint reads.
      await actions.reply.call(active.actions, { commentText: textBody })
      return true
    },
    rateComment: async (token, status) => {
      const active = await client
      requireSignIn(active, 'rate a comment')
      const { commentId, actions } = commentActions.resolve(token)
      const endpoint = status === 'LIKE'
        ? actions.like
        : status === 'DISLIKE'
          ? actions.dislike
          : actions.unlike ?? actions.undislike
      if (!endpoint) throw new Error('youtube: this comment cannot be rated')
      await endpoint.call(active.actions)
      return {
        id: commentId,
        text: '',
        runs: [],
        isLiked: status === 'LIKE' ? true : undefined,
        isDisliked: status === 'DISLIKE' ? true : undefined,
      }
    },
    setSubscribed: async (channelId, subscribed) => {
      const active = await client
      requireSignIn(active, 'change a subscription')
      await (subscribed ? active.interact.subscribe(channelId) : active.interact.unsubscribe(channelId))
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known?.channel, id: channelId, name: known?.channel.name ?? '', isSubscribed: subscribed }
      if (known) channels.set(channelId, { ...known, channel: next })
      return next
    },
    setNotificationLevel: async (channelId, level) => {
      const active = await client
      requireSignIn(active, 'change notifications')
      await active.interact.setNotificationPreferences(channelId, level)
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known?.channel, id: channelId, name: known?.channel.name ?? '', notificationLevel: level }
      if (known) channels.set(channelId, { ...known, channel: next })
      return next
    },
    addToPlaylist: async (playlistId, videoIds) => {
      if (videoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'save to a playlist', videoIds.map((videoId) => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: videoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // Takes setVideoIds rather than video ids because youtubei.js's removeVideos translates video ids by browsing and paging until it has matched as many rows as ids given: an id not in the playlist makes it walk every page then throw, and a single Shorts lockup on any page throws a ParsingError before the edit is attempted (core/managers/PlaylistManager.js:123).
    removeFromPlaylist: async (playlistId, setVideoIds) => {
      if (setVideoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'change a playlist', setVideoIds.map((setVideoId) => ({
        action: 'ACTION_REMOVE_VIDEO',
        setVideoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // youtubei.js's create() can only send a title and video ids, but the endpoint it calls copies privacyStatus and description too.
    createPlaylist: async (title, videoIds, privacy, description) => {
      const active = await client
      requireSignIn(active, 'create a playlist')
      const response = await active.actions.execute('playlist/create', {
        title,
        videoIds: videoIds ?? [],
        ...(privacy ? { privacyStatus: privacy } : {}),
        ...(description ? { description } : {}),
      })
      if (response.success === false) throw new Error('youtube: creating the playlist failed')
      const id = response.data?.playlistId
      if (!id) throw new Error('youtube: the playlist was created but its id did not come back')
      return rememberPlaylist({ id, title, description, privacy })
    },
    // Calls the endpoint path directly, and must not switch back to the manager: youtubei.js's delete() throws before the network, building the raw key `deletePlaylistServiceEndpoint` (core/managers/PlaylistManager.js:40) that parser/nodes.js registers no class for, while the registered DeletePlaylistEndpoint guards on `playlistId` but assigns from `sourcePlaylistId` (parser/classes/endpoints/DeletePlaylistEndpoint.js:15) and so emits a body only when both keys are passed.
    deletePlaylist: async (id) => {
      const active = await client
      requireSignIn(active, 'delete a playlist')
      await active.actions.execute('playlist/delete', { playlistId: id })
      knownPlaylists.delete(id)
      return id
    },
    // Goes through browse/edit_playlist directly because youtubei.js's setName builds `{ playlist_id, actions }` in snake_case (core/managers/PlaylistManager.js:200, the only snake_case payload in that manager) while PlaylistEditEndpoint copies only `actions`, `playlistId` and `params` (parser/classes/endpoints/PlaylistEditEndpoint.js:13), so the id is dropped and the POST says which name to set but not on what.
    renamePlaylist: async (id, title) => {
      await editPlaylist(id, 'rename a playlist', [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: title }])
      return writtenPlaylist(id, { title })
    },
    setPlaylistDescription: async (id, description) => {
      await editPlaylist(id, 'change a playlist description', [{
        action: 'ACTION_SET_PLAYLIST_DESCRIPTION',
        playlistDescription: description,
      }])
      return writtenPlaylist(id, { description })
    },
    // The one action name here that youtubei.js 17.0.1 does not attest: the package has no privacy edit path at all.
    setPlaylistPrivacy: async (id, privacy) => {
      await editPlaylist(id, 'change a playlist privacy', [{
        action: 'ACTION_SET_PLAYLIST_PRIVACY',
        playlistPrivacy: privacy,
      }])
      return writtenPlaylist(id, { privacy })
    },
    // The destination is a predecessor, not an index: the moved entry lands immediately AFTER `afterSetVideoId`, and omitting it asks for the first position.
    movePlaylistItem: async (playlistId, setVideoId, afterSetVideoId) => {
      await editPlaylist(playlistId, 'reorder a playlist', [{
        action: 'ACTION_MOVE_VIDEO_AFTER',
        setVideoId,
        ...(afterSetVideoId ? { movedSetVideoIdPredecessor: afterSetVideoId } : {}),
      }])
      return writtenPlaylist(playlistId, {})
    },
    notifications: async (cursor) => {
      if (cursor) return notificationContinuations.resolve('notifications', cursor)
      const active = await client
      requireSignIn(active, 'see your notifications')
      return notificationPage(await active.getNotifications())
    },
    unseenNotificationCount: async () => {
      const active = await client
      if (!active.session.logged_in) return 0
      try {
        return await active.getUnseenNotificationsCount()
      } catch {
        return 0
      }
    },
    markNotificationRead: async (id) => {
      const active = await client
      requireSignIn(active, 'update a notification')
      const endpoint = notificationClicks.get(id)
      if (endpoint) await endpoint.call(active.actions)
      return id
    },
    // Signed-in state comes from the cookie jar probe; the accounts_list call only decorates it, so its failure must not read back as signed out.
    session: async () => {
      if (!signedIn?.()) return { signedIn: false, accounts: [] }
      try {
        return normalizeSession(await (await client).account.getInfo())
      } catch {
        return { signedIn: true, accounts: [] }
      }
    },
  }
}
