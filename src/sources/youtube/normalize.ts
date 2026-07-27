import type { SourceChannel, SourceComment, SourceLikeStatus, SourceNotificationLevel, SourcePlaylist, SourcePlaylistItem, SourceSession, SourceVideo, SourceWatchMeta, SourceWatchPlaylist } from '../types'

type Thumbnail = {
  url?: string
  width?: number
}

type Text = {
  text?: string
  toString?: () => string
  endpoint?: { payload?: { browseId?: string } }
}

type Author = {
  id?: string
  name?: string
  thumbnails?: Thumbnail[]
  url?: string
  is_verified?: boolean
}

type FeedVideo = {
  id?: string
  video_id?: string
  title?: string | Text
  description?: string
  description_snippet?: Text
  thumbnails?: Thumbnail[]
  best_thumbnail?: Thumbnail
  duration?: { seconds?: number }
  length_text?: Text
  view_count?: Text
  short_view_count?: Text
  published?: Text
  author?: Author
  is_live?: boolean
  is_upcoming?: boolean
  badges?: { label?: string, text?: string, style?: string }[]
  thumbnail_overlays?: unknown[]
}

type VideoDetails = {
  id?: string
  title?: string
  short_description?: string
  duration?: number
  view_count?: number
  channel_id?: string
  author?: string
  thumbnail?: Thumbnail[]
  is_live?: boolean
}

type MetadataParts = {
  metadata_rows?: {
    metadata_parts?: { text?: Text }[]
  }[]
}

type ChannelHeader = {
  author?: { thumbnails?: Thumbnail[] }
  banner?: Thumbnail[]
  subscribers?: Text
  videos_count?: Text
  channel_handle?: Text
  content?: {
    banner?: { image?: Thumbnail[] }
    image?: { image?: Thumbnail[], avatar?: { image?: Thumbnail[] } }
    metadata?: MetadataParts
    description?: { description?: Text }
  }
}

type ChannelDetails = {
  header?: ChannelHeader
  metadata?: {
    external_id?: string
    title?: string
    description?: string
    avatar?: Thumbnail[]
    thumbnail?: Thumbnail[]
  }
  subscribe_button?: {
    subscribed?: boolean
    notification_preference_button?: { current_state_id?: string | number }
  }
}

type WatchNextMemo = {
  get(type: string): unknown[] | undefined
}

type WatchNextResponse = {
  contents_memo?: WatchNextMemo
}

type LockupVideo = {
  content_id?: string
  content_type?: string
  content_image?: {
    image?: Thumbnail[]
    overlays?: { badges?: { text?: string, badge_style?: string }[], progress_bar?: { start_percent?: number } }[]
    primary_thumbnail?: {
      image?: Thumbnail[]
      overlays?: { badges?: { text?: string, badge_style?: string }[], progress_bar?: { start_percent?: number } }[]
    }
  }
  metadata?: {
    title?: Text
    image?: {
      avatar?: { image?: Thumbnail[] }
      renderer_context?: { command_context?: { on_tap?: { payload?: { browseId?: string } } } }
    }
    metadata?: MetadataParts
  }
}

type PlaylistVideoNode = FeedVideo & {
  index?: Text
  set_video_id?: string
  video_info?: Text
  style?: string
}

// GridPlaylist and the legacy Playlist node share every field this reads. They
// differ only in `author`: GridPlaylist always builds an Author, while Playlist
// hands back a bare Text byline when the response carries a simple one.
type GridPlaylistNode = {
  id?: string
  title?: string | Text
  thumbnails?: Thumbnail[]
  sidebar_thumbnails?: Thumbnail[]
  video_count?: Text
  video_count_short?: Text
  author?: Author | Text
}

