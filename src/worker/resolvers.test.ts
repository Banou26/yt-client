import { describe, expect, it } from 'vitest'

import { resolvers } from './resolvers'

describe('root queries', () => {
  it('starts with an empty home page', () => {
    expect(resolvers.Query.home()).toEqual({ items: [] })
  })
})
