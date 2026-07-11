export type SourceChannel = {
  id: string
  name: string
  avatar?: string
  handle?: string
  subscriberCountText?: string
  videoCountText?: string
  banner?: string
  description?: string
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
  channel?: SourceChannel
}

export type SourceVideoPage = {
  items: SourceVideo[]
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

export type Source = {
  id: string
  home(cursor?: string): Promise<SourceVideoPage>
  search(query: string, cursor?: string): Promise<SourceVideoPage>
  video(id: string): Promise<SourceVideo | undefined>
  channel(id: string, cursor?: string): Promise<SourceChannelPage>
  watch(id: string): Promise<SourceWatchMeta | undefined>
  comments(videoId: string, cursor?: string): Promise<SourceCommentPage>
}

export type SourceApi = Omit<Source, 'id'>
