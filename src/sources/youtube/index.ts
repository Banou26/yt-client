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

// History and Subscriptions group their items under headings. `sections` is the
// grouped view; the flat `videos` getter throws the boundaries away.
type SectionedFeed = Feed & {
  sections?: { header?: { title?: unknown }, contents?: Iterable<unknown> }[]
  removeVideo?: (videoId: string, pagesToLoad?: number) => Promise<unknown>
}

type ChannelsFeed = {
  channels?: Iterable<unknown>
}

// Upstream's own filter vocabulary is lowercase; the schema's is uppercase, so
// the source lowercases on the way out. Declared structurally rather than
// imported so this file keeps its one hand-written client contract.
export type YoutubeSearchFilters = {
  upload_date?: string
  type?: string
  duration?: string
  prioritize?: string
  features?: string[]
}

// `results` mixes Video, Channel, Playlist/LockupView and shelves, so it is read
// instead of the `videos` getter, which emits only videos and is exactly why
// channel and playlist hits used to vanish from the page.
type SearchFeed = Feed & {
  results?: Iterable<unknown>
  refinements?: string[]
  estimated_results?: number
}

// Every tab getter is optional here because a channel only carries the tabs it
// actually has: calling getShorts() on a channel without one throws
// `Tab "shorts" not found` from getTabByURL, so each call is gated on its
// matching has_* getter rather than attempted and caught.
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

// Community posts page like any other feed, but the rows come off `posts`
// rather than `videos`, which pageItems never reads.
type PostsFeed = Feed & {
  posts?: Iterable<unknown>
}

// The two shapes the replies path needs off the raw nodes. They stay here
// rather than in normalize.ts because they are LIVE nodes: `endpoint.call`
// reaches back into the client, which a pure normalizer must not do.
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

// A ContinuationItem hangs its next page off its own endpoint on the first
// hop and off a "Load more" button afterwards.
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

/* One row of a reel sequence. Every entry carries an id and a portrait still;
   only the entry the response prefetches carries a player response, and its
   videoDetails is the only title the sequence supplies. */
type ReelEntry = {
  payload?: {
    videoId?: string
    thumbnail?: { thumbnails?: { url?: string, width?: number, height?: number }[] }
    unserializedPrefetchData?: {
      playerResponse?: { videoDetails?: { title?: string } }
    }
  }
}

// A ShortFormVideoInfo, narrowed to the sequence half. `basic_info` describes
// the SEED, not the sequence.
type ShortsSequence = {
  basic_info?: unknown
  watch_next_feed?: ReelEntry[]
  wn_has_continuation: boolean
  getWatchNextContinuation(): Promise<ShortsSequence>
}

const normalizeReelEntry = (entry: ReelEntry): SourceShort | undefined => {
  const id = entry?.payload?.videoId
  if (!id) return undefined
  // Widest first: these come back as a single 1080x1920 entry today, but the
  // order is not guaranteed and the largest is the one worth showing.
  const poster = [...(entry.payload?.thumbnail?.thumbnails ?? [])]
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
  return {
    id,
    poster,
    title: entry.payload?.unserializedPrefetchData?.playerResponse?.videoDetails?.title,
  }
}

// NotificationsMenu is NOT a Feed: it exposes `contents` and its own
// getContinuation, with no has_continuation getter to gate on.
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

// The library aggregation is a plain Feed, so the playlists it holds come off
// the `playlists` getter rather than `videos`.
type PlaylistsFeed = {
  playlists?: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistsFeed>
}

// A single playlist exposes its rows through `items`, but that getter casts
// every node the page carries and THROWS on anything outside its expected
// union: one stray recommended video detonates the whole list. The memo is read
// directly instead, which is the same set without the cast.
/* youtubei.js's LiveChat is an EventEmitter driven by its own polling loop.
   Only the members this source drives are declared, the same structural-subset
   approach the rest of this client interface uses. */
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
  // Absent when the video has no chat, which is what getLiveChat() throws on.
  livechat?: unknown
  getLiveChat(): LiveChatEmitter
}

type PlaylistFeed = {
  info?: unknown
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistFeed>
}

// One edit endpoint backs every playlist mutation; the action name selects
// which fields of this union are read. `browse/edit_playlist` forwards the
// array verbatim, so an action it does not know is silently ignored rather than
// rejected.
type PlaylistEditAction = {
  action: string
  addedVideoId?: string
  setVideoId?: string
  movedSetVideoIdPredecessor?: string
  playlistName?: string
  playlistDescription?: string
  playlistPrivacy?: SourcePlaylistPrivacy
}

