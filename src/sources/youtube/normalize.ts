import type { SourceChannel, SourceVideo } from '../types'

type Thumbnail = {
  url?: string
  width?: number
}

type Text = {
  text?: string
  toString?: () => string
}

type Author = {
  id?: string
  name?: string
  thumbnails?: Thumbnail[]
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
}

type ChannelDetails = {
  metadata?: {
    external_id?: string
    title?: string
    avatar?: Thumbnail[]
    thumbnail?: Thumbnail[]
  }
}

const text = (value: string | Text | undefined) => {
  if (typeof value === 'string') return value
  if (value?.text) return value.text
  return value?.toString?.()
}

const thumbnail = (items: Thumbnail[] | undefined) =>
  items
    ?.filter((item): item is Thumbnail & { url: string } => Boolean(item.url))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
    ?.url

const duration = (video: FeedVideo) => {
  if (Number.isFinite(video.duration?.seconds)) return video.duration?.seconds
  const parts = text(video.length_text)?.split(':').map(Number)
  if (!parts?.length || parts.some((part) => !Number.isFinite(part))) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export const normalizeChannel = (input: unknown, fallbackId?: string): SourceChannel => {
  const channel = input as ChannelDetails
  const id = channel.metadata?.external_id ?? fallbackId
  if (!id) throw new Error('youtube: channel response has no id')
  return {
    id,
    name: channel.metadata?.title ?? id,
    avatar: thumbnail(channel.metadata?.avatar ?? channel.metadata?.thumbnail),
  }
}

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
    thumbnail: video.best_thumbnail?.url ?? thumbnail(video.thumbnails),
    durationSeconds: duration(video),
    viewCount: text(video.short_view_count ?? video.view_count),
    publishedText: text(video.published),
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
    channel: video.channel_id && video.author
      ? { id: video.channel_id, name: video.author }
      : undefined,
  }
}
