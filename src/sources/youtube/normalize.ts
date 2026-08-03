import type { SourceChannel, SourceChannelAbout, SourceNotification, SourceTextRun, SourceComment, SourceLikeStatus, SourceLiveChatMessage, SourceLiveChatRun, SourcePost, SourceNotificationLevel, SourcePlaylist, SourcePlaylistItem, SourceSession, SourceVideo, SourceWatchMeta, SourceWatchPlaylist } from '../types'

type Thumbnail = {
  url?: string
  width?: number
}

type Text = {
  text?: string
  toString?: () => string
  endpoint?: { payload?: { browseId?: string } }
  runs?: RunNode[]
}

type RunNode = {
  text?: string
  endpoint?: {
    payload?: {
      url?: string
      videoId?: string
      startTimeSeconds?: number
      browseId?: string
    }
  }
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

type GridPlaylistNode = {
  id?: string
  title?: string | Text
  thumbnails?: Thumbnail[]
  sidebar_thumbnails?: Thumbnail[]
  thumbnail_renderer?: { thumbnail?: Thumbnail[] }
  video_count?: Text
  video_count_short?: Text
  author?: Author | Text
}

type PlaylistPanelVideoNode = {
  video_id?: string
  title?: Text
  thumbnail?: Thumbnail[]
  duration?: { text?: string, seconds?: number }
  author?: string
  selected?: boolean
  set_video_id?: string
  primary?: PlaylistPanelVideoNode
}

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

type AccountItemNode = {
  account_name?: Text
  account_photo?: Thumbnail[]
  channel_handle?: Text
  is_selected?: boolean
  has_channel?: boolean
}

type AccountInfo = {
  contents?: {
    contents?: AccountItemNode[]
  }
}

type CommentViewNode = {
  comment_id?: string
  content?: Text
  published_time?: string
  like_count?: string
  reply_count?: string
  is_pinned?: boolean
  is_hearted?: boolean
  is_liked?: boolean
  is_disliked?: boolean
  author_is_channel_owner?: boolean
  is_member?: boolean
  author?: Author
}

type CommentThread = {
  comment?: CommentViewNode
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

// `minWidth` is the narrowest candidate that covers the slot at 2x; omitting it takes the widest
const thumbnail = (items: Thumbnail[] | undefined, minWidth?: number) => {
  const sorted = items
    ?.filter((item): item is Thumbnail & { url: string } => Boolean(item.url))
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  if (!sorted?.length) return undefined
  const covering = minWidth === undefined
    ? undefined
    : sorted.find((item) => (item.width ?? 0) >= minWidth)
  return (covering ?? sorted[sorted.length - 1])?.url
}

// only widths upstream actually published are listed: a fabricated entry is a broken image
const srcset = (items: Thumbnail[] | undefined) => {
  const described = items?.filter(
    (item): item is Thumbnail & { url: string, width: number } =>
      Boolean(item.url) && Number.isFinite(item.width) && (item.width ?? 0) > 0,
  )
  if (!described || described.length < 2) return undefined
  // deduped by width: upstream publishes the same size more than once, and a repeated descriptor is invalid
  const byWidth = new Map(described.map((item) => [item.width, item.url]))
  return [...byWidth]
    .sort((a, b) => a[0] - b[0])
    .map(([width, url]) => `${url} ${width}w`)
    .join(', ')
}

// a channel photo renders at 80px at most, so 160 covers it at 2x
const AVATAR_WIDTH = 160

// a grid card is roughly 360px wide, so 720 covers it at 2x
const STILL_WIDTH = 720

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

// the state arrives as a style id whose tail is the level; an unknown one reads as absent, never as NONE
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

const authorChannel = (author: Author | undefined): SourceChannel | undefined => {
  const id = presentText(author?.id)
  const name = presentText(author?.name)
  if (!id || !name) return undefined
  return {
    id,
    name,
    avatar: thumbnail(author?.thumbnails, AVATAR_WIDTH),
    handle: handleFromUrl(author?.url),
    isVerified: author?.is_verified === true ? true : undefined,
  }
}

const badgeTexts = (badges: { label?: string, text?: string }[] | undefined) =>
  (badges ?? [])
    .map((badge) => presentText(badge.label) ?? presentText(badge.text))
    .filter((value): value is string => Boolean(value))

const hasBadgeStyle = (badges: { style?: string }[] | undefined, fragment: string) =>
  (badges ?? []).some((badge) => badge.style?.includes(fragment))

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

const lockupChannel = (lockup: LockupVideo, parts: (Text | undefined)[]): SourceChannel | undefined => {
  const name = text(parts[0])
  const id = parts[0]?.endpoint?.payload?.browseId
    ?? lockup.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId
  if (!id || !name) return undefined
  return { id, name, avatar: thumbnail(lockup.metadata?.image?.avatar?.image, AVATAR_WIDTH) }
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
    avatar: thumbnail(channel.metadata?.avatar ?? channel.metadata?.thumbnail, AVATAR_WIDTH)
      ?? thumbnail(header?.author?.thumbnails, AVATAR_WIDTH)
      ?? thumbnail(view?.image?.avatar?.image ?? view?.image?.image, AVATAR_WIDTH),
    handle,
    subscriberCountText: text(header?.subscribers) ?? details[0],
    videoCountText: text(header?.videos_count) ?? details[1],
    banner: thumbnail(header?.banner) ?? thumbnail(view?.banner?.image),
    description: channel.metadata?.description ?? text(view?.description?.description),
    isSubscribed: channel.subscribe_button?.subscribed,
    notificationLevel: notificationLevel(channel.subscribe_button?.notification_preference_button?.current_state_id),
  }
}

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
    avatar: thumbnail(node.author?.thumbnails, AVATAR_WIDTH),
    handle: handleFromUrl(node.author?.url),
    subscriberCountText: presentText(node.subscribers),
    videoCountText: presentText(node.video_count),
  }
}

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
  // MISNAMED upstream (youtubei.js parser/classes/Channel.js:25): subscriber_count holds the handle, video_count the subscriber count
  const handle = handleFromUrl(node.author?.url) ?? presentText(node.subscriber_count)
  return {
    id,
    name,
    avatar: thumbnail(node.author?.thumbnails, AVATAR_WIDTH),
    handle: handle?.startsWith('@') ? handle : undefined,
    subscriberCountText: presentText(node.video_count),
    description: presentText(node.description_snippet),
    isSubscribed: node.subscribe_button?.subscribed,
    isVerified: node.author?.is_verified === true ? true : undefined,
  }
}