// Without `parse: true` an action resolves to youtubei.js's Axios-shaped
// wrapper around the UNPARSED response, so `data` is raw InnerTube JSON.
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
  // Two round trips in one: the reel watch endpoint for the seed's own
  // metadata, and /reel/reel_watch_sequence for the shorts that follow it.
  getShortsVideoInfo(id: string): Promise<ShortsSequence>
  getChannel(id: string): Promise<ChannelFeed>
  // Turns a public URL into the endpoint behind it, which is the only way to
  // get a browse id from an @handle.
  resolveURL(url: string): Promise<{ payload?: { browseId?: string } }>
  /* The FULL video info, not getBasicInfo. Live chat hangs off the /next half
     of the response, and getBasicInfo only issues /player, so its result has no
     `livechat` and getLiveChat() throws on it. */
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
    // `playlistId` and `playlistIndex` are the keys /next actually reads.
    // youtubei.js's own WatchNextEndpoint also accepts `index` as an alias, but
    // that alias only exists inside its buildRequest, which execute never runs:
    // a raw `index` key would go out untouched and be ignored.
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

// Shorts read off the memo, where the node kind is named. They carry neither
// `video_id` nor `id`, so the ordinary video pass returns undefined for every
// one of them.
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
  // youtubei.js's `videos` getter surfaces legacy Video/GridVideo nodes but NOT
  // LockupView, and a modern feed (the signed-in home grid, channel Videos tab)
  // MIXES the two. Merging rather than either/or is essential: a single stray
  // legacy video used to short-circuit the LockupView branch and hide the whole
  // grid: the signed-in home then showed just that one video.
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

  // The kind a cursor was minted under. Needed by the one caller that receives
  // a cursor WITHOUT knowing its feed: a replies cursor names its own thread,
  // so commentReplies has no id argument to rebuild the kind from.
  const kindOf = (cursor: string) => entries.get(cursor)?.kind

  return { register, resolve, kindOf }
}

/* Comment actions are opaque protobuf endpoints minted per comment per session:
   there is no id or token that can be rebuilt from the comment id, so the only
   way to like or reply to a comment is to hold the endpoint the page arrived
   with. Bounded and eviction-ordered exactly like the continuation registry, and
   for the same reason: it is a cache of live handles, not durable state.

   An evicted token fails the write with a message the UI can act on, which is
   the honest outcome. Retrying after a reload mints a fresh one. */
const ACTION_LIMIT = 256

type CommentActions = {
  like?: EndpointNode
  dislike?: EndpointNode
  unlike?: EndpointNode
  undislike?: EndpointNode
  // Resolved through the reply command's DIALOG rather than the command
  // itself: CommentView.reply() reads reply_command.dialog.reply_button
  // .endpoint, and the command endpoint alone opens a dialog instead of posting.
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
    // Re-inserted on read so the comments a reader is actually interacting with
    // stay live while they scroll past hundreds of others.
    entries.delete(token)
    entries.set(token, entry)
    return entry
  }

  return { register, resolve }
}

// youtubei.js Text instances stringify through toString; feed nodes hand back
// either shape depending on the renderer.
const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  const node = value as { text?: string, toString?: () => string } | undefined
  if (node?.text) return node.text
  const stringified = node?.toString?.()
  return stringified && stringified !== 'N/A' ? stringified : undefined
}

// The chip's continuation token identifies it; its title is localized and would
// change under a different hl.
const chipId = (chip: { endpoint?: { payload?: { token?: string, params?: string } } }) =>
  chip.endpoint?.payload?.token ?? chip.endpoint?.payload?.params

// removeVideo defaults to scanning a single page, so anything the user has
// scrolled past would report 'Unable to find video in watch history'. Bounded
// because each extra page is a tunneled round trip.
const HISTORY_REMOVAL_PAGES = 10

// filter_chips THROWS when a feed carries no chip bar (and when it carries more
// than one), so it cannot be read with optional chaining. A feed without chips
// is ordinary, not an error.
const filterChipsOf = (feed: { filter_chips?: FilterChip[] }): FilterChip[] => {
  try {
    return feed.filter_chips ?? []
  } catch {
    return []
  }
}

// Schema vocabulary to upstream's. ALL is the unset state on every axis, so it
// is dropped rather than sent: youtubei.js would map it to a real filter value.
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
  // An all-empty filter set is passed as undefined so the call is identical to
  // an unfiltered search rather than sending an object full of undefineds.
  return Object.values(mapped).some((value) => value !== undefined && value.length !== 0) ? mapped : undefined
}

// Stable across key order so the same filter set always yields the same cursor
// namespace, which is what keeps a cursor from crossing filter sets.
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
  // Annotated rather than inferred: the table below is narrower than the tab
  // union, so an inferred element type would reject the two appended tabs.
  const tabs: SourceChannelTab[] = CHANNEL_TABS
    .filter((entry) => feed[entry.has] === true)
    .map((entry) => entry.tab)
  // Neither About nor Search is a content feed, so neither is in that table:
  // they are reachable the same way but render their own surface, and the strip
  // puts them last, matching youtube.com.
  if (feed.has_about === true) tabs.push('ABOUT')
  if (feed.has_search === true) tabs.push('SEARCH')
  return tabs
}

