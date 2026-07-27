export type SourceLikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT'

export type SourceNotificationLevel = 'ALL' | 'PERSONALIZED' | 'NONE'

// Write-side vocabulary. `SourcePlaylist.privacy` stays a plain string because
// it echoes whatever the playlist header carries, which is not guaranteed to
// stay inside this set.
export type SourcePlaylistPrivacy = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

export type SourceChannel = {
  id: string
  name: string
  avatar?: string
  handle?: string
  subscriberCountText?: string
  videoCountText?: string
  banner?: string
  description?: string
  isSubscribed?: boolean
  notificationLevel?: SourceNotificationLevel
  isVerified?: boolean
}

export type SourceVideo = {
  id: string
  title: string
  description?: string
  descriptionSnippet?: string
  thumbnail?: string
  durationSeconds?: number
  viewCount?: string
  publishedText?: string
  isLive?: boolean
  progressPercent?: number
  isUpcoming?: boolean
  isMembersOnly?: boolean
  isShort?: boolean
  // Upstream's own localized badge texts. `badges` is always present so the
  // resolver never has to invent an empty list for a non-null GraphQL field.
  badges: string[]
  channel?: SourceChannel
}

export type SourceVideoPage = {
  items: SourceVideo[]
  cursor?: string
}

export type SourceVideoSection = {
  title?: string
  items: SourceVideo[]
}

export type SourceSectionedVideoPage = {
  sections: SourceVideoSection[]
  cursor?: string
}

export type SourceFeedChip = {
  id: string
  label: string
  selected: boolean
}

// The paged half of the home feed. Shorts are separate from `items` because
// the grid renders them as their own carousel row, and a page beyond the first
// can carry another shelf.
export type SourceHomePage = {
  items: SourceVideo[]
  shorts: SourceVideo[]
  cursor?: string
}

export type SourceHomeFeed = SourceHomePage & {
  chips: SourceFeedChip[]
}

export type SourceSearchUploadDate = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR'

export type SourceSearchType = 'ALL' | 'VIDEO' | 'SHORTS' | 'CHANNEL' | 'PLAYLIST' | 'MOVIE'

export type SourceSearchDuration = 'ALL' | 'UNDER_THREE_MINS' | 'THREE_TO_TWENTY_MINS' | 'OVER_TWENTY_MINS'

export type SourceSearchSort = 'RELEVANCE' | 'POPULARITY'

export type SourceSearchFeature =
  | 'HD' | 'SUBTITLES' | 'CREATIVE_COMMONS' | 'THREE_D' | 'LIVE'
  | 'PURCHASED' | 'FOUR_K' | 'THREE_SIXTY' | 'LOCATION' | 'HDR' | 'VR180'

export type SourceSearchFilters = {
  uploadDate?: SourceSearchUploadDate
  type?: SourceSearchType
  duration?: SourceSearchDuration
  sortBy?: SourceSearchSort
  features?: SourceSearchFeature[]
}

// Discriminated at the source so the worker's __resolveType is a field switch
// and never has to recognize a youtubei.js node. The tag sits ALONGSIDE the
// entity's own fields rather than wrapping them: GraphQL resolves the members'
// fields off this same object, and a wrapper would need an unwrapping resolver
// for all three types. `kind` is not in the schema, so it is never selectable.
export type SourceSearchResult =
  | (SourceVideo & { kind: 'video' })
  | (SourceChannel & { kind: 'channel' })
  | (SourcePlaylist & { kind: 'playlist' })

export type SourceSearchPage = {
  results: SourceSearchResult[]
  refinements: string[]
  estimatedResults?: number
  cursor?: string
}

export type SourceChannelTab =
  | 'HOME' | 'VIDEOS' | 'SHORTS' | 'LIVE' | 'RELEASES'
  | 'PODCASTS' | 'COURSES' | 'PLAYLISTS' | 'COMMUNITY' | 'ABOUT' | 'SEARCH'

export type SourceNotification = {
  id: string
  message: string
  sentText?: string
  avatar?: string
  thumbnail?: string
  videoId?: string
  read?: boolean
}

export type SourceNotificationPage = {
  items: SourceNotification[]
  cursor?: string
}

export type SourceChannelLink = {
  title: string
  url: string
}