export const normalizeChannelAbout = (input: unknown): SourceChannelAbout | undefined => {
  const node = input as {
    metadata?: {
      description?: string
      country?: string
      joined_date?: Text
      view_count?: string
      subscriber_count?: string
      video_count?: string
      canonical_channel_url?: string
      links?: { title?: Text, link?: Text }[]
    }
    description?: Text
    country?: Text
    joined_date?: Text
    view_count?: Text
    canonical_channel_url?: string
    primary_links?: { title?: Text, endpoint?: { metadata?: { url?: string } } }[]
  } | undefined
  if (!node) return undefined
  const view = node.metadata
  if (view) {
    return {
      description: presentText(view.description),
      country: presentText(view.country),
      joinedDateText: presentText(view.joined_date),
      viewCountText: presentText(view.view_count),
      subscriberCountText: presentText(view.subscriber_count),
      videoCountText: presentText(view.video_count),
      canonicalUrl: view.canonical_channel_url,
      links: (view.links ?? []).flatMap((link) => {
        const title = presentText(link.title)
        const url = presentText(link.link)
        return title && url ? [{ title, url }] : []
      }),
    }
  }
  const legacy = node
  // the legacy renderer carries no counts beyond views, so those stay absent rather than back-filled
  const about: SourceChannelAbout = {
    description: presentText(legacy.description),
    country: presentText(legacy.country),
    joinedDateText: presentText(legacy.joined_date),
    viewCountText: presentText(legacy.view_count),
    canonicalUrl: legacy.canonical_channel_url,
    links: (legacy.primary_links ?? []).flatMap((link) => {
      const title = presentText(link.title)
      const url = link.endpoint?.metadata?.url
      return title && url ? [{ title, url }] : []
    }),
  }
  return Object.values(about).some((value) => value !== undefined && value.length !== 0) ? about : undefined
}

export const normalizeCommunityPost = (input: unknown): SourcePost | undefined => {
  const node = input as {
    id?: string
    author?: Author
    content?: Text
    published?: Text
    vote_count?: Text
    attachment?: unknown
  } | undefined
  const id = node?.id
  if (!id) return undefined
  const attachment = node?.attachment as {
    image?: Thumbnail[]
    thumbnails?: Thumbnail[]
  } | undefined
  return {
    id,
    author: authorChannel(node?.author),
    text: presentText(node?.content) ?? '',
    publishedText: presentText(node?.published),
    voteCountText: presentText(node?.vote_count),
    // guarded because normalizeFeedVideo takes a node rather than a maybe-node and throws on undefined
    attachedVideo: node?.attachment === undefined ? undefined : normalizeFeedVideo(node.attachment),
    attachedImage: thumbnail(attachment?.image ?? attachment?.thumbnails),
  }
}

