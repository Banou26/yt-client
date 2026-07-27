import type { SourceChannel, SourceComment, SourceLikeStatus, SourceNotificationLevel, SourceSession, SourceVideo, SourceWatchMeta } from '../types'

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
  const author = video.author?.id && video.author.name
    ? {
        id: video.author.id,
        name: video.author.name,
        avatar: thumbnail(video.author.thumbnails),
      }
    : undefined
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
    channel: author,
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
    channel: video.channel_id && video.author
      ? { id: video.channel_id, name: video.author }
      : undefined,
  }
}

export const normalizeLockupVideo = (input: unknown): SourceVideo | undefined => {
  const lockup = input as LockupVideo
  if (lockup.content_type && lockup.content_type !== 'VIDEO') return undefined
  const id = lockup.content_id
  const title = text(lockup.metadata?.title)
  if (!id || !title) return undefined
  const image = lockup.content_image?.primary_thumbnail ?? lockup.content_image
  const badges = image?.overlays?.flatMap((overlay) => overlay.badges ?? []) ?? []
  const parts = lockup.metadata?.metadata?.metadata_rows
    ?.flatMap((row) => row.metadata_parts ?? [])
    .map((part) => part.text)
    ?? []
  const channelName = text(parts[0])
  const channelId = parts[0]?.endpoint?.payload?.browseId
    ?? lockup.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId
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
    channel: channelId && channelName
      ? {
          id: channelId,
          name: channelName,
          avatar: thumbnail(lockup.metadata?.image?.avatar?.image),
        }
      : undefined,
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