export type SourceChannelAbout = {
  description?: string
  country?: string
  joinedDateText?: string
  viewCountText?: string
  subscriberCountText?: string
  videoCountText?: string
  canonicalUrl?: string
  links: SourceChannelLink[]
}

export type SourcePost = {
  id: string
  author?: SourceChannel
  text: string
  publishedText?: string
  voteCountText?: string
  attachedVideo?: SourceVideo
  attachedImage?: string
}

export type SourcePostPage = {
  items: SourcePost[]
  cursor?: string
}

export type SourceChannelPage = {
  channel: SourceChannel
  videos: SourceVideoPage
  availableTabs: SourceChannelTab[]
  tab: SourceChannelTab
  sortOptions: string[]
  appliedSort?: string
}

// The queue rail a playlist-context watch comes back with. It is NOT a
// SourcePlaylist: `currentIndex` belongs to the video being watched, and the
// panel carries none of the playlist's stats.
export type SourceWatchPlaylist = {
  id: string
  title?: string
  // The owner byline as text. A mix has no channel behind its byline.
  author?: string
  items: SourceVideo[]
  // 0-based, and reported BY THE SERVER: an out-of-range requested index comes
  // back corrected here rather than as an error.
  currentIndex?: number
  isInfinite?: boolean
}

export type SourceWatchMeta = {
  id: string
  title?: string
  viewCountText?: string
  publishedDateText?: string
  likeCountText?: string
  commentCountText?: string
  description?: string
  descriptionRuns: SourceTextRun[]
  likeStatus?: SourceLikeStatus
  channel?: SourceChannel
  related: SourceVideo[]
  playlist?: SourceWatchPlaylist
}

// One segment of a rich text body. Which target field is set is what names the
// kind: a run whose endpoint is a kind this client does not model keeps its
// text and simply renders unlinked, rather than being dropped.
export type SourceTextRun = {
  text: string
  url?: string
  videoId?: string
  startSeconds?: number
  browseId?: string
}

export type SourceComment = {
  id: string
  author?: SourceChannel
  text: string
  runs: SourceTextRun[]
  publishedText?: string
  likeCountText?: string
  replyCount?: number
  isPinned?: boolean
  isHearted?: boolean
  isLiked?: boolean
  isDisliked?: boolean
  isCreator?: boolean
  isMember?: boolean
  // A cursor into the same registry every other page uses, minted only for a
  // comment that actually has replies. Opaque to the caller, like all cursors.
  repliesCursor?: string
  // Opaque handle for this comment's like, dislike and reply endpoints, which
  // are per-comment protobuf params that cannot be rebuilt from the id. Absent
  // when the read carried no commands, which is what a signed-out page looks
  // like: a control with no token is a control that should not be offered.
  actionsToken?: string
}

export type SourceCommentSort = 'TOP' | 'NEWEST'

export type SourceCommentPage = {
  items: SourceComment[]
  cursor?: string
  disabled?: boolean
  countText?: string
}

export type SourcePlaylist = {
  id: string
  title: string
  description?: string
  thumbnail?: string
  videoCountText?: string
  viewCountText?: string
  updatedText?: string
  privacy?: string
  isEditable?: boolean
  canDelete?: boolean
  canReorder?: boolean
  channel?: SourceChannel
}

// A playlist entry WRAPS its video instead of extending it: removing or
// reordering an entry needs `setVideoId`, which identifies the slot rather than
// the video, and the same video can legitimately sit in a playlist twice.
export type SourcePlaylistItem = {
  video: SourceVideo
  setVideoId?: string
  // 1-BASED, unlike SourceWatchPlaylist.currentIndex and watch()'s
  // playlistIndex. It is upstream's own row number, which is also what a
  // `&index=` link addresses.
  index?: number
}

export type SourcePlaylistPage = {
  playlist: SourcePlaylist
  items: SourcePlaylistItem[]
  cursor?: string
}

export type SourcePlaylistListPage = {
  items: SourcePlaylist[]
  cursor?: string
}

export type SourceSession = {
  signedIn: boolean
  name?: string
  avatar?: string
  handle?: string
}

