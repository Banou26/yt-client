export type SourceLikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT'

export type SourceNotificationLevel = 'ALL' | 'PERSONALIZED' | 'NONE'

// `SourcePlaylist.privacy` stays a plain string because it echoes whatever the playlist header carries
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
  thumbnailSrcset?: string
  durationSeconds?: number
  viewCount?: string
  publishedText?: string
  isLive?: boolean
  progressPercent?: number
  isUpcoming?: boolean
  isMembersOnly?: boolean
  isShort?: boolean
  badges: string[]
  channel?: SourceChannel
}

export type SourceVideoPage = {
  items: SourceVideo[]
  // Required rather than optional so the compiler names every page builder
  playlists: SourcePlaylist[]
  cursor?: string
}

export type SourceVideoSection = {
  title?: string
  items: SourceVideo[]
}

// Deliberately NOT a SourceVideo: a SourceVideo would need a fabricated title for every slide after the first
export type SourceShort = {
  id: string
  poster?: string
  title?: string
}

export type SourceShortsPage = {
  items: SourceShort[]
  cursor?: string
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

// The tag sits ALONGSIDE the entity's own fields rather than wrapping them, and `kind` is not in the schema
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

export type SourceWatchPlaylist = {
  id: string
  title?: string
  author?: string
  items: SourceVideo[]
  currentIndex?: number
  isInfinite?: boolean
}

export type SourceWatchMeta = {
  id: string
  isLive?: boolean
  concurrentViewers?: number
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
  relatedCursor?: string
  playlist?: SourceWatchPlaylist
}

export type SourceTextRun = {
  text: string
  url?: string
  videoId?: string
  startSeconds?: number
  browseId?: string
}

export type SourceLiveChatMessage = {
  id: string
  author?: SourceChannel
  text: string
  runs: SourceLiveChatRun[]
  timestampText?: string
  isOwner?: boolean
  isModerator?: boolean
  isMember?: boolean
  purchaseAmountText?: string
  headerBackgroundColor?: string
  bodyBackgroundColor?: string
}

export type SourceLiveChatRun = SourceTextRun & {
  emojiUrl?: string
  emojiLabel?: string
}

export type SourceLiveChatPage = {
  items: SourceLiveChatMessage[]
  cursor?: string
  // The client holds the transcript, so a removal has to travel as its own instruction
  removedIds?: string[]
  disabled?: boolean
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
  repliesCursor?: string
  // Opaque handle for this comment's like, dislike and reply endpoints, which cannot be rebuilt from the id
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

// A playlist entry WRAPS its video instead of extending it: `setVideoId` identifies the slot, and the same video can sit in a playlist twice
export type SourcePlaylistItem = {
  video: SourceVideo
  setVideoId?: string
  // 1-BASED, unlike SourceWatchPlaylist.currentIndex and watch()'s playlistIndex
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

// `index` is the identity: youtubei.js switches accounts by `account_index`, which becomes X-Goog-Authuser
export type SourceAccount = {
  index: number
  name?: string
  avatar?: string
  handle?: string
  selected?: boolean
  hasChannel?: boolean
}

export type SourceSession = {
  signedIn: boolean
  name?: string
  avatar?: string
  handle?: string
  accounts: SourceAccount[]
}

export type Source = {
  id: string
  home(chip?: string, cursor?: string): Promise<SourceHomeFeed>
  // There is no Shorts DESTINATION feed to fall back on: `FEshorts` parses to an empty response
  shorts(seed?: string, cursor?: string): Promise<SourceShortsPage>
  subscriptions(cursor?: string): Promise<SourceVideoPage>
  history(cursor?: string): Promise<SourceSectionedVideoPage>
  subscribedChannels(): Promise<SourceChannel[]>
  search(query: string, filters?: SourceSearchFilters, cursor?: string): Promise<SourceSearchPage>
  // Not an InnerTube call: every keystroke that reaches it is a tunneled round trip, so the caller is expected to debounce
  searchSuggestions(query: string, previousQuery?: string): Promise<string[]>
  video(id: string): Promise<SourceVideo | undefined>
  channel(id: string, tab?: SourceChannelTab, sort?: string, query?: string, cursor?: string): Promise<SourceChannelPage>
  channelAbout(id: string): Promise<SourceChannelAbout | undefined>
  communityPosts(channelId: string, cursor?: string): Promise<SourcePostPage>
  // `playlistIndex` is 0-based; the server corrects an out-of-range one, so the honoured position is the one on the result
  watch(id: string, playlistId?: string, playlistIndex?: number): Promise<SourceWatchMeta | undefined>
  comments(videoId: string, sort?: SourceCommentSort, cursor?: string): Promise<SourceCommentPage>
  commentReplies(cursor: string): Promise<SourceCommentPage>
  // Polled rather than streamed: the emitter is kept running and each call drains what it buffered since the previous cursor
  liveChat(videoId: string, cursor?: string): Promise<SourceLiveChatPage>
  relatedVideos(cursor: string): Promise<SourceVideoPage>
  playlists(cursor?: string): Promise<SourcePlaylistListPage>
  playlist(id: string, cursor?: string): Promise<SourcePlaylistPage>
  notifications(cursor?: string): Promise<SourceNotificationPage>
  unseenNotificationCount(): Promise<number>
  session(): Promise<SourceSession>
  // Writes resolve to the affected entity: only identity and the changed fields are meaningful, the rest is placeholders
  rateVideo(id: string, status: SourceLikeStatus): Promise<SourceWatchMeta>
  removeFromHistory(videoId: string): Promise<string>
  markNotificationRead(id: string): Promise<string>
  postComment(videoId: string, text: string): Promise<boolean>
  sendLiveChatMessage(videoId: string, text: string): Promise<boolean>
  replyToComment(actionsToken: string, text: string): Promise<boolean>
  rateComment(actionsToken: string, status: SourceLikeStatus): Promise<SourceComment>
  setSubscribed(channelId: string, subscribed: boolean): Promise<SourceChannel>
  setNotificationLevel(channelId: string, level: SourceNotificationLevel): Promise<SourceChannel>
  addToPlaylist(playlistId: string, videoIds: string[]): Promise<SourcePlaylist>
  removeFromPlaylist(playlistId: string, setVideoIds: string[]): Promise<SourcePlaylist>
  createPlaylist(title: string, videoIds?: string[], privacy?: SourcePlaylistPrivacy, description?: string): Promise<SourcePlaylist>
  deletePlaylist(id: string): Promise<string>
  renamePlaylist(id: string, title: string): Promise<SourcePlaylist>
  setPlaylistDescription(id: string, description: string): Promise<SourcePlaylist>
  setPlaylistPrivacy(id: string, privacy: SourcePlaylistPrivacy): Promise<SourcePlaylist>
  movePlaylistItem(playlistId: string, setVideoId: string, afterSetVideoId?: string): Promise<SourcePlaylist>
}

export type SourceApi = Omit<Source, 'id'>

// The realm boundaries (app -> frame RPC, GraphQL worker -> source) forward calls by name, so they need the method list at runtime
export const SOURCE_METHODS = [
  'home',
  'shorts',
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
  'liveChat',
  'relatedVideos',
  'playlists',
  'playlist',
  'notifications',
  'unseenNotificationCount',
  'session',
  'rateVideo',
  'removeFromHistory',
  'markNotificationRead',
  'postComment',
  'sendLiveChatMessage',
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

export type Exhaustive<Unlisted extends never> = Unlisted

export type SourceMethodsAreExhaustive = Exhaustive<Exclude<keyof SourceApi, SourceMethod>>

// The index marks which argument carries a cursor: a call that passes one must fail rather than silently replay from the start
export const SOURCE_CURSOR_ARGUMENT = {
  home: 1,
  shorts: 1,
  subscriptions: 0,
  history: 0,
  search: 2,
  channel: 4,
  comments: 2,
  commentReplies: 0,
  liveChat: 1,
  relatedVideos: 0,
  communityPosts: 1,
  notifications: 0,
  playlists: 0,
  playlist: 1,
} as const satisfies Partial<Record<SourceMethod, number>>

// src/sources/runtime.ts replays a failed call unless the policy forbids it: every write method MUST be 'never'
export const SOURCE_REPLAY = {
  home: 'unless-cursor',
  shorts: 'unless-cursor',
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
  liveChat: 'unless-cursor',
  relatedVideos: 'unless-cursor',
  playlists: 'unless-cursor',
  playlist: 'unless-cursor',
  notifications: 'unless-cursor',
  unseenNotificationCount: 'always',
  session: 'always',
  rateVideo: 'never',
  removeFromHistory: 'never',
  markNotificationRead: 'never',
  postComment: 'never',
  sendLiveChatMessage: 'never',
  replyToComment: 'never',
  rateComment: 'never',
  setSubscribed: 'never',
  setNotificationLevel: 'never',
  addToPlaylist: 'never',
  removeFromPlaylist: 'never',
  createPlaylist: 'never',
  deletePlaylist: 'never',
  renamePlaylist: 'never',
  setPlaylistDescription: 'never',
  setPlaylistPrivacy: 'never',
  movePlaylistItem: 'never',
} as const satisfies Record<SourceMethod, 'always' | 'unless-cursor' | 'never'>
