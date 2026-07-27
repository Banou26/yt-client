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

export type SourceHomeFeed = {
  items: SourceVideo[]
  chips: SourceFeedChip[]
  cursor?: string
}

export type SourceChannelPage = {
  channel: SourceChannel
  videos: SourceVideoPage
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
  likeStatus?: SourceLikeStatus
  channel?: SourceChannel
  related: SourceVideo[]
  playlist?: SourceWatchPlaylist
}

export type SourceComment = {
  id: string
  author?: SourceChannel
  text: string
  publishedText?: string
  likeCountText?: string
  replyCount?: number
  isPinned?: boolean
  isHearted?: boolean
}

export type SourceCommentPage = {
  items: SourceComment[]
  cursor?: string
  disabled?: boolean
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
  search(query: string, cursor?: string): Promise<SourceVideoPage>
  video(id: string): Promise<SourceVideo | undefined>
  channel(id: string, cursor?: string): Promise<SourceChannelPage>
  // Passing a playlist puts the video in a queue, and the same call then also
  // brings back the panel. `playlistIndex` is 0-based; the server corrects an
  // out-of-range one, so the honoured position is the one on the result.
  watch(id: string, playlistId?: string, playlistIndex?: number): Promise<SourceWatchMeta | undefined>
  comments(videoId: string, cursor?: string): Promise<SourceCommentPage>
  // The library aggregation is signed-in only; a single playlist is not, so a
  // public one opens anonymously.
  playlists(cursor?: string): Promise<SourcePlaylistListPage>
  playlist(id: string, cursor?: string): Promise<SourcePlaylistPage>
  session(): Promise<SourceSession>
  // Writes resolve to the affected entity so the normalized cache can merge the
  // new state. Only identity and the changed fields are meaningful; the rest is
  // filled with placeholders because the write does not refetch the entity.
  rateVideo(id: string, status: SourceLikeStatus): Promise<SourceWatchMeta>
  removeFromHistory(videoId: string): Promise<string>
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
  'video',
  'channel',
  'watch',
  'comments',
  'playlists',
  'playlist',
  'session',
  'rateVideo',
  'removeFromHistory',
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
  search: 1,
  channel: 1,
  comments: 1,
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
  video: 'always',
  channel: 'unless-cursor',
  watch: 'always',
  comments: 'unless-cursor',
  playlists: 'unless-cursor',
  playlist: 'unless-cursor',
  session: 'always',
  rateVideo: 'never',
  removeFromHistory: 'never',
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