// Videos first when it exists, because that is what a channel link is almost
// always opened for; otherwise whatever the channel actually leads with.
const defaultChannelTab = (available: SourceChannelTab[]): SourceChannelTab =>
  available.find((tab) => tab === 'VIDEOS') ?? available[0] ?? 'HOME'

const openChannelTab = async (
  feed: ChannelFeed,
  tab: SourceChannelTab,
  query: string | undefined,
): Promise<ChannelFeed> => {
  // About renders from its own query rather than from a feed, so the landing
  // feed is returned untouched: nothing reads its rows while that tab is open.
  if (tab === 'ABOUT') return feed
  if (tab === 'SEARCH') {
    // An empty in-channel query would browse the whole channel rather than
    // search it, so it stays on the landing feed until there is something to
    // search for.
    if (!query || !feed.search) return feed
    return feed.search(query)
  }
  const entry = CHANNEL_TABS.find((candidate) => candidate.tab === tab)
  const open = entry && feed[entry.open]
  // The tab was reported as available, so a missing opener is reachable only if
  // upstream and its own has_* getter disagree. Falling back to the landing feed
  // beats throwing `Tab "x" not found` at the page.
  if (typeof open !== 'function') return feed
  // `.call(feed)` rather than `open()`: every one of these is a prototype method
  // that reaches for `this.getTabByURL`, so invoking the looked-up reference
  // bare detaches it and fails with `reading 'getTabByURL' of undefined`.
  return (open as (this: ChannelFeed) => Promise<ChannelFeed>).call(feed)
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

  /* Live chat sessions, one per video, kept running between polls.

     Upstream is an EventEmitter and everything above this is one response per
     request, so the emitter runs here and each poll drains what it has buffered
     since the last one. The session outlives any single call, which is the only
     reason a message said between two polls is not lost. */
  type LiveChatSession = {
    chat: LiveChatEmitter
    buffer: SourceLiveChatMessage[]
    removed: string[]
    ended: boolean
    failure?: Error
    lastReadAt: number
    // Resolved whenever anything lands, so a poll can wait instead of spinning.
    wake: () => void
    arrived: Promise<void>
  }
  const liveChatSessions = new Map<string, LiveChatSession>()

  /* A poll that returned the moment it found nothing would spin the client at
     request rate, so it waits for traffic instead. The ceiling keeps the
     request from looking hung to anything upstream and gives the UI a heartbeat
     on a quiet chat. */
  const LIVE_CHAT_WAIT_MS = 6_000
  /* The FIRST call waits only briefly. The emitter's opening fetch usually
     carries the backlog everyone else already has on screen, and catching it
     opens the panel populated. But a quiet chat has nothing to catch, and
     waiting the full poll interval for it would hold the panel blank for six
     seconds before rendering anything at all. */
  const LIVE_CHAT_OPEN_GRACE_MS = 1_000
  // A chat nobody has polled for this long has been navigated away from.
  const LIVE_CHAT_IDLE_MS = 60_000
  // Roughly a screenful of scrollback per poll. A chat can outrun any reader,
  // and holding an unbounded backlog would grow without limit on a busy stream.
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
    const info = await (await client).getInfo(videoId)
    // getLiveChat() THROWS when the video carries no chat, so absence is checked
    // rather than caught: a video with chat turned off is an ordinary answer.
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
        // A deletion travels as its own instruction because the client holds the
        // transcript: it cannot notice a message going missing from a later page.
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
      // The session can be reaped between two polls of a backgrounded tab.
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

  // Reaping is driven by reads rather than by a timer, so a source with no live
  // chat in play never holds one open.
  const reapIdleLiveChats = (keep: string) => {
    const now = Date.now()
    for (const [videoId, session] of liveChatSessions) {
      if (videoId !== keep && now - session.lastReadAt > LIVE_CHAT_IDLE_MS) closeLiveChat(videoId)
    }
  }
  /* One browse per channel rather than one per tab. A youtubei.js Channel holds
     every tab it has, and none of getVideos/getPlaylists/getAbout/getCommunity
     mutates it (each returns a new feed), so the same fetched object serves
     every tab, the About panel and the Community list.

     Before this, each tab switch re-browsed the channel and About and Community
     each browsed it a SECOND time, so flipping between tabs fired a burst of
     overlapping POSTs to /browse. That burst is what surfaced as an
     intermittent 405 from the endpoint.

     Short-lived rather than permanent: the header carries subscribe state, and
     a channel pinned for the session would keep serving the pre-write value. */
  const CHANNEL_TTL_MS = 60_000
  const channelFetches = new Map<string, { at: number, result: Promise<ChannelFeed> }>()

  /* A handle is not a browse id.

     getChannel wants a `UC...` id and answers "Invalid channel" for anything
     else, but a handle is what the app actually has in hand in two places: a
     YouTube URL is `youtube.com/@name` these days, and the signed-in account
     reports its own `channel_handle` while carrying NO browse id at all (its
     endpoint is a selectActiveIdentityEndpoint holding GAIA tokens). Resolving
     costs one round trip, and only for callers that arrive with a handle. */
  const resolveHandle = async (handle: string) => {
    /* A handle nobody owns is an ordinary miss, not a fault: upstream answers
       it with no endpoint at all and youtubei.js reports that as "Expected a
       NavigationEndpoint but got undefined", an internal sentence that reached
       the reader verbatim because maskedErrors is off. Anyone can produce it by
       mistyping a handle or following a link to a renamed channel. */
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
    // A failed fetch must not be cached as the answer: drop it so the next
    // attempt re-browses rather than replaying a transient error.
    void result.catch(() => {
      if (channelFetches.get(id)?.result === result) channelFetches.delete(id)
    })
    return result
  }
  // The tab set, sort options and applied sort belong to the page rather than
  // to the channel entity, and a cursored call does not re-read them, so the
  // last read of each channel keeps both halves.
  const channels = new Map<string, {
    channel: SourceChannel
    page: Omit<SourceChannelPage, 'channel' | 'videos'>
  }>()
  // A playlist write never refetches the playlist, and every mutation resolves
  // to a Playlist whose `title` is non-null, so the last read of each playlist
  // is kept to fill the fields the write did not touch.
  const knownPlaylists = new Map<string, SourcePlaylist>()

  /* The home grid renders its shorts as a carousel row rather than inline, so
     they come back on their own list. Every later page can carry another shelf,
     which is why this is not just a property of the first page. */
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
    const result: SourceVideoPage = { items: pageItems(feed) }
    if (feed.has_continuation) {
      result.cursor = videoContinuations.register(kind, async () => page(kind, await feed.getContinuation()))
    }
    return result
  }

  // Search rows are read off `results` rather than the `videos` getter, which
  // emits only videos: that getter is why channel and playlist hits, which
  // YouTube ranks first for a name query, used to be dropped from the page.
  // Shelves and watch cards carry no row of their own and fall out here.
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

  /* The record-click endpoints, held the same way comment commands are: there
     is no manager method for marking a notification read, only the endpoint the
     row arrived with. Keyed by notification id rather than an opaque token
     because the id IS stable here, unlike a comment's commands. */
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
    // No has_continuation on this menu, so the cursor is minted unconditionally
    // and an exhausted one simply comes back empty.
    if (items.length > 0) {
      result.cursor = notificationContinuations.register(
        'notifications',
        async () => notificationPage(await feed.getContinuation()),
      )
    }
    return result
  }

  /* The sidebar pages through the same registry as every other video feed. Its
     rows are the same CompactVideo and LockupView kinds the first page carried,
     so they run through the same two normalizers. */
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
    const result: SourceVideoPage = { items }
    const next = findContinuation(memo?.get('ContinuationItem') ?? [])
    if (next) result.cursor = registerRelated(kind.replace(/^related:/, ''), next)
    return result
  }

  /* The reel sequence PAGES BY MUTATION: getWatchNextContinuation() overwrites
     watch_next_feed on the same object and returns `this`, so the sequence is
     read immediately after each call rather than from a returned page. The
     continuation registry memoizes per cursor, so each call happens once and
     the pages stay in order. */
  const shortsPage = (info: ShortsSequence, seed?: SourceShort): SourceShortsPage => {
    const seen = new Set<string>()
    const items: SourceShort[] = []
    const add = (short: SourceShort | undefined) => {
      if (short && !seen.has(short.id)) {
        seen.add(short.id)
        items.push(short)
      }
    }
    /* The seed leads, so a deep link opens on the short it names rather than
       making the viewer scroll to it. Its still comes off basic_info, which is
       the 16:9 letterboxed frame; when the sequence also lists the seed it
       carries the true portrait frame for it, so that one wins while the
       seed's title (which the sequence does not have) is kept. */
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

  /* With no seed the pager needs a short to start from, and the sequence
     endpoint has no "just give me shorts" mode. The home shelf is the only
     general source of shorts the client has, so its first row seeds the feed.
     An anonymous home carries none, which is why an anonymous Shorts feed is
     legitimately empty rather than broken. */
  const seedShort = async (active: YoutubeClient) => {
    if (!active.session.logged_in) return undefined
    const feed = await active.getHomeFeed()
    return shortsItems(feed)[0]?.id
  }

  const registerRelated = (videoId: string, endpoint: EndpointNode): string => {
    const kind = `related:${videoId}`
    return videoContinuations.register(kind, async () => {
      const response = await endpoint.call((await client).actions, { parse: true }) as ContinuationResponse
      // A watch-next continuation answers on the same memo the replies path
      // uses, not on contents_memo.
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

  // Sections carry the day headings the History page is built around. A feed
  // that reports none still yields one untitled section, so the caller renders
  // a plain list rather than nothing.
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

  /* Replies live behind a continuation whose api path is carried ON the
     endpoint (NavigationEndpoint.call reads metadata.api_url, which comes from
     the response and is not guessable), so the endpoint has to be captured here
     while the parsed thread is still in hand. Registering it as an ordinary
     cursor is what lets commentPage keep discarding the CommentThread objects:
     the closure holds the one endpoint it needs rather than the whole node.

     Nothing extra is fetched. The parser has already applied the comment entity
     mutations to on_response_received_endpoints_memo (parser.js:221), so the
     CommentViews that come back are fully populated. */
  const actionsToken = (node: unknown, commentId: string) => {
    const commands = node as CommentActionNode | undefined
    const actions: CommentActions = {
      like: commands?.like_command,
      dislike: commands?.dislike_command,
      unlike: commands?.unlike_command,
      undislike: commands?.undislike_command,
      reply: commands?.reply_command?.dialog?.reply_button?.endpoint,
    }
    // Nothing actionable means nothing to hold: a signed-out read carries no
    // commands at all, and minting a token for it would only produce a control
    // that fails on click.
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
    // A replies continuation hangs its next page off a "Load more" BUTTON
    // rather than off the item's own endpoint, which is where the first page
    // came from.
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
      // The header count is exact, unlike the rounded teaser /next carries on
      // WatchMeta, which the UI had to read with a regex.
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

  // Rows come straight out of the memo. The `items` getter casts the page's
  // whole video set in one go and throws on anything outside its union, so a
  // single recommended-video rail on the page loses the entire list. Only
  // PlaylistVideo is accepted: it is the one renderer carrying set_video_id,
  // which every later edit of the playlist needs.
  const playlistItems = (feed: PlaylistFeed) =>
    (feed.memo?.get('PlaylistVideo') ?? [])
      .map(normalizePlaylistItem)
      .filter((item) => item !== undefined)

  // The playlist entity is threaded through every page rather than re-read: a
  // continuation response carries no header and no sidebar, so reading its
  // `info` would hand back a playlist stripped of its title and stats.
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

  // The entity a write resolves to. Only the changed fields are real; the rest
  // is whatever the last read of this playlist held, because none of the edit
  // endpoints hands back a parseable playlist (they answer with an undocumented
  // raw `actions` array). `title` falls back to '' the way setSubscribed fills
  // Channel.name: the schema forbids null there, and the mutation document is
  // not supposed to select it unless the write set it.
  const writtenPlaylist = (id: string, changed: Partial<SourcePlaylist>): SourcePlaylist => {
    const known = knownPlaylists.get(id)
    const next: SourcePlaylist = { ...known, id, title: known?.title ?? '', ...changed }
    // Only refresh what was already cached: a write must not mint a stub that a
    // later read of the library would then be merged into.
    if (known) knownPlaylists.set(id, next)
    return next
  }

  // Every playlist edit is the same POST with a different action. youtubei.js's
  // PlaylistManager wraps some of these, but its wrappers pay a browse (plus a
  // continuation per extra page) to translate video ids into set video ids, and
  // one of them ships a broken body, so the endpoint is called directly.
  const editPlaylist = async (id: string, reason: string, actions: PlaylistEditAction[]) => {
    const active = await client
    // `browse/edit_playlist` carries no browseId, and youtubei.js only runs its
    // signed-in precheck for payloads that have one, so an anonymous edit would
    // otherwise go out and come back as an opaque failure.
    requireSignIn(active, reason)
    await active.actions.execute('browse/edit_playlist', { playlistId: id, actions })
  }

  // The aggregation mixes modern lockups with legacy Playlist/GridPlaylist
  // nodes, and its lockup filter also admits albums and podcasts, which
  // normalizePlaylistLockup drops.
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
    // The chip is part of the continuation kind so a cursor minted under one
    // filter cannot page another one's results.
    home: async (chip, cursor) => {
      const kind = chip ? `home:${chip}` : 'home'
      if (cursor) {
        const next = await homeContinuations.resolve(kind, cursor)
        // Chips belong to the first page: a continuation carries none, and
        // echoing an empty list would make the rail vanish mid-scroll.
        return { items: next.items, shorts: next.shorts, chips: [], cursor: next.cursor }
      }
      const feed = await (await client).getHomeFeed()
      const chips = filterChipsOf(feed)
      // applyFilter costs a second browse round trip, so it only runs when a
      // chip other than All is actually selected.
      const filter = chip ? chips.find((candidate) => chipId(candidate) === chip) : undefined
      const filtered = filter && feed.applyFilter ? await feed.applyFilter(filter) : feed
      const result = homePage(kind, filtered)
      return {
        items: result.items,
        shorts: result.shorts,
        // Chips come from the unfiltered response: the filtered one echoes back
        // a reduced set that would make the rail collapse after one click.
        chips: chips.flatMap((candidate) => {
          const id = chipId(candidate)
          const label = text(candidate.title)
          if (!id || !label) return []
          return [{ id, label, selected: candidate.is_selected === true || id === chip }]
        }),
        cursor: result.cursor,
      }
    },
    /* The Shorts pager runs off the reel sequence, which is what the real
       Shorts UI uses. Its entries carry an id and a portrait still, and the
       seed's own metadata arrives on the same response as `basic_info`, so the
       first slide renders its title with no extra call.

       Playback is deliberately NOT taken from the sequence even though it
       prefetches a player response for one entry: that block is a /player-shaped
       response, and the ordinary watch-HTML path is already proven to serve
       shorts (verified against a live short: portrait formats, real manifest).
       Using the prefetch would trade a proven path for a preview-tier one. */
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
    // The query AND the filters are part of the kind: a cursor minted under one
    // filter set must not page another's results after the user narrows a
    // search, which would silently mix filtered and unfiltered pages.
    search: async (query, filters, cursor) => {
      const kind = `search:${query}:${filterKey(filters)}`
      if (cursor) return searchContinuations.resolve(kind, cursor)
      return searchPage(kind, await (await client).search(query, upstreamFilters(filters)))
    },
    // Suggestions are pure display text with no continuation and no entity, so
    // a failure degrades to an empty list rather than failing the header.
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
      // Cursors are namespaced per (channel, tab, sort, query): the Videos tab
      // and the Playlists tab of one channel are different feeds, and paging one
      // with the other's cursor would append unrelated rows.
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
      // Sorting is a second browse round trip, so it only runs when the caller
      // asked for an option the tab actually offers.
      const sortOptions = feed.sort_filters ?? []
      const appliedSort = sort && sortOptions.includes(sort) ? sort : undefined
      if (appliedSort && feed.applySort) feed = await feed.applySort(appliedSort)
      const rest = { availableTabs, tab: selected, sortOptions, appliedSort }
      channels.set(id, { channel, page: rest })
      return { ...rest, channel, videos: page(kind, feed) }
    },
    // A second browse on top of channel(), so it is only paid for by the About
    // tab. `has_about` gates it: getAbout() reaches for a tab that is simply
    // not there on channels that publish no panel.
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
    // A single /next call carries everything the watch page needs on top of
    // playback (which fetches /player separately): one tunneled round trip. In
    // playlist context that same response also brings the queue panel back, so
    // opening a video inside a playlist costs no extra request.
    watch: async (id, playlistId, playlistIndex) => {
      const response = await (await client).actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        // Omitted rather than sent as undefined: JSON.stringify would drop the
        // key anyway, but a 0 index is meaningful and must survive.
        ...(playlistId ? { playlistId } : {}),
        ...(playlistIndex === undefined ? {} : { playlistIndex }),
        parse: true,
      })
      const meta = normalizeWatchMeta(response, id)
      if (!meta) return undefined
      /* The sidebar's continuation is the LAST item of secondary_results, and
         it has to be captured here while the parsed node is in hand: its api
         path lives on the endpoint, and normalizeWatchMeta is pure so it never
         touches a live node. Read off secondary_results rather than the memo,
         which also holds the comments entry's ContinuationItem: taking the
         first one out of the memo would page comments into the video sidebar. */
      const watchNext = (response as WatchNextContainer).contents_memo?.get('TwoColumnWatchNextResults')?.[0]
      const secondary = (watchNext as { secondary_results?: unknown[] } | undefined)?.secondary_results ?? []
      /* One level deeper than it looks. secondary_results holds an ItemSection
         whose `contents` carry the rows AND the trailing ContinuationItem;
         youtubei.js's own VideoInfo reaches it the same way
         (firstOfType(ItemSection).contents, then pops the last item). Searching
         only the top level finds the rows' section and no continuation. */
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
    // No videoId or comment id argument: the cursor was minted for exactly one
    // thread and already names it.
    commentReplies: async (cursor) => {
      const kind = commentContinuations.kindOf(cursor)
      // A cursor that exists but belongs to a comment LIST is a different
      // mistake from one that does not exist at all, and only the first is
      // worth its own message: an unknown cursor is reported by resolve() with
      // the same wording every other feed uses.
      if (kind !== undefined && !kind.startsWith('replies:')) {
        throw new Error(`youtube: continuation ${cursor} belongs to ${kind}, not a reply thread`)
      }
      return commentContinuations.resolve(kind ?? 'replies:unknown', cursor)
    },
    comments: async (videoId, sort, cursor) => {
      // The sort is part of the kind: a cursor minted under Top cannot page
      // Newest, and the two orderings interleave into nonsense if it does.
      const kind = `comments:${videoId}:${sort ?? 'TOP'}`
      if (cursor) return commentContinuations.resolve(kind, cursor)
      try {
        // Passed to getComments rather than applied afterwards: applySort costs
        // a second round trip for the same result.
        const upstreamSort = sort === 'NEWEST' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'
        return commentPage(kind, await (await client).getComments(videoId, upstreamSort))
      } catch (error) {
        // videos with comments turned off make youtubei.js throw
        // "Comments page did not have any content.", an expected state, not a failure.
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
    // Deliberately not sign-in gated: a public playlist opens signed out, and a
    // private one comes back as an upstream error rather than as an empty page.
    // The cursor kind carries the playlist id so one playlist cannot page
    // another one's rows.
    playlist: async (id, cursor) => {
      if (cursor) return playlistContinuations.resolve(`playlist:${id}`, cursor)
      const feed = await (await client).getPlaylist(id)
      const items = playlistItems(feed)
      const details = normalizePlaylistDetails(feed, id)
      // The sidebar thumbnail renderer is legacy and often absent, so the first
      // row stands in as the cover. It has to be resolved before the
      // continuation closure captures the playlist: page two would otherwise
      // hand back the same entity with its cover cleared, and the normalized
      // cache would blank the image mid-scroll.
      const playlist = rememberPlaylist({ ...details, thumbnail: details.thumbnail ?? items[0]?.video.thumbnail })
      return playlistPage(id, playlist, feed, items)
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
      return { id, likeStatus: status, related: [], descriptionRuns: [] }
    },
    // History.removeVideo string-matches the English menu label for LockupView
    // items, so this breaks under a non-English hl. It is the only removal path
    // youtubei.js exposes.
    removeFromHistory: async (videoId) => {
      const active = await client
      requireSignIn(active, 'change your history')
      // A FRESH feed every time: removeVideo scans the pages its instance holds
      // and, when it has to look further, replaces that instance's contents with
      // the next page. Reusing one long-lived History would therefore lose the
      // earlier pages after the first removal that had to page forward.
      const history = await active.getHistory()
      if (!history.removeVideo) throw new Error('youtube: this history feed cannot be edited')
      await history.removeVideo(videoId, HISTORY_REMOVAL_PAGES)
      return videoId
    },
    /* The response is an opaque ApiResponse with no parseable comment in it, so
       this resolves to a Boolean rather than to an entity: fabricating a
       Comment would mean inventing an id, and a made-up id in a normalized
       cache is worse than no entity at all. The composer prepends its own row
       from the session identity. */
    liveChat: async (videoId, cursor) => {
      reapIdleLiveChats(videoId)
      if (cursor) return liveChatContinuations.resolve(`livechat:${videoId}`, cursor)
      const session = await openLiveChat(videoId)
      // Chat is off for this video, or it never had any. Distinct from an empty
      // page, so the panel can say so instead of sitting blank.
      if (!session) return { items: [], disabled: true }
      // Catch the opening backlog if it is already in flight, but do not hold
      // the panel blank waiting for a chat that simply has nothing to say.
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
      /* Reuses the session the panel already has running rather than opening a
         second one: sending is an action on a chat you are watching, and a
         private session would poll the same stream twice. */
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
      // `commentText` is the key the reply button's endpoint reads; the button
      // itself carries the thread it belongs to.
      await actions.reply.call(active.actions, { commentText: textBody })
      return true
    },
    rateComment: async (token, status) => {
      const active = await client
      requireSignIn(active, 'rate a comment')
      const { commentId, actions } = commentActions.resolve(token)
      // Four separate endpoints rather than one with a parameter, so clearing a
      // rating is a different call from setting one and the previous state
      // decides which. INDIFFERENT has to undo whichever was set.
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
      // Keep the cache honest so a later channel() read does not hand back the
      // pre-write state. Only the entity half changes; the page half (tabs and
      // sort options) is untouched by a subscribe.
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
      // An empty selection is an ordinary UI state, not an error, and an edit
      // carrying zero actions is a round trip that changes nothing.
      if (videoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'save to a playlist', videoIds.map((videoId) => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: videoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // Entries go out as set video ids, which is what the wire wants anyway.
    // youtubei.js's removeVideos takes plain video ids and translates them by
    // browsing the playlist, paging until it has matched as many rows as ids it
    // was given: an id that is not in the playlist makes it walk every page and
    // then throw, and a single Shorts lockup on any page throws a ParsingError
    // before the edit is even attempted (core/managers/PlaylistManager.js:123).
    removeFromPlaylist: async (playlistId, setVideoIds) => {
      if (setVideoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'change a playlist', setVideoIds.map((setVideoId) => ({
        action: 'ACTION_REMOVE_VIDEO',
        setVideoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // youtubei.js's create() can only send a title and video ids, but the
    // endpoint it calls copies privacyStatus and description too
    // (parser/classes/endpoints/CreatePlaylistServiceEndpoint.js:17), so the
    // call is made directly to reach them. There is no edit-side privacy path
    // in 17.0.1, which makes creation the one attested way to set it.
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
      // The new id is the only server-generated value in this whole write path
      // and it is optional on the wire, so it is narrowed rather than trusted:
      // without it the entity has no cache key and the caller has to reread the
      // library instead of merging a result.
      const id = response.data?.playlistId
      if (!id) throw new Error('youtube: the playlist was created but its id did not come back')
      return rememberPlaylist({ id, title, description, privacy })
    },
    // youtubei.js's delete() throws before it reaches the network here: it
    // builds the raw key `deletePlaylistServiceEndpoint`
    // (core/managers/PlaylistManager.js:40), for which parser/nodes.js registers
    // no class, so the command resolves to undefined and NavigationEndpoint then
    // finds no api_url. The registered DeletePlaylistEndpoint is broken in its
    // own right: it guards on `playlistId` and assigns from `sourcePlaylistId`
    // (parser/classes/endpoints/DeletePlaylistEndpoint.js:15), so it only emits
    // a body when both keys are passed. Calling the path directly skips both.
    deletePlaylist: async (id) => {
      const active = await client
      requireSignIn(active, 'delete a playlist')
      await active.actions.execute('playlist/delete', { playlistId: id })
      knownPlaylists.delete(id)
      return id
    },
    // youtubei.js's setName builds its payload as `{ playlist_id, actions }` in
    // snake_case (core/managers/PlaylistManager.js:200), but PlaylistEditEndpoint
    // only copies `actions`, `playlistId` and `params` out of it
    // (parser/classes/endpoints/PlaylistEditEndpoint.js:13), so the id is
    // dropped and the POST goes out saying which name to set but not on what.
    // It is the only snake_case payload in that manager; the endpoint is the
    // same one every other edit uses, so it is called directly instead.
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
    // The one action name here that youtubei.js 17.0.1 does not attest: the
    // package has no privacy edit path at all, and grepping it turns up
    // `privacyStatus` only on the create endpoint. What IS verified is the
    // transport, since browse/edit_playlist forwards the actions array
    // untouched, so the shape is right even though the vocabulary is inferred.
    // An action the server does not recognise is ignored rather than rejected,
    // which makes this the one write whose optimistic result can outrun the
    // server. Setting privacy at creation goes through an attested endpoint.
    setPlaylistPrivacy: async (id, privacy) => {
      await editPlaylist(id, 'change a playlist privacy', [{
        action: 'ACTION_SET_PLAYLIST_PRIVACY',
        playlistPrivacy: privacy,
      }])
      return writtenPlaylist(id, { privacy })
    },
    // The destination is a predecessor, not an index: the moved entry lands
    // immediately AFTER `afterSetVideoId`, and omitting it asks for the first
    // position. youtubei.js's own jsdoc says "before" (core/managers/
    // PlaylistManager.d.ts:59), which contradicts both the action name and the
    // field name on the wire; the wire wins.
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
        // The count is decoration on a bell that still opens: upstream's own
        // implementation carries a FIXME about not parsing this properly, so a
        // shape change must not take the header down with it.
        return 0
      }
    },
    markNotificationRead: async (id) => {
      const active = await client
      requireSignIn(active, 'update a notification')
      const endpoint = notificationClicks.get(id)
      // No manager method exists for this: the row carries its own
      // record-click endpoint, which is the only way to mark it read.
      if (endpoint) await endpoint.call(active.actions)
      return id
    },
    // Signed-in state comes from the cookie jar probe; the accounts_list call
    // only decorates it, so its failure must not read back as signed out.
    session: async () => {
      if (!signedIn?.()) return { signedIn: false, accounts: [] }
      try {
        return normalizeSession(await (await client).account.getInfo())
      } catch {
        // Signed in, but the account read failed. The header still has to know
        // which it is, and an empty list simply offers no switch.
        return { signedIn: true, accounts: [] }
      }
    },
  }
}
