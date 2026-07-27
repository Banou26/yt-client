import type { Resolvers } from '../generated/resolvers'

export const resolvers = {
  Query: {
    home: (_, { cursor }, context) => context.source.home(cursor ?? undefined),
    search: (_, { query, cursor }, context) => context.source.search(query, cursor ?? undefined),
    video: (_, { id }, context) => context.source.video(id).then((video) => video ?? null),
    channel: (_, { id, cursor }, context) => context.source.channel(id, cursor ?? undefined),
    watch: (_, { id }, context) => context.source.watch(id).then((meta) => meta ?? null),
    comments: (_, { videoId, cursor }, context) => context.source.comments(videoId, cursor ?? undefined),
    session: (_, _args, context) => context.source.session(),
  },
  Mutation: {
    rateVideo: (_, { id, status }, context) => context.source.rateVideo(id, status),
    setSubscribed: (_, { channelId, subscribed }, context) => context.source.setSubscribed(channelId, subscribed),
    setNotificationLevel: (_, { channelId, level }, context) => context.source.setNotificationLevel(channelId, level),
  },
} satisfies Resolvers
