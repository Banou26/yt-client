export type SourceChannel = {
  id: string
  name: string
  avatar?: string
}

export type SourceVideo = {
  id: string
  title: string
  description?: string
  thumbnail?: string
  durationSeconds?: number
  viewCount?: string
  publishedText?: string
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

export type Source = {
  id: string
  home(cursor?: string): Promise<SourceVideoPage>
  search(query: string, cursor?: string): Promise<SourceVideoPage>
  video(id: string): Promise<SourceVideo | undefined>
  channel(id: string, cursor?: string): Promise<SourceChannelPage>
}

export type SourceApi = Omit<Source, 'id'>
