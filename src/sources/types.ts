export type SourceLikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT'

export type SourceNotificationLevel = 'ALL' | 'PERSONALIZED' | 'NONE'

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
  watch(id: string): Promise<SourceWatchMeta | undefined>
  comments(videoId: string, cursor?: string): Promise<SourceCommentPage>
  session(): Promise<SourceSession>
  // Writes resolve to the affected entity so the normalized cache can merge the
  // new state. Only identity and the changed fields are meaningful; the rest is
  // filled with placeholders because the write does not refetch the entity.
  rateVideo(id: string, status: SourceLikeStatus): Promise<SourceWatchMeta>
  removeFromHistory(videoId: string): Promise<string>
  setSubscribed(channelId: string, subscribed: boolean): Promise<SourceChannel>
  setNotificationLevel(channelId: string, level: SourceNotificationLevel): Promise<SourceChannel>
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
  'session',
  'rateVideo',
  'removeFromHistory',
  'setSubscribed',
  'setNotificationLevel',
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
  session: 'always',
  rateVideo: 'never',
  removeFromHistory: 'never',
  setSubscribed: 'never',
  setNotificationLevel: 'never',
} as const satisfies Record<SourceMethod, 'always' | 'unless-cursor' | 'never'>
