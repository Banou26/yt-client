import type { Resolvers } from '../generated/resolvers'

export const resolvers = {
  Query: {
    home: (_, { chip, cursor }, context) => context.source.home(chip ?? undefined, cursor ?? undefined),
    subscriptions: (_, { cursor }, context) => context.source.subscriptions(cursor ?? undefined),
    history: (_, { cursor }, context) => context.source.history(cursor ?? undefined),
    subscribedChannels: (_, _args, context) => context.source.subscribedChannels(),
    search: (_, { query, cursor }, context) => context.source.search(query, cursor ?? undefined),
    video: (_, { id }, context) => context.source.video(id).then((video) => video ?? null),
    channel: (_, { id, cursor }, context) => context.source.channel(id, cursor ?? undefined),
    watch: (_, { id, playlistId, playlistIndex }, context) =>
      context.source.watch(id, playlistId ?? undefined, playlistIndex ?? undefined).then((meta) => meta ?? null),
    comments: (_, { videoId, cursor }, context) => context.source.comments(videoId, cursor ?? undefined),
    playlists: (_, { cursor }, context) => context.source.playlists(cursor ?? undefined),
    playlist: (_, { id, cursor }, context) => context.source.playlist(id, cursor ?? undefined),
    session: (_, _args, context) => context.source.session(),
  },
  Mutation: {
    rateVideo: (_, { id, status }, context) => context.source.rateVideo(id, status),
    removeFromHistory: (_, { videoId }, context) => context.source.removeFromHistory(videoId),
    setSubscribed: (_, { channelId, subscribed }, context) => context.source.setSubscribed(channelId, subscribed),
    setNotificationLevel: (_, { channelId, level }, context) => context.source.setNotificationLevel(channelId, level),
    addToPlaylist: (_, { playlistId, videoIds }, context) => context.source.addToPlaylist(playlistId, videoIds),
    removeFromPlaylist: (_, { playlistId, setVideoIds }, context) => context.source.removeFromPlaylist(playlistId, setVideoIds),
    createPlaylist: (_, { title, videoIds, privacy, description }, context) =>
      context.source.createPlaylist(title, videoIds ?? undefined, privacy ?? undefined, description ?? undefined),
    deletePlaylist: (_, { id }, context) => context.source.deletePlaylist(id),
    renamePlaylist: (_, { id, title }, context) => context.source.renamePlaylist(id, title),
    setPlaylistDescription: (_, { id, description }, context) => context.source.setPlaylistDescription(id, description),
    setPlaylistPrivacy: (_, { id, privacy }, context) => context.source.setPlaylistPrivacy(id, privacy),
    movePlaylistItem: (_, { playlistId, setVideoId, afterSetVideoId }, context) =>
      context.source.movePlaylistItem(playlistId, setVideoId, afterSetVideoId ?? undefined),
  },
} satisfies Resolvers