export type Source = {
  id: string
  home(chip?: string, cursor?: string): Promise<SourceHomeFeed>
  subscriptions(cursor?: string): Promise<SourceVideoPage>
  history(cursor?: string): Promise<SourceSectionedVideoPage>
  subscribedChannels(): Promise<SourceChannel[]>
  // A cursor is bound to the query AND the filters that minted it: changing a
  // filter has to start a new feed, not page the previous one's results.
  search(query: string, filters?: SourceSearchFilters, cursor?: string): Promise<SourceSearchPage>
  // Not an InnerTube call. It reads suggestqueries-clients6.youtube.com through
  // the rewritten fetch, so every keystroke that reaches it is a tunneled round
  // trip and the caller is expected to debounce.
  searchSuggestions(query: string, previousQuery?: string): Promise<string[]>
  video(id: string): Promise<SourceVideo | undefined>
  // `tab` omitted means the channel's own landing tab. `query` applies only to
  // the SEARCH tab. `sort` is one of the page's own sortOptions labels.
  channel(id: string, tab?: SourceChannelTab, sort?: string, query?: string, cursor?: string): Promise<SourceChannelPage>
  // A second browse on top of channel(): only the About tab needs it, so it is
  // its own call rather than a field every other tab would pay for.
  channelAbout(id: string): Promise<SourceChannelAbout | undefined>
  communityPosts(channelId: string, cursor?: string): Promise<SourcePostPage>
  // Passing a playlist puts the video in a queue, and the same call then also
  // brings back the panel. `playlistIndex` is 0-based; the server corrects an
  // out-of-range one, so the honoured position is the one on the result.
  watch(id: string, playlistId?: string, playlistIndex?: number): Promise<SourceWatchMeta | undefined>
  // A cursor is bound to the sort that minted it: switching order has to start
  // a new feed rather than page the previous ordering's results.
  comments(videoId: string, sort?: SourceCommentSort, cursor?: string): Promise<SourceCommentPage>
  // Replies page through the same cursor mechanism as everything else: the
  // cursor comes off SourceComment.repliesCursor and its own page carries the
  // next one. There is no videoId argument because the cursor already names
  // exactly which thread it belongs to.
  commentReplies(cursor: string): Promise<SourceCommentPage>
  // The library aggregation is signed-in only; a single playlist is not, so a
  // public one opens anonymously.
  playlists(cursor?: string): Promise<SourcePlaylistListPage>
  playlist(id: string, cursor?: string): Promise<SourcePlaylistPage>
  notifications(cursor?: string): Promise<SourceNotificationPage>
  unseenNotificationCount(): Promise<number>
  session(): Promise<SourceSession>
  // Writes resolve to the affected entity so the normalized cache can merge the
  // new state. Only identity and the changed fields are meaningful; the rest is
  // filled with placeholders because the write does not refetch the entity.
  rateVideo(id: string, status: SourceLikeStatus): Promise<SourceWatchMeta>
  removeFromHistory(videoId: string): Promise<string>
  // Resolves to a Boolean rather than the created comment: the response carries
  // no parseable comment, and inventing an id would poison the normalized cache.
  // Resolves to the id so the cache can mark just that row read.
  markNotificationRead(id: string): Promise<string>
  postComment(videoId: string, text: string): Promise<boolean>
  replyToComment(actionsToken: string, text: string): Promise<boolean>
  rateComment(actionsToken: string, status: SourceLikeStatus): Promise<SourceComment>
  setSubscribed(channelId: string, subscribed: boolean): Promise<SourceChannel>
  setNotificationLevel(channelId: string, level: SourceNotificationLevel): Promise<SourceChannel>
  addToPlaylist(playlistId: string, videoIds: string[]): Promise<SourcePlaylist>
  // Entries are addressed by their setVideoId, which names the SLOT. Passing
  // plain video ids would be ambiguous for a playlist holding one video twice,
  // and upstream's own helper pays a full browse (plus a continuation per extra
  // page) just to translate them.
  removeFromPlaylist(playlistId: string, setVideoIds: string[]): Promise<SourcePlaylist>
  createPlaylist(title: string, videoIds?: string[], privacy?: SourcePlaylistPrivacy, description?: string): Promise<SourcePlaylist>
  deletePlaylist(id: string): Promise<string>
  renamePlaylist(id: string, title: string): Promise<SourcePlaylist>
  setPlaylistDescription(id: string, description: string): Promise<SourcePlaylist>
  setPlaylistPrivacy(id: string, privacy: SourcePlaylistPrivacy): Promise<SourcePlaylist>
  // `afterSetVideoId` is the entry the moved one lands after; omitting it asks
  // for the first position.
  movePlaylistItem(playlistId: string, setVideoId: string, afterSetVideoId?: string): Promise<SourcePlaylist>
}

