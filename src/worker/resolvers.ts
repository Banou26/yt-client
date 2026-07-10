import type { Resolvers } from '../generated/resolvers'

export const resolvers = {
  Query: {
    home: () => ({ items: [] }),
    search: () => ({ items: [] }),
    video: () => null,
    channel: (_, { id }) => ({
      channel: { id, name: id },
      videos: { items: [] },
    }),
  },
} satisfies Resolvers
