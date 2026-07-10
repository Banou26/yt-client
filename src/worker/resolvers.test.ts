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
})