// The queue row on a watch page. It shares almost nothing with a feed video:
// `thumbnail` is singular in NAME but holds the whole array (youtubei.js builds
// it from `data.thumbnail` through Thumbnail.fromResponse), the duration is
// pre-parsed rather than a length badge, and the byline is a plain string with
// no channel id anywhere on the node.
type PlaylistPanelVideoNode = {
  video_id?: string
  title?: Text
  thumbnail?: Thumbnail[]
  duration?: { text?: string, seconds?: number }
  author?: string
  selected?: boolean
  set_video_id?: string
  // PlaylistPanelVideoWrapper, the YouTube Music shape, keeps the real row here.
  primary?: PlaylistPanelVideoNode
}

// TwoColumnWatchNextResults hand-flattens the raw playlist panel into a plain
// object rather than instantiating a node, so this is the complete field set:
// totalVideos, isCourse and isEditable are dropped before we ever see them.
type WatchNextPlaylistPanel = {
  id?: string
  title?: string
  author?: Author | Text
  contents?: unknown[]
  current_index?: number
  is_infinite?: boolean
}

type PlaylistDetails = {
  info?: {
    title?: string
    description?: string
    author?: Author
    thumbnails?: Thumbnail[]
    total_items?: string
    views?: string
    last_updated?: string
    privacy?: string
    is_editable?: boolean
    can_delete?: boolean
    can_reorder?: boolean
  }
}

type AccountInfo = {
  contents?: {
    account_name?: Text
    account_photo?: Thumbnail[]
    channel_handle?: Text
  }
}

type CommentThread = {
  comment?: {
    comment_id?: string
    content?: Text
    published_time?: string
    like_count?: string
    reply_count?: string
    is_pinned?: boolean
    is_hearted?: boolean
    author?: Author
  }
}

const text = (value: string | Text | undefined) => {
  if (typeof value === 'string') return value
  if (value?.text) return value.text
  return value?.toString?.()
}

// youtubei.js Text instances stringify empty values as 'N/A': treat that as absent.
const presentText = (value: string | Text | undefined) => {
  const result = text(value)
  return result === 'N/A' ? undefined : result
}

const thumbnail = (items: Thumbnail[] | undefined) =>
  items
    ?.filter((item): item is Thumbnail & { url: string } => Boolean(item.url))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
    ?.url

const durationSeconds = (value: string | undefined) => {
  const parts = value?.split(':').map(Number)
  if (!parts?.length || parts.some((part) => !Number.isFinite(part))) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const duration = (video: FeedVideo) => {
  if (Number.isFinite(video.duration?.seconds)) return video.duration?.seconds
  return durationSeconds(text(video.length_text))
}

const approximateCount = (value: string | undefined) => {
  const match = value?.replaceAll(',', '').match(/^([\d.]+)\s*([KMB])?/i)
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base)) return undefined
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() ?? ''] ?? 1
  return Math.round(base * scale)
}