// deliberately NOT Text.toHTML(): that returns a markup string, and rendering it injects upstream HTML into the tree
export const normalizeRuns = (value: string | Text | undefined): SourceTextRun[] => {
  if (typeof value === 'string') return value.length > 0 ? [{ text: value }] : []
  const runs = (value as { runs?: RunNode[] } | undefined)?.runs
  if (!runs || runs.length === 0) {
    const flat = presentText(value)
    return flat ? [{ text: flat }] : []
  }
  return runs.flatMap((run) => {
    const runText = run.text
    if (!runText) return []
    const payload = run.endpoint?.payload
    const startSeconds = payload?.startTimeSeconds
    return [{
      text: runText,
      url: payload?.url,
      videoId: payload?.videoId,
      startSeconds: typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? startSeconds : undefined,
      browseId: payload?.browseId,
    }]
  })
}

export const normalizeNotification = (input: unknown): SourceNotification | undefined => {
  const node = input as {
    notification_id?: string
    short_message?: Text
    sent_time?: Text
    thumbnails?: Thumbnail[]
    video_thumbnails?: Thumbnail[]
    endpoint?: { payload?: { videoId?: string } }
    read?: boolean
  } | undefined
  const id = node?.notification_id
  const message = presentText(node?.short_message)
  if (!id || !message) return undefined
  return {
    id,
    message,
    sentText: presentText(node?.sent_time),
    // `thumbnails` is the channel avatar and `video_thumbnails` the still, never one list
    avatar: thumbnail(node?.thumbnails, AVATAR_WIDTH),
    thumbnail: thumbnail(node?.video_thumbnails, STILL_WIDTH),
    videoId: node?.endpoint?.payload?.videoId,
    read: node?.read === true ? true : undefined,
  }
}

const clampPercent = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined

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
    thumbnail: video.best_thumbnail?.url ?? thumbnail(video.thumbnails, STILL_WIDTH),
    thumbnailSrcset: srcset(video.thumbnails),
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

export const normalizeShortsLockup = (input: unknown): SourceVideo | undefined => {
  const node = input as {
    entity_id?: string
    thumbnail?: Thumbnail[]
    content_image?: { image?: Thumbnail[], primary_thumbnail?: { image?: Thumbnail[] } }
    on_tap_endpoint?: { payload?: { videoId?: string } }
    overlay_metadata?: { primary_text?: Text, secondary_text?: Text }
    accessibility_text?: string
    badge?: { label?: string, text?: string }
  } | undefined
  const id = node?.on_tap_endpoint?.payload?.videoId ?? node?.entity_id
  const title = presentText(node?.overlay_metadata?.primary_text) ?? node?.accessibility_text
  if (!id || !title) return undefined
  // i.ytimg.com/vi/ID/hqdefault.jpg is the canonical still for any public video id, used when the node carries none
  // a Short's still from a feed lockup is the vertical frame letterboxed into 16:9, which is why the 9:16 card crops back to the content rather than showing bars; the reel endpoint's poster is the true 1080x1920 portrait frame and wins wherever it exists
  const image = thumbnail(node?.thumbnail)
    ?? thumbnail(node?.content_image?.primary_thumbnail?.image ?? node?.content_image?.image)
    ?? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
  return {
    id,
    title,
    thumbnail: image,
    // no durationSeconds: Shorts carry no length on this node and a card should not show one
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
    thumbnail: thumbnail(video.thumbnail, STILL_WIDTH),
    thumbnailSrcset: srcset(video.thumbnail),
    durationSeconds: video.duration,
    viewCount: video.view_count === undefined ? undefined : String(video.view_count),
    isLive: video.is_live === true ? true : undefined,
    badges: [],
    channel: video.channel_id && video.author
      ? { id: video.channel_id, name: video.author }
      : undefined,
  }
}

// an explicit allow-list rather than "not VIDEO" so a playlist lockup falls through to normalizePlaylistLockup instead of being swallowed here: the collection kinds have their own normalizers and must never be forced through this one
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
    thumbnail: thumbnail(image?.image, STILL_WIDTH),
    thumbnailSrcset: srcset(image?.image),
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
    // empty because a lockup's overlay badges carry only the duration and the live pill, both read above
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
  const image = lockup.content_image?.primary_thumbnail ?? lockup.content_image
  const badges = image?.overlays?.flatMap((overlay) => overlay.badges ?? []) ?? []
  const parts = lockupParts(lockup)
  return {
    id,
    title,
    thumbnail: thumbnail(image?.image, STILL_WIDTH),
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
    thumbnail: thumbnail(node.thumbnails, STILL_WIDTH)
      ?? thumbnail(node.sidebar_thumbnails, STILL_WIDTH)
      ?? thumbnail(node.thumbnail_renderer?.thumbnail, STILL_WIDTH),
    videoCountText: presentText(node.video_count) ?? presentText(node.video_count_short),
    channel: bylineChannel(node.author),
  }
}