export type SourceApi = Omit<Source, 'id'>

// The realm boundaries (app -> frame RPC, GraphQL worker -> source) forward
// calls by name, so they need the method list at runtime. Adding a method to
// `Source` without listing it here fails `SourceMethodsAreExhaustive` below.
export const SOURCE_METHODS = [
  'home',
  'subscriptions',
  'history',
  'subscribedChannels',
  'search',
  'searchSuggestions',
  'video',
  'channel',
  'channelAbout',
  'communityPosts',
  'watch',
  'comments',
  'commentReplies',
  'playlists',
  'playlist',
  'notifications',
  'unseenNotificationCount',
  'session',
  'rateVideo',
  'removeFromHistory',
  'markNotificationRead',
  'postComment',
  'replyToComment',
  'rateComment',
  'setSubscribed',
  'setNotificationLevel',
  'addToPlaylist',
  'removeFromPlaylist',
  'createPlaylist',
  'deletePlaylist',
  'renamePlaylist',
  'setPlaylistDescription',
  'setPlaylistPrivacy',
  'movePlaylistItem',
] as const satisfies readonly (keyof SourceApi)[]

export type SourceMethod = (typeof SOURCE_METHODS)[number]

// Shared with the frame protocol, which guards its own method list the same way.
export type Exhaustive<Unlisted extends never> = Unlisted

// Resolves to `never` while the list is complete; otherwise the unlisted method
// name breaks the constraint and the compiler reports it by name.
export type SourceMethodsAreExhaustive = Exhaustive<Exclude<keyof SourceApi, SourceMethod>>

// Continuation cursors are keys into an in-memory Map inside the frame, so they
// cannot survive an engine restart. The index marks which argument carries one:
// a call that passes it must fail rather than silently replay from the start.
export const SOURCE_CURSOR_ARGUMENT = {
  home: 1,
  subscriptions: 0,
  history: 0,
  // Both moved when their argument lists grew in front of the cursor: search
  // gained `filters` and channel gained `tab`, `sort` and `query`.
  search: 2,
  channel: 4,
  comments: 2,
  commentReplies: 0,
  communityPosts: 1,
  notifications: 0,
  playlists: 0,
  playlist: 1,
} as const satisfies Partial<Record<SourceMethod, number>>

// When the engine dies mid-call, src/sources/runtime.ts rebuilds it and decides
// whether to replay the call. Only an idempotent read is safe to replay:
//
//   always        pure read, replaying it just costs a round trip
//   unless-cursor pure read, but a cursored page cannot be replayed because the
//                 cursor belonged to the frame that died
//   never         a write, replaying it would like or subscribe twice
//
// `satisfies Record<SourceMethod, ...>` makes the classification mandatory, so a
// method added later cannot quietly inherit a permissive default. Every write
// method added for mutations MUST be 'never'.
export const SOURCE_REPLAY = {
  home: 'unless-cursor',
  subscriptions: 'unless-cursor',
  history: 'unless-cursor',
  subscribedChannels: 'always',
  search: 'unless-cursor',
  searchSuggestions: 'always',
  video: 'always',
  channel: 'unless-cursor',
  channelAbout: 'always',
  communityPosts: 'unless-cursor',
  watch: 'always',
  comments: 'unless-cursor',
  commentReplies: 'unless-cursor',
  playlists: 'unless-cursor',
  playlist: 'unless-cursor',
  notifications: 'unless-cursor',
  unseenNotificationCount: 'always',
  session: 'always',
  rateVideo: 'never',
  removeFromHistory: 'never',
  markNotificationRead: 'never',
  postComment: 'never',
  replyToComment: 'never',
  rateComment: 'never',
  setSubscribed: 'never',
  setNotificationLevel: 'never',
  // Every playlist edit is a write. Replaying one after an engine restart adds
  // the same video twice, or creates a second playlist with the same title.
  addToPlaylist: 'never',
  removeFromPlaylist: 'never',
  createPlaylist: 'never',
  deletePlaylist: 'never',
  renamePlaylist: 'never',
  setPlaylistDescription: 'never',
  setPlaylistPrivacy: 'never',
  movePlaylistItem: 'never',
} as const satisfies Record<SourceMethod, 'always' | 'unless-cursor' | 'never'>