const handleFromUrl = (url: string | undefined) => url?.match(/\/(@[^/?#]+)/)?.[1]

const LIKE_STATUSES: SourceLikeStatus[] = ['LIKE', 'DISLIKE', 'INDIFFERENT']

const likeStatus = (value: unknown): SourceLikeStatus | undefined =>
  LIKE_STATUSES.find((status) => status === value)

const NOTIFICATION_LEVELS: SourceNotificationLevel[] = ['ALL', 'PERSONALIZED', 'NONE']

// The toggle reports its state as a style id like
// 'STATE_SUBSCRIBE_NOTIFICATION_PREFERENCE_PERSONALIZED'; only the tail is
// meaningful and the vocabulary changes, so an unknown value reads as absent
// rather than as NONE (which the bell would render as "notifications off").
const notificationLevel = (value: unknown): SourceNotificationLevel | undefined => {
  if (typeof value !== 'string') return undefined
  const upper = value.toUpperCase()
  return NOTIFICATION_LEVELS.find((level) => upper.endsWith(level))
}

const metadataTexts = (metadata: MetadataParts | undefined) =>
  metadata?.metadata_rows
    ?.flatMap((row) => row.metadata_parts ?? [])
    .map((part) => text(part.text))
    .filter((value): value is string => Boolean(value))
    ?? []

// youtubei.js's Author fills BOTH id and name with the literal 'N/A' when the
// node carries no byline (PlaylistVideo builds one unconditionally), so an
// absent author otherwise reads as a real channel and renders a dead link.
const authorChannel = (author: Author | undefined): SourceChannel | undefined => {
  const id = presentText(author?.id)
  const name = presentText(author?.name)
  if (!id || !name) return undefined
  return {
    id,
    name,
    avatar: thumbnail(author?.thumbnails),
    handle: handleFromUrl(author?.url),
    isVerified: author?.is_verified === true ? true : undefined,
  }
}

// Upstream's own localized badge texts, taken from `label` rather than the
// style id: the style vocabulary is internal and changes, while the label is
// what YouTube itself renders on the card. An unrecognized badge still shows.
const badgeTexts = (badges: { label?: string, text?: string }[] | undefined) =>
  (badges ?? [])
    .map((badge) => presentText(badge.label) ?? presentText(badge.text))
    .filter((value): value is string => Boolean(value))

// Both are badge-derived. Members-only is matched on the style id because its
// label is a whole localized sentence, while upcoming has a real getter on the
// legacy node and only needs the badge as a fallback.
const hasBadgeStyle = (badges: { style?: string }[] | undefined, fragment: string) =>
  (badges ?? []).some((badge) => badge.style?.includes(fragment))

// A playlist byline is an Author on some renderers and a plain Text on others.
// Only the Author shape has an `id`; a Text keeps the channel id on its
// endpoint. Both paths read a named field rather than stringifying the node,
// because an Author has no `text` and would otherwise fall through as the
// literal '[object Object]'.
const bylineChannel = (author: Author | Text | undefined): SourceChannel | undefined => {
  const fromAuthor = authorChannel(author as Author | undefined)
  if (fromAuthor) return fromAuthor
  const byline = author as Text | undefined
  const id = byline?.endpoint?.payload?.browseId
  const name = presentText(byline?.text)
  return id && name ? { id, name } : undefined
}

const lockupParts = (lockup: LockupVideo) =>
  lockup.metadata?.metadata?.metadata_rows
    ?.flatMap((row) => row.metadata_parts ?? [])
    .map((part) => part.text)
    ?? []

// The first metadata part is the channel; its id rides on that part's endpoint,
// falling back to the avatar's tap target when the part carries no link.
const lockupChannel = (lockup: LockupVideo, parts: (Text | undefined)[]): SourceChannel | undefined => {
  const name = text(parts[0])
  const id = parts[0]?.endpoint?.payload?.browseId
    ?? lockup.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId
  if (!id || !name) return undefined
  return { id, name, avatar: thumbnail(lockup.metadata?.image?.avatar?.image) }
}

export const normalizeChannel = (input: unknown, fallbackId?: string): SourceChannel => {
  const channel = input as ChannelDetails
  const id = channel.metadata?.external_id ?? fallbackId
  if (!id) throw new Error('youtube: channel response has no id')
  const header = channel.header
  const view = header?.content
  const parts = metadataTexts(view?.metadata)
  const handle = text(header?.channel_handle) ?? parts.find((part) => part.startsWith('@'))
  const details = parts.filter((part) => part !== handle)
  return {
    id,
    name: channel.metadata?.title ?? id,
    avatar: thumbnail(channel.metadata?.avatar ?? channel.metadata?.thumbnail)
      ?? thumbnail(header?.author?.thumbnails)
      ?? thumbnail(view?.image?.avatar?.image ?? view?.image?.image),
    handle,
    subscriberCountText: text(header?.subscribers) ?? details[0],
    videoCountText: text(header?.videos_count) ?? details[1],
    banner: thumbnail(header?.banner) ?? thumbnail(view?.banner?.image),
    description: channel.metadata?.description ?? text(view?.description?.description),
    isSubscribed: channel.subscribe_button?.subscribed,
    notificationLevel: notificationLevel(channel.subscribe_button?.notification_preference_button?.current_state_id),
  }
}

// The subscribed-channel rail comes back as GridChannel/Channel nodes, which
// carry their id on `author`/`id` rather than the `metadata.external_id` shape
// normalizeChannel expects off a browse response.
export const normalizeFeedChannel = (input: unknown): SourceChannel | undefined => {
  const node = input as {
    id?: string
    author?: Author
    subscribers?: Text
    video_count?: Text
  }
  const id = node.author?.id ?? node.id
  const name = node.author?.name
  if (!id || !name) return undefined
  return {
    id,
    name,
    avatar: thumbnail(node.author?.thumbnails),
    handle: handleFromUrl(node.author?.url),
    subscriberCountText: presentText(node.subscribers),
    videoCountText: presentText(node.video_count),
  }
}

// A search Channel node is neither of the shapes the other two channel
// normalizers handle: it keeps its id at the top level and its name on an
// Author, where normalizeChannel wants a browse response's
// `metadata.external_id` (and throws without one) and normalizeFeedChannel
// wants the id on the Author. Verified against parser/classes/Channel.d.ts.
export const normalizeSearchChannel = (input: unknown): SourceChannel | undefined => {
  const node = input as {
    id?: string
    author?: Author
    subscriber_count?: Text
    video_count?: Text
    description_snippet?: Text
    subscribe_button?: { subscribed?: boolean }
  }
  const id = node.id ?? presentText(node.author?.id)
  const name = presentText(node.author?.name)
  if (!id || !name) return undefined
  // The two count fields are MISNAMED on this node and reading them literally
  // renders the handle twice. YouTube repurposed the renderer's slots and
  // youtubei.js kept the original property names, flagging it in its own source
  // (parser/classes/Channel.js:25): `subscriberCountText` now carries the
  // handle and `videoCountText` carries the subscriber count. A video count is
  // simply not on this node, so it stays absent rather than being invented.
  const handle = handleFromUrl(node.author?.url) ?? presentText(node.subscriber_count)
  return {
    id,
    name,
    avatar: thumbnail(node.author?.thumbnails),
    handle: handle?.startsWith('@') ? handle : undefined,
    subscriberCountText: presentText(node.video_count),
    description: presentText(node.description_snippet),
    isSubscribed: node.subscribe_button?.subscribed,
    isVerified: node.author?.is_verified === true ? true : undefined,
  }
}

const clampPercent = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined

// The watched fraction reaches us two different ways and both are live: legacy
// Video nodes hang a ThumbnailOverlayResumePlayback off `thumbnail_overlays`
// with `percent_duration_watched`, while LockupView nodes carry a
// ThumbnailBottomOverlayView on the image whose progress bar reports
// `start_percent`. History and home mix the two node kinds, so reading only one
// shape leaves the resume bar missing from half the page.
const legacyProgressPercent = (input: unknown) => {
  const overlays = (input as { thumbnail_overlays?: { percent_duration_watched?: number }[] }).thumbnail_overlays ?? []
  return overlays.map((overlay) => clampPercent(overlay.percent_duration_watched)).find((value) => value !== undefined)
}

const lockupProgressPercent = (image: {
  overlays?: { progress_bar?: { start_percent?: number } }[]
} | undefined) =>
  (image?.overlays ?? []).map((overlay) => clampPercent(overlay.progress_bar?.start_percent)).find((value) => value !== undefined)

export const normalizeFeedVideo = (input: unknown): SourceVideo | undefined => {
  const video = input as FeedVideo
  const id = video.video_id ?? video.id
  const title = text(video.title)
  if (!id || !title) return undefined
  return {
    id,
    title,
    description: video.description ?? text(video.description_snippet),
    descriptionSnippet: text(video.description_snippet),
    thumbnail: video.best_thumbnail?.url ?? thumbnail(video.thumbnails),
    durationSeconds: duration(video),
    viewCount: text(video.short_view_count ?? video.view_count),
    publishedText: text(video.published),
    isLive: video.is_live === true ? true : undefined,
    progressPercent: legacyProgressPercent(video),
    isUpcoming: video.is_upcoming === true ? true : undefined,
    isMembersOnly: hasBadgeStyle(video.badges, 'MEMBERS_ONLY') ? true : undefined,
    badges: badgeTexts(video.badges),
    channel: authorChannel(video.author),
  }
}

// A live gap rather than a missing feature: Feed.videos includes
// ShortsLockupView, but that node carries NEITHER `video_id` nor `id`, so
// normalizeFeedVideo returned undefined for every Short and each one was
// silently dropped from home, subscriptions and channel feeds. The id lives on
// the tap endpoint (a reel watch endpoint), with entity_id as the fallback.
export const normalizeShortsLockup = (input: unknown): SourceVideo | undefined => {
  const node = input as {
    entity_id?: string
    thumbnail?: Thumbnail[]
    on_tap_endpoint?: { payload?: { videoId?: string } }
    overlay_metadata?: { primary_text?: Text, secondary_text?: Text }
    accessibility_text?: string
    badge?: { label?: string, text?: string }
  } | undefined
  const id = node?.on_tap_endpoint?.payload?.videoId ?? node?.entity_id
  // The overlay title is the only title a Short carries; the accessibility text
  // is a whole sentence ('Title, 1.2M views') and is used only as a last resort.
  const title = presentText(node?.overlay_metadata?.primary_text) ?? node?.accessibility_text
  if (!id || !title) return undefined
  return {
    id,
    title,
    thumbnail: thumbnail(node?.thumbnail),
    // Shorts carry no length anywhere on this node, and inventing one would put
    // a duration badge on a card that should not have one.
    viewCount: presentText(node?.overlay_metadata?.secondary_text),
    isShort: true,
    badges: badgeTexts(node?.badge ? [node.badge] : undefined),
  }
}

export const normalizeVideoDetails = (input: unknown): SourceVideo | undefined => {
  const video = input as VideoDetails
  if (!video.id || !video.title) return undefined
  return {
    id: video.id,
    title: video.title,
    description: video.short_description,
    thumbnail: thumbnail(video.thumbnail),
    durationSeconds: video.duration,
    viewCount: video.view_count === undefined ? undefined : String(video.view_count),
    isLive: video.is_live === true ? true : undefined,
    // /player's basic_info carries no badge list, so this is genuinely empty
    // rather than unread.
    badges: [],
    channel: video.channel_id && video.author
      ? { id: video.channel_id, name: video.author }
      : undefined,
  }
}

// One lockup renderer fronts every kind of content. The watchable kinds all
// normalize as a video (a Short and a clip both play through /watch), while the
// collection kinds have their own normalizers and must never be forced through
// this one. An absent content_type means UNSPECIFIED, which older responses use
// for ordinary videos. Rejecting by an explicit list rather than by "not VIDEO"
// is what lets a playlist lockup reach normalizePlaylistLockup instead of being
// swallowed here.
const VIDEO_LOCKUPS = new Set(['UNSPECIFIED', 'VIDEO', 'SHORT', 'CLIP', 'MOVIE'])

export const normalizeLockupVideo = (input: unknown): SourceVideo | undefined => {
  const lockup = input as LockupVideo
  if (!VIDEO_LOCKUPS.has(lockup.content_type ?? 'UNSPECIFIED')) return undefined
  const id = lockup.content_id
  const title = text(lockup.metadata?.title)
  if (!id || !title) return undefined
  const image = lockup.content_image?.primary_thumbnail ?? lockup.content_image
  const badges = image?.overlays?.flatMap((overlay) => overlay.badges ?? []) ?? []
  const parts = lockupParts(lockup)
  return {
    id,
    title,
    thumbnail: thumbnail(image?.image),
    durationSeconds: badges
      .map((badge) => durationSeconds(badge.text))
      .find((seconds) => seconds !== undefined),
    viewCount: text(parts[1]),
    publishedText: text(parts[2]),
    isLive: badges.some((badge) => badge.badge_style?.includes('LIVE')) ? true : undefined,
    progressPercent: lockupProgressPercent(image),
    isShort: lockup.content_type === 'SHORT' ? true : undefined,
    isMembersOnly: hasBadgeStyle(badges.map((badge) => ({ style: badge.badge_style })), 'MEMBERS_ONLY')
      ? true
      : undefined,
    // The overlay badges on a lockup carry the DURATION and the live pill, both
    // of which are already read above as their own fields. Re-listing them here
    // would render '12:04' as if it were a 4K or CC badge.
    badges: [],
    channel: lockupChannel(lockup, parts),
  }
}

export const normalizePlaylistLockup = (input: unknown): SourcePlaylist | undefined => {
  const lockup = input as LockupVideo
  if (lockup.content_type !== 'PLAYLIST') return undefined
  const id = lockup.content_id
  const title = presentText(lockup.metadata?.title)
  if (!id || !title) return undefined
  // A playlist lockup wraps its image in a CollectionThumbnailView, which owns
  // no overlays of its own: the badge carrying "50 videos" sits one hop deeper
  // than on a video lockup, where content_image IS the ThumbnailView. Reading
  // content_image.overlays here yields undefined rather than an error, so the
  // count would silently go missing.
  const image = lockup.content_image?.primary_thumbnail ?? lockup.content_image
  const badges = image?.overlays?.flatMap((overlay) => overlay.badges ?? []) ?? []
  const parts = lockupParts(lockup)
  return {
    id,
    title,
    thumbnail: thumbnail(image?.image),
    // Only the badge is read for the count. The metadata rows carry a localized
    // mix of counts and update dates with nothing to tell them apart, so
    // picking one would be a guess that renders "Updated today" as a count.
    videoCountText: badges.map((badge) => badge.text).find((value) => Boolean(value)),
    channel: lockupChannel(lockup, parts),
  }
}

export const normalizeGridPlaylist = (input: unknown): SourcePlaylist | undefined => {
  const node = input as GridPlaylistNode
  const id = node.id
  const title = presentText(node.title)
  if (!id || !title) return undefined
  return {
    id,
    title,
    thumbnail: thumbnail(node.thumbnails) ?? thumbnail(node.sidebar_thumbnails),
    // `video_count` is the long form ("50 videos"); the short one is the bare
    // number, which only reads correctly next to a label the card supplies.
    videoCountText: presentText(node.video_count) ?? presentText(node.video_count_short),
    channel: bylineChannel(node.author),
  }
}

// The playlist id is nowhere in `info`, on any renderer, so the caller has to
// carry the id it browsed with. A continuation page degrades every other field
// too (no header, no sidebar), which is why the page assembly reuses the
// playlist read from the first page instead of re-reading it per page.
export const normalizePlaylistDetails = (input: unknown, id: string): SourcePlaylist => {
  const info = (input as PlaylistDetails).info
  return {
    id,
    title: presentText(info?.title) ?? id,
    description: presentText(info?.description),
    thumbnail: thumbnail(info?.thumbnails),
    // The three stats stringify to 'N/A' when the sidebar is absent, so they go
    // through presentText rather than being surfaced as literal text.
    videoCountText: presentText(info?.total_items),
    viewCountText: presentText(info?.views),
    updatedText: presentText(info?.last_updated),
    privacy: info?.privacy,
    isEditable: info?.is_editable,
    canDelete: info?.can_delete,
    canReorder: info?.can_reorder,
    channel: authorChannel(info?.author),
  }
}

// PlaylistVideo fuses the view count and the upload date into one `video_info`
// line instead of the separate fields a feed video carries. The bullet is what
// the renderer emits under any hl, so splitting on it beats leaving the whole
// string in one field.
const videoInfoParts = (value: Text | undefined) =>
  presentText(value)?.split('•').map((part) => part.trim()).filter((part) => part.length > 0) ?? []

export const normalizePlaylistItem = (input: unknown): SourcePlaylistItem | undefined => {
  const node = input as PlaylistVideoNode
  // A playlist page also carries a recommended-videos rail built from the same
  // renderer. Those entries are not in the playlist and have no setVideoId, so
  // a remove or reorder against one would fail.
  if (node.style === 'PLAYLIST_VIDEO_RENDERER_STYLE_RECOMMENDED_VIDEO') return undefined
  const video = normalizeFeedVideo(node)
  if (!video) return undefined
  const parts = videoInfoParts(node.video_info)
  // 1-based, as YouTube numbers the rows.
  const index = Number(presentText(node.index))
  return {
    video: {
      ...video,
      viewCount: video.viewCount ?? parts[0],
      publishedText: video.publishedText ?? parts[1],
    },
    setVideoId: node.set_video_id,
    index: Number.isInteger(index) ? index : undefined,
  }
}

// The panel byline is an Author for a real playlist and a Text for a mix. Only
// the Author path has a name field, and Author defines no toString, so the Text
// branch is taken ONLY when the node really carries one: falling through to
// presentText on an Author would stringify it to the literal '[object Object]',
// which survives the 'N/A' filter and renders as the queue's byline. Author
// fills `name` with 'N/A' whenever the byline node is empty, which is exactly
// when that fallthrough used to happen.
const bylineText = (author: Author | Text | undefined) => {
  const named = presentText((author as Author | undefined)?.name)
  if (named) return named
  const node = author as Text | undefined
  return typeof node?.text === 'string' ? presentText(node) : undefined
}

export const normalizePlaylistPanelVideo = (input: unknown): SourceVideo | undefined => {
  // Three node kinds share the queue array. PlaylistPanelVideoWrapper keeps the
  // row on `primary`, and AutomixPreviewVideo (the mix teaser tail) carries no
  // video at all, so it falls out on the id check rather than needing its own
  // branch.
  const node = input as PlaylistPanelVideoNode | undefined
  const row = node?.primary ?? node
  const id = row?.video_id
  const title = presentText(row?.title)
  if (!id || !title) return undefined
  return {
    id,
    title,
    thumbnail: thumbnail(row?.thumbnail),
    // Already in seconds, but it comes from parsing 'N/A' when the row carries
    // no length, which yields NaN rather than an absent value.
    durationSeconds: Number.isFinite(row?.duration?.seconds) ? row?.duration?.seconds : undefined,
    badges: [],
    // No channel: the row's byline is display text and the node carries no
    // channel id on any field, so a Channel built from it would link nowhere.
  }
}

export const normalizeWatchPlaylist = (input: unknown): SourceWatchPlaylist | undefined => {
  const panel = input as WatchNextPlaylistPanel | undefined
  const id = panel?.id
  if (!id) return undefined
  return {
    id,
    title: presentText(panel?.title),
    author: bylineText(panel?.author),
    items: (panel?.contents ?? [])
      .map(normalizePlaylistPanelVideo)
      .filter((video) => video !== undefined),
    // 0-based, so 0 is a real position and must survive the guard.
    currentIndex: Number.isInteger(panel?.current_index) ? panel?.current_index : undefined,
    isInfinite: panel?.is_infinite,
  }
}

export const normalizeWatchMeta = (input: unknown, id: string): SourceWatchMeta | undefined => {
  const memo = (input as WatchNextResponse | undefined)?.contents_memo
  if (!memo) return undefined
  const first = (type: string) => memo.get(type)?.[0]
  const primary = first('VideoPrimaryInfo') as {
    title?: Text
    view_count?: { view_count?: Text, short_view_count?: Text }
    published?: Text
    relative_date?: Text
  } | undefined
  const secondary = first('VideoSecondaryInfo') as {
    owner?: { subscriber_count?: Text, author?: Author }
    description?: Text
  } | undefined
  const likeView = first('SegmentedLikeDislikeButtonView') as {
    like_count?: number
    short_like_count?: string
  } | undefined
  const likeLegacy = first('SegmentedLikeDislikeButton') as {
    like_button?: { like_count?: number, short_like_count?: string, is_toggled?: boolean }
    dislike_button?: { is_toggled?: boolean }
  } | undefined
  const likeButtonView = first('LikeButtonView') as {
    like_status_entity?: { like_status?: string }
    like_status?: string
  } | undefined
  const subscribeButton = first('SubscribeButton') as {
    subscribed?: boolean
    notification_preference_button?: {
      current_state_id?: string | number
      states?: { state_id?: string | number, id?: string | number }[]
    }
  } | undefined
  const commentsHeader = first('CommentsEntryPointHeader') as {
    comment_count?: Text
  } | undefined
  // The queue panel IS in contents_memo, unlike player_overlays: the parser
  // builds TwoColumnWatchNextResults inside the window where the memo is live,
  // and that constructor parses the panel rows synchronously, so both the
  // container and every PlaylistPanelVideo land in it. The container is read
  // rather than memo.get('PlaylistPanelVideo') because the id, title, byline
  // and current index exist nowhere else, and the flat memo key over-collects
  // the counterparts nested inside a wrapper.
  const watchNext = first('TwoColumnWatchNextResults') as {
    playlist?: unknown
  } | undefined
  const owner = secondary?.owner
  const author = owner?.author
  const likeCount = likeView?.short_like_count
    ?? likeLegacy?.like_button?.short_like_count
    ?? [likeView?.like_count ?? likeLegacy?.like_button?.like_count]
      .filter((count): count is number => Number.isFinite(count))
      .map(String)[0]
  const related = [
    ...(memo.get('CompactVideo') ?? []).map(normalizeFeedVideo),
    ...(memo.get('LockupView') ?? []).map(normalizeLockupVideo),
  ].filter((video) => video !== undefined)
  // The modern LikeButtonView carries the signed-in state directly; the legacy
  // segmented button only exposes it as a pair of toggles. Without this a user
  // who already liked a video sees an unlit button and un-likes it by clicking.
  const status = likeStatus(likeButtonView?.like_status_entity?.like_status ?? likeButtonView?.like_status)
    ?? (likeLegacy?.like_button?.is_toggled === true
      ? 'LIKE'
      : likeLegacy?.dislike_button?.is_toggled === true ? 'DISLIKE' : undefined)
  const bell = subscribeButton?.notification_preference_button
  return {
    id,
    title: text(primary?.title),
    viewCountText: text(primary?.view_count?.view_count ?? primary?.view_count?.short_view_count),
    publishedDateText: text(primary?.published) ?? text(primary?.relative_date),
    likeCountText: likeCount,
    commentCountText: text(commentsHeader?.comment_count),
    description: text(secondary?.description),
    likeStatus: status,
    channel: author?.id && author.name
      ? {
          id: author.id,
          name: author.name,
          avatar: thumbnail(author.thumbnails),
          handle: handleFromUrl(author.url),
          subscriberCountText: text(owner?.subscriber_count),
          isSubscribed: subscribeButton?.subscribed,
          notificationLevel: notificationLevel(
            bell?.current_state_id ?? bell?.states?.find((state) => state.id === bell.current_state_id)?.state_id,
          ),
        }
      : undefined,
    related,
    playlist: normalizeWatchPlaylist(watchNext?.playlist),
  }
}

export const normalizeSession = (input: unknown): SourceSession => {
  const account = (input as AccountInfo).contents
  return {
    signedIn: true,
    name: presentText(account?.account_name),
    avatar: thumbnail(account?.account_photo),
    handle: presentText(account?.channel_handle),
  }
}

export const normalizeCommentThread = (input: unknown): SourceComment | undefined => {
  const comment = (input as CommentThread).comment
  if (!comment?.comment_id) return undefined
  return {
    id: comment.comment_id,
    author: comment.author?.id && comment.author.name
      ? {
          id: comment.author.id,
          name: comment.author.name,
          avatar: thumbnail(comment.author.thumbnails),
          handle: handleFromUrl(comment.author.url) ?? (comment.author.name.startsWith('@') ? comment.author.name : undefined),
        }
      : undefined,
    text: text(comment.content) ?? '',
    publishedText: comment.published_time,
    likeCountText: comment.like_count,
    replyCount: approximateCount(comment.reply_count),
    isPinned: comment.is_pinned === true ? true : undefined,
    isHearted: comment.is_hearted === true ? true : undefined,
  }
}
