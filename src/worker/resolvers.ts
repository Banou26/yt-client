import type { SearchFilters } from '../generated/graphql'
import type { Resolvers } from '../generated/resolvers'
import type { SourceSearchFilters } from '../sources/types'

// GraphQL nullables arrive as null and the Source contract speaks in undefined,
// so the boundary is converted field by field rather than passed through: a
// null reaching youtubei.js is a real filter value, not an absent one.
const searchFilters = (filters: SearchFilters | null | undefined): SourceSearchFilters | undefined => {
  if (!filters) return undefined
  return {
    uploadDate: filters.uploadDate ?? undefined,
    type: filters.type ?? undefined,
    duration: filters.duration ?? undefined,
    sortBy: filters.sortBy ?? undefined,
    features: filters.features ?? undefined,
  }
}

export const resolvers = {
  // The source tags every row with its kind, so this stays a field switch and
  // never has to recognize a youtubei.js node shape.
  SearchResult: {
    __resolveType: (result) =>
      result.kind === 'video' ? 'Video' : result.kind === 'channel' ? 'Channel' : 'Playlist',
  },
  Query: {
    home: (_, { chip, cursor }, context) => context.source.home(chip ?? undefined, cursor ?? undefined),
    subscriptions: (_, { cursor }, context) => context.source.subscriptions(cursor ?? undefined),
    history: (_, { cursor }, context) => context.source.history(cursor ?? undefined),
    subscribedChannels: (_, _args, context) => context.source.subscribedChannels(),
    search: (_, { query, filters, cursor }, context) =>
      context.source.search(query, searchFilters(filters), cursor ?? undefined),
    searchSuggestions: (_, { query, previousQuery }, context) =>
      context.source.searchSuggestions(query, previousQuery ?? undefined),
    video: (_, { id }, context) => context.source.video(id).then((video) => video ?? null),
    channel: (_, { id, tab, sort, query, cursor }, context) =>
      context.source.channel(id, tab ?? undefined, sort ?? undefined, query ?? undefined, cursor ?? undefined),
    channelAbout: (_, { id }, context) => context.source.channelAbout(id).then((about) => about ?? null),
    communityPosts: (_, { channelId, cursor }, context) =>
      context.source.communityPosts(channelId, cursor ?? undefined),
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
