import type { SourceApi } from './types'

let resolveSource: (source: SourceApi) => void = () => {}
let source = new Promise<SourceApi>((resolve) => {
  resolveSource = resolve
})

export const setSource = (next: SourceApi) => {
  resolveSource(next)
  source = Promise.resolve(next)
}

export const sourceApi = {
  home: async (cursor?: string) => (await source).home(cursor),
  search: async (query: string, cursor?: string) => (await source).search(query, cursor),
  video: async (id: string) => (await source).video(id),
  channel: async (id: string, cursor?: string) => (await source).channel(id, cursor),
} satisfies SourceApi
