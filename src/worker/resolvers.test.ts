import { describe, expect, it } from 'vitest'

import type { SourceApi } from '../sources/types'

import { resolvers } from './resolvers'

describe('root queries', () => {
  it('delegates home to the active source', async () => {
    const source = {
      home: async () => ({ items: [] }),
    } as unknown as SourceApi
    await expect(resolvers.Query.home({}, {}, { source } as never)).resolves.toEqual({ items: [] })
  })

  it('delegates watch to the active source and maps missing metadata to null', async () => {
    const meta = { id: 'abc', related: [] }
    const source = {
      watch: async (id: string) => (id === 'abc' ? meta : undefined),
    } as unknown as SourceApi
    await expect(resolvers.Query.watch({}, { id: 'abc' }, { source } as never)).resolves.toBe(meta)
    await expect(resolvers.Query.watch({}, { id: 'missing' }, { source } as never)).resolves.toBeNull()
  })

  it('delegates comments to the active source', async () => {
    const calls: [string, string | undefined][] = []
    const source = {
      comments: async (videoId: string, cursor?: string) => {
        calls.push([videoId, cursor])
        return { items: [] }
      },
    } as unknown as SourceApi
    await expect(resolvers.Query.comments({}, { videoId: 'abc', cursor: null }, { source } as never))
      .resolves.toEqual({ items: [] })
    expect(calls).toEqual([['abc', undefined]])
  })

  it('delegates session to the active source', async () => {
    const session = { signedIn: true, name: 'Banou', avatar: 'avatar', handle: '@banou' }
    const source = {
      session: async () => session,
    } as unknown as SourceApi
    await expect(resolvers.Query.session({}, {}, { source } as never)).resolves.toBe(session)
  })
})