// the playlist id is nowhere in `info` on any renderer, so the caller carries the id it browsed with
export const normalizePlaylistDetails = (input: unknown, id: string): SourcePlaylist => {
  const info = (input as PlaylistDetails).info
  return {
    id,
    title: presentText(info?.title) ?? id,
    description: presentText(info?.description),
    thumbnail: thumbnail(info?.thumbnails, STILL_WIDTH),
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

// PlaylistVideo fuses view count and upload date into one line, bullet-separated under any hl
const videoInfoParts = (value: Text | undefined) =>
  presentText(value)?.split('•').map((part) => part.trim()).filter((part) => part.length > 0) ?? []

export const normalizePlaylistItem = (input: unknown): SourcePlaylistItem | undefined => {
  const node = input as PlaylistVideoNode
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

// the Text branch is taken ONLY on a real Text: stringifying an Author yields '[object Object]', which survives the 'N/A' filter
const bylineText = (author: Author | Text | undefined) => {
  const named = presentText((author as Author | undefined)?.name)
  if (named) return named
  const node = author as Text | undefined
  return typeof node?.text === 'string' ? presentText(node) : undefined
}

export const normalizePlaylistPanelVideo = (input: unknown): SourceVideo | undefined => {
  const node = input as PlaylistPanelVideoNode | undefined
  const row = node?.primary ?? node
  const id = row?.video_id
  const title = presentText(row?.title)
  if (!id || !title) return undefined
  return {
    id,
    title,
    thumbnail: thumbnail(row?.thumbnail, STILL_WIDTH),
    thumbnailSrcset: srcset(row?.thumbnail),
    durationSeconds: Number.isFinite(row?.duration?.seconds) ? row?.duration?.seconds : undefined,
    badges: [],
    // no channel: this node carries no channel id on any field, so one built here would link nowhere
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
    // 0-based, so 0 is a real position and must survive the guard
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
    view_count?: { view_count?: Text, short_view_count?: Text, is_live?: boolean, original_view_count?: number }
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
  // the container, not memo.get('PlaylistPanelVideo'): the id, title, byline and current index exist nowhere else
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
  const status = likeStatus(likeButtonView?.like_status_entity?.like_status ?? likeButtonView?.like_status)
    ?? (likeLegacy?.like_button?.is_toggled === true
      ? 'LIKE'
      : likeLegacy?.dislike_button?.is_toggled === true ? 'DISLIKE' : undefined)
  const bell = subscribeButton?.notification_preference_button
  return {
    id,
    title: text(primary?.title),
    isLive: primary?.view_count?.is_live === true,
    concurrentViewers: primary?.view_count?.original_view_count,
    viewCountText: text(primary?.view_count?.view_count ?? primary?.view_count?.short_view_count),
    publishedDateText: text(primary?.published) ?? text(primary?.relative_date),
    likeCountText: likeCount,
    commentCountText: text(commentsHeader?.comment_count),
    description: text(secondary?.description),
    descriptionRuns: normalizeRuns(secondary?.description),
    likeStatus: status,
    channel: author?.id && author.name
      ? {
          id: author.id,
          name: author.name,
          avatar: thumbnail(author.thumbnails, AVATAR_WIDTH),
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
  // AccountInfo.contents is an AccountItemSection: the account is an AccountItem inside ITS contents
  const rows = (input as AccountInfo).contents?.contents ?? []
  const named = rows.filter((row) => row.account_name !== undefined)
  const account = named.find((row) => row.is_selected === true) ?? named[0]
  return {
    signedIn: true,
    name: presentText(account?.account_name),
    avatar: thumbnail(account?.account_photo, AVATAR_WIDTH),
    handle: presentText(account?.channel_handle),
    // position among the NAMED rows: counting the section's CompactLink rows would switch to the wrong account
    accounts: named.map((row, index) => ({
      index,
      name: presentText(row.account_name),
      avatar: thumbnail(row.account_photo, AVATAR_WIDTH),
      handle: presentText(row.channel_handle),
      selected: row.is_selected === true ? true : undefined,
      hasChannel: row.has_channel === true ? true : undefined,
    })),
  }
}

export const normalizeCommentView = (input: unknown): SourceComment | undefined => {
  const comment = input as CommentViewNode | undefined
  if (!comment?.comment_id) return undefined
  return {
    id: comment.comment_id,
    author: comment.author?.id && comment.author.name
      ? {
          id: comment.author.id,
          name: comment.author.name,
          avatar: thumbnail(comment.author.thumbnails, AVATAR_WIDTH),
          handle: handleFromUrl(comment.author.url) ?? (comment.author.name.startsWith('@') ? comment.author.name : undefined),
          isVerified: comment.author.is_verified === true ? true : undefined,
        }
      : undefined,
    text: text(comment.content) ?? '',
    runs: normalizeRuns(comment.content),
    publishedText: comment.published_time,
    likeCountText: comment.like_count,
    replyCount: approximateCount(comment.reply_count),
    isPinned: comment.is_pinned === true ? true : undefined,
    isHearted: comment.is_hearted === true ? true : undefined,
    isLiked: comment.is_liked === true ? true : undefined,
    isDisliked: comment.is_disliked === true ? true : undefined,
    isCreator: comment.author_is_channel_owner === true ? true : undefined,
    isMember: comment.is_member === true ? true : undefined,
  }
}

export const normalizeCommentThread = (input: unknown): SourceComment | undefined =>
  normalizeCommentView((input as CommentThread | undefined)?.comment)

type LiveChatItemNode = {
  type?: string
  id?: string
  message?: Text
  header_subtext?: Text
  author?: Author & {
    badges?: { icon_type?: string, tooltip?: string, custom_thumbnail?: Thumbnail[] }[]
    is_moderator?: boolean
  }
  timestamp_text?: string
  purchase_amount?: string
  header_background_color?: number
  body_background_color?: number
}

// upstream sends colours as signed 32-bit ARGB integers; the alpha byte is dropped rather than converted
const argbColor = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
}

// an emoji run's text is a `:shortcut:` that renders as literal punctuation, so the image is the content
const normalizeLiveChatRuns = (value: Text | undefined): SourceLiveChatRun[] => {
  const runs = (value as { runs?: (RunNode & { emoji?: { image?: Thumbnail[], shortcuts?: string[], is_custom?: boolean } })[] } | undefined)?.runs
  if (!runs?.length) return normalizeRuns(value)
  return runs.flatMap((run) => {
    const emoji = run.emoji
    if (emoji) {
      const url = thumbnail(emoji.image, EMOJI_WIDTH)
      if (!url) return run.text ? [{ text: run.text }] : []
      return [{ text: run.text ?? '', emojiUrl: url, emojiLabel: emoji.shortcuts?.[0] ?? run.text ?? '' }]
    }
    return run.text ? normalizeRuns({ runs: [run] } as Text) : []
  })
}

// chat emoji render at 24px, so 48 covers them at 2x
const EMOJI_WIDTH = 48

const AUTHOR_OWNER_BADGES = new Set(['OWNER'])
const AUTHOR_MODERATOR_BADGES = new Set(['MODERATOR'])

export const normalizeLiveChatMessage = (input: unknown): SourceLiveChatMessage | undefined => {
  const item = input as LiveChatItemNode | undefined
  if (!item?.id) return undefined
  const badges = item.author?.badges ?? []
  const iconTypes = badges.flatMap((badge) => (badge.icon_type ? [badge.icon_type] : []))
  // a member badge is the channel's own emoji, so there is no icon_type to match on
  const isMember = badges.some((badge) => (badge.custom_thumbnail?.length ?? 0) > 0)
  const body = item.message ?? item.header_subtext
  return {
    id: item.id,
    author: item.author?.id && item.author.name
      ? {
          id: item.author.id,
          name: item.author.name,
          avatar: thumbnail(item.author.thumbnails, AVATAR_WIDTH),
          handle: handleFromUrl(item.author.url),
          isVerified: item.author.is_verified === true ? true : undefined,
        }
      : undefined,
    text: text(body) ?? '',
    runs: normalizeLiveChatRuns(body),
    timestampText: item.timestamp_text,
    isOwner: iconTypes.some((icon) => AUTHOR_OWNER_BADGES.has(icon)) ? true : undefined,
    isModerator: item.author?.is_moderator === true || iconTypes.some((icon) => AUTHOR_MODERATOR_BADGES.has(icon))
      ? true
      : undefined,
    isMember: isMember ? true : undefined,
    purchaseAmountText: item.purchase_amount,
    headerBackgroundColor: argbColor(item.header_background_color),
    bodyBackgroundColor: argbColor(item.body_background_color),
  }
}
