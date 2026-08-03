import { describe, expect, it } from 'vite-plus/test'

import { normalizeChannel, normalizeChannelAbout, normalizeNotification, normalizeRuns, normalizeCommentThread, normalizeCommunityPost, normalizeFeedVideo, normalizeShortsLockup, normalizeGridPlaylist, normalizeLockupVideo, normalizePlaylistDetails, normalizePlaylistItem, normalizePlaylistLockup, normalizePlaylistPanelVideo, normalizeSearchChannel, normalizeSession, normalizeVideoDetails, normalizeWatchMeta, normalizeWatchPlaylist } from './normalize'

describe('youtube normalization', () => {
  it('keeps the notification avatar and still in their own slots', () => {
    expect(normalizeNotification({
      notification_id: 'n1',
      short_message: { text: 'Blender uploaded a new video' },
      sent_time: { text: '1 hour ago' },
      thumbnails: [{ url: 'avatar', width: 48 }],
      video_thumbnails: [{ url: 'still', width: 320 }],
      endpoint: { payload: { videoId: 'abc' } },
      read: false,
    })).toEqual({
      id: 'n1',
      message: 'Blender uploaded a new video',
      sentText: '1 hour ago',
      avatar: 'avatar',
      thumbnail: 'still',
      videoId: 'abc',
      read: undefined,
    })
  })

  it('describes only the stills upstream actually published', () => {
    const srcsetOf = (thumbnails: { url?: string, width?: number }[]) =>
      normalizeFeedVideo({ video_id: 'v', title: { text: 'T' }, thumbnails })?.thumbnailSrcset

    expect(srcsetOf([{ url: 'b', width: 480 }, { url: 'a', width: 120 }])).toBe('a 120w, b 480w')
    expect(srcsetOf([{ url: 'only', width: 480 }])).toBeUndefined()
    expect(srcsetOf([{ url: 'sized', width: 480 }, { url: 'unsized' }])).toBeUndefined()
    expect(srcsetOf([{ url: 'a', width: 120 }, { url: 'b', width: 480 }, { url: 'c' }]))
      .toBe('a 120w, b 480w')
    expect(srcsetOf([{ url: 'jpg', width: 480 }, { url: 'webp', width: 480 }, { url: 'a', width: 120 }]))
      .toBe('a 120w, webp 480w')
  })

  it('drops a notification with no message to show', () => {
    expect(normalizeNotification({ notification_id: 'n1' })).toBeUndefined()
    expect(normalizeNotification({ short_message: { text: 'orphan' } })).toBeUndefined()
    expect(normalizeNotification(undefined)).toBeUndefined()
  })

  it('segments a rich text body into linkable runs', () => {
    expect(normalizeRuns({
      text: 'See 1:23 and https://example.com and #tag',
      runs: [
        { text: 'See ' },
        { text: '1:23', endpoint: { payload: { videoId: 'abc', startTimeSeconds: 83 } } },
        { text: ' and ' },
        { text: 'https://example.com', endpoint: { payload: { url: 'https://example.com' } } },
        { text: ' and ' },
        { text: '#tag', endpoint: { payload: { browseId: 'UChashtag' } } },
      ],
    })).toEqual([
      { text: 'See ', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined },
      { text: '1:23', url: undefined, videoId: 'abc', startSeconds: 83, browseId: undefined },
      { text: ' and ', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined },
      { text: 'https://example.com', url: 'https://example.com', videoId: undefined, startSeconds: undefined, browseId: undefined },
      { text: ' and ', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined },
      { text: '#tag', url: undefined, videoId: undefined, startSeconds: undefined, browseId: 'UChashtag' },
    ])
  })

  it('keeps a chapter that starts at zero', () => {
    expect(normalizeRuns({
      text: 'Intro',
      runs: [{ text: 'Intro', endpoint: { payload: { videoId: 'abc', startTimeSeconds: 0 } } }],
    })[0]).toMatchObject({ startSeconds: 0, videoId: 'abc' })
  })

  it('yields one unlinked run for a body that carries none', () => {
    expect(normalizeRuns({ text: 'Plain body' })).toEqual([
      { text: 'Plain body', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined },
    ])
    expect(normalizeRuns('a string')).toEqual([{ text: 'a string' }])
    expect(normalizeRuns(undefined)).toEqual([])
    expect(normalizeRuns('')).toEqual([])
  })

  it('reads the About panel from both renderer generations', () => {
    expect(normalizeChannelAbout({
      metadata: {
        description: 'We make things',
        country: 'Norway',
        joined_date: { text: 'Joined 3 Mar 2011' },
        view_count: '12,345,678 views',
        subscriber_count: '1.2M subscribers',
        video_count: '431 videos',
        canonical_channel_url: 'https://www.youtube.com/@achannel',
        links: [{ title: { text: 'Site' }, link: { text: 'example.com' } }],
      },
    })).toEqual({
      description: 'We make things',
      country: 'Norway',
      joinedDateText: 'Joined 3 Mar 2011',
      viewCountText: '12,345,678 views',
      subscriberCountText: '1.2M subscribers',
      videoCountText: '431 videos',
      canonicalUrl: 'https://www.youtube.com/@achannel',
      links: [{ title: 'Site', url: 'example.com' }],
    })
  })

  it('falls back to the legacy About renderer, whose fields are Text nodes', () => {
    expect(normalizeChannelAbout({
      description: { text: 'An older channel' },
      country: { text: 'Japan' },
      joined_date: { text: 'Joined 1 Jan 2008' },
      view_count: { text: '99 views' },
      canonical_channel_url: 'https://www.youtube.com/channel/UC1',
      primary_links: [{ title: { text: 'Blog' }, endpoint: { metadata: { url: 'https://blog.example' } } }],
    })).toMatchObject({
      description: 'An older channel',
      country: 'Japan',
      viewCountText: '99 views',
      links: [{ title: 'Blog', url: 'https://blog.example' }],
    })
    expect(normalizeChannelAbout({})).toBeUndefined()
    expect(normalizeChannelAbout(undefined)).toBeUndefined()
  })

  it('keeps a community post that carries no words and no attachment', () => {
    expect(normalizeCommunityPost({
      id: 'Ugkx',
      author: { id: 'UC1', name: 'Chan' },
      published: { text: '2 days ago' },
      vote_count: { text: '1.2K' },
    })).toEqual({
      id: 'Ugkx',
      author: { id: 'UC1', name: 'Chan', avatar: undefined, handle: undefined, isVerified: undefined },
      text: '',
      publishedText: '2 days ago',
      voteCountText: '1.2K',
      attachedVideo: undefined,
      attachedImage: undefined,
    })
    expect(normalizeCommunityPost({ content: { text: 'orphan' } })).toBeUndefined()
    expect(normalizeCommunityPost(undefined)).toBeUndefined()
  })

  it('keeps the shorts that every feed used to drop', () => {
    expect(normalizeShortsLockup({
      entity_id: 'shorts-entity',
      on_tap_endpoint: { payload: { videoId: 'realId' } },
      thumbnail: [{ url: 'small', width: 120 }, { url: 'large', width: 480 }],
      overlay_metadata: { primary_text: { text: 'A Short' }, secondary_text: { text: '1.2M views' } },
    })).toEqual({
      id: 'realId',
      title: 'A Short',
      thumbnail: 'large',
      viewCount: '1.2M views',
      isShort: true,
      badges: [],
    })
  })

  it('derives a still for a short whose own image field is empty', () => {
    expect(normalizeShortsLockup({
      on_tap_endpoint: { payload: { videoId: 'abc123' } },
      overlay_metadata: { primary_text: { text: 'A Short' } },
    })?.thumbnail).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg')
    expect(normalizeShortsLockup({
      on_tap_endpoint: { payload: { videoId: 'abc123' } },
      overlay_metadata: { primary_text: { text: 'A Short' } },
      content_image: { image: [{ url: 'real', width: 480 }] },
    })?.thumbnail).toBe('real')
  })

  it('falls back to the entity id and drops a short with no title', () => {
    expect(normalizeShortsLockup({
      entity_id: 'shorts-entity',
      overlay_metadata: { primary_text: { text: 'A Short' } },
    })?.id).toBe('shorts-entity')
    expect(normalizeShortsLockup({ entity_id: 'shorts-entity' })).toBeUndefined()
    expect(normalizeShortsLockup(undefined)).toBeUndefined()
  })

  it('reads a search channel off the shape normalizeChannel cannot take', () => {
    expect(normalizeSearchChannel({
      id: 'UC123',
      author: {
        id: 'UC123',
        name: 'A Channel',
        url: 'https://www.youtube.com/@achannel',
        thumbnails: [{ url: 'avatar', width: 176 }],
        is_verified: true,
      },
      // Both slots are MISNAMED upstream: subscriberCountText carries the handle and videoCountText carries the subscriber count (youtubei.js parser/classes/Channel.js:25).
      subscriber_count: { text: '@achannel' },
      video_count: { text: '1.2M subscribers' },
      description_snippet: { text: 'We make things' },
      subscribe_button: { subscribed: true },
    })).toEqual({
      id: 'UC123',
      name: 'A Channel',
      avatar: 'avatar',
      handle: '@achannel',
      subscriberCountText: '1.2M subscribers',
      description: 'We make things',
      isSubscribed: true,
      isVerified: true,
    })
  })

  it('takes the search channel handle off the misnamed slot when the url has none', () => {
    expect(normalizeSearchChannel({
      id: 'UC123',
      author: { id: 'UC123', name: 'A Channel' },
      subscriber_count: { text: '@achannel' },
      video_count: { text: '1.2M subscribers' },
    })).toMatchObject({ handle: '@achannel', subscriberCountText: '1.2M subscribers' })
    expect(normalizeSearchChannel({
      id: 'UC123',
      author: { id: 'UC123', name: 'A Channel' },
      subscriber_count: { text: '1.2M subscribers' },
    })?.handle).toBeUndefined()
  })

  it('drops a search node that is not a channel', () => {
    expect(normalizeSearchChannel({ id: 'UC123' })).toBeUndefined()
    expect(normalizeSearchChannel({})).toBeUndefined()
    expect(normalizeSearchChannel({ author: { id: 'N/A', name: 'N/A' } })).toBeUndefined()
  })

  it('reads the card badges upstream already localized', () => {
    expect(normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'Video title' },
      is_upcoming: true,
      badges: [
        { label: '4K', style: 'BADGE_STYLE_TYPE_SIMPLE' },
        { label: 'CC', style: 'BADGE_STYLE_TYPE_SIMPLE' },
        { label: 'Members only', style: 'BADGE_STYLE_TYPE_MEMBERS_ONLY' },
      ],
    })).toMatchObject({
      id: 'abc',
      isUpcoming: true,
      isMembersOnly: true,
      badges: ['4K', 'CC', 'Members only'],
    })
  })

  it('leaves badges an empty list rather than absent', () => {
    expect(normalizeFeedVideo({ video_id: 'abc', title: { text: 'T' } })?.badges).toEqual([])
    expect(normalizeVideoDetails({ id: 'abc', title: 'T' })?.badges).toEqual([])
  })

  it('picks an image that covers its slot rather than the widest published', () => {
    const video = normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'T' },
      thumbnails: [
        { url: 'mq.jpg', width: 320 },
        { url: 'hq.jpg', width: 480 },
        { url: 'sd.jpg', width: 640 },
        { url: 'hd.jpg', width: 1280 },
        { url: 'maxres.jpg', width: 1920 },
      ],
      author: {
        id: 'UC1',
        name: 'Chan',
        thumbnails: [
          { url: 'a48.jpg', width: 48 },
          { url: 'a176.jpg', width: 176 },
          { url: 'a800.jpg', width: 800 },
        ],
      },
    })
    expect(video?.thumbnail).toBe('hd.jpg')
    expect(video?.channel?.avatar).toBe('a176.jpg')
  })

  it('falls back to the widest image when nothing published covers the slot', () => {
    const video = normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'T' },
      author: { id: 'UC1', name: 'Chan', thumbnails: [{ url: 'a32.jpg', width: 32 }, { url: 'a68.jpg', width: 68 }] },
    })
    expect(video?.channel?.avatar).toBe('a68.jpg')
  })

  it('normalizes feed videos', () => {
    expect(normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'Video title' },
      duration: { seconds: 125 },
      thumbnails: [
        { url: 'small', width: 120 },
        { url: 'large', width: 640 },
      ],
      author: { id: 'channel', name: 'Channel' },
    })).toEqual({
      id: 'abc',
      title: 'Video title',
      thumbnail: 'large',
      thumbnailSrcset: 'small 120w, large 640w',
      durationSeconds: 125,
      badges: [],
      channel: { id: 'channel', name: 'Channel' },
    })
  })

  it('normalizes feed video snippets and live state', () => {
    expect(normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'Video title' },
      description_snippet: { text: 'A short teaser' },
      is_live: true,
    })).toMatchObject({
      id: 'abc',
      description: 'A short teaser',
      descriptionSnippet: 'A short teaser',
      isLive: true,
    })
  })

  it('normalizes player details', () => {
    expect(normalizeVideoDetails({
      id: 'abc',
      title: 'Video title',
      short_description: 'Description',
      duration: 90,
      view_count: 42,
      channel_id: 'channel',
      author: 'Channel',
    })).toMatchObject({
      id: 'abc',
      title: 'Video title',
      description: 'Description',
      durationSeconds: 90,
      viewCount: '42',
    })
  })

  it('normalizes a C4TabbedHeader channel', () => {
    expect(normalizeChannel({
      metadata: {
        external_id: 'UC123',
        title: 'Channel',
        description: 'About the channel',
        avatar: [{ url: 'avatar', width: 160 }],
      },
      header: {
        channel_handle: { text: '@channel' },
        subscribers: { text: '1.5M subscribers' },
        videos_count: { text: '425 videos' },
        banner: [
          { url: 'banner-small', width: 512 },
          { url: 'banner-large', width: 2048 },
        ],
      },
    })).toEqual({
      id: 'UC123',
      name: 'Channel',
      avatar: 'avatar',
      handle: '@channel',
      subscriberCountText: '1.5M subscribers',
      videoCountText: '425 videos',
      banner: 'banner-large',
      description: 'About the channel',
    })
  })

  it('normalizes a PageHeader channel', () => {
    expect(normalizeChannel({
      metadata: { external_id: 'UC123', title: 'Channel' },
      header: {
        content: {
          image: { avatar: { image: [{ url: 'avatar', width: 160 }] } },
          banner: { image: [{ url: 'banner', width: 2048 }] },
          description: { description: { text: 'About the channel' } },
          metadata: {
            metadata_rows: [
              { metadata_parts: [{ text: { text: '@channel' } }] },
              {
                metadata_parts: [
                  { text: { text: '1.5M subscribers' } },
                  { text: { text: '425 videos' } },
                ],
              },
            ],
          },
        },
      },
    })).toEqual({
      id: 'UC123',
      name: 'Channel',
      avatar: 'avatar',
      handle: '@channel',
      subscriberCountText: '1.5M subscribers',
      videoCountText: '425 videos',
      banner: 'banner',
      description: 'About the channel',
    })
  })

  it('normalizes lockup watch-next items', () => {
    expect(normalizeLockupVideo({
      content_id: 'abc',
      content_type: 'VIDEO',
      content_image: {
        image: [{ url: 'thumb', width: 640 }],
        overlays: [{ badges: [{ text: '1:02:03', badge_style: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' }] }],
      },
      metadata: {
        title: { text: 'Related video' },
        image: {
          avatar: { image: [{ url: 'avatar', width: 68 }] },
          renderer_context: { command_context: { on_tap: { payload: { browseId: 'UC123' } } } },
        },
        metadata: {
          metadata_rows: [
            { metadata_parts: [{ text: { text: 'Channel' } }] },
            {
              metadata_parts: [
                { text: { text: '1.1M views' } },
                { text: { text: '3 months ago' } },
              ],
            },
          ],
        },
      },
    })).toEqual({
      id: 'abc',
      title: 'Related video',
      thumbnail: 'thumb',
      durationSeconds: 3723,
      viewCount: '1.1M views',
      publishedText: '3 months ago',
      badges: [],
      channel: { id: 'UC123', name: 'Channel', avatar: 'avatar' },
    })
  })

  it('drops non-video lockups', () => {
    expect(normalizeLockupVideo({
      content_id: 'PL123',
      content_type: 'PLAYLIST',
      metadata: { title: { text: 'A playlist' } },
    })).toBeUndefined()
  })

  it('normalizes a short lockup as a video and still refuses a collection', () => {
    expect(normalizeLockupVideo({
      content_id: 'abc',
      content_type: 'SHORT',
      metadata: { title: { text: 'A short' } },
    })).toMatchObject({ id: 'abc', title: 'A short' })
    expect(normalizeLockupVideo({
      content_id: 'UC123',
      content_type: 'CHANNEL',
      metadata: { title: { text: 'A channel' } },
    })).toBeUndefined()
  })

  it('normalizes a playlist lockup through its collection thumbnail', () => {
    expect(normalizePlaylistLockup({
      content_id: 'PL123',
      content_type: 'PLAYLIST',
      content_image: {
        primary_thumbnail: {
          image: [{ url: 'cover', width: 640 }],
          overlays: [{ badges: [{ text: '50 videos' }] }],
        },
      },
      metadata: {
        title: { text: 'Watch later' },
        image: {
          avatar: { image: [{ url: 'avatar', width: 68 }] },
          renderer_context: { command_context: { on_tap: { payload: { browseId: 'UC123' } } } },
        },
        metadata: {
          metadata_rows: [{ metadata_parts: [{ text: { text: 'Channel' } }] }],
        },
      },
    })).toEqual({
      id: 'PL123',
      title: 'Watch later',
      thumbnail: 'cover',
      videoCountText: '50 videos',
      channel: { id: 'UC123', name: 'Channel', avatar: 'avatar' },
    })
  })

  it('drops lockups that are not playlists', () => {
    expect(normalizePlaylistLockup({
      content_id: 'abc',
      content_type: 'VIDEO',
      metadata: { title: { text: 'A video' } },
    })).toBeUndefined()
    expect(normalizePlaylistLockup({ content_type: 'PLAYLIST', metadata: {} })).toBeUndefined()
    expect(normalizePlaylistLockup({})).toBeUndefined()
  })

  it('normalizes a grid playlist', () => {
    expect(normalizeGridPlaylist({
      id: 'PL123',
      title: { text: 'Mixes' },
      thumbnails: [
        { url: 'small', width: 120 },
        { url: 'large', width: 640 },
      ],
      video_count: { text: '12 videos' },
      author: { id: 'UC123', name: 'Channel', thumbnails: [{ url: 'avatar', width: 68 }] },
    })).toEqual({
      id: 'PL123',
      title: 'Mixes',
      thumbnail: 'large',
      videoCountText: '12 videos',
      channel: { id: 'UC123', name: 'Channel', avatar: 'avatar' },
    })
  })

  it('falls back to a playlist custom thumbnail', () => {
    expect(normalizeGridPlaylist({
      id: 'PL123',
      title: { text: 'Bossa Lofi' },
      thumbnail_renderer: { thumbnail: [{ url: 'custom-small', width: 100 }, { url: 'custom', width: 480 }] },
      video_count: { text: '27 videos' },
    })).toMatchObject({
      id: 'PL123',
      title: 'Bossa Lofi',
      thumbnail: 'custom',
      videoCountText: '27 videos',
    })
  })

  it('reads a legacy playlist byline that is a Text rather than an Author', () => {
    expect(normalizeGridPlaylist({
      id: 'PL123',
      title: { text: 'Mixes' },
      video_count_short: { text: '12' },
      author: { text: 'Channel', endpoint: { payload: { browseId: 'UC123' } } },
    })).toMatchObject({
      videoCountText: '12',
      channel: { id: 'UC123', name: 'Channel' },
    })
  })

  it('drops playlist nodes without an id or a title', () => {
    expect(normalizeGridPlaylist({ title: { text: 'Untitled' } })).toBeUndefined()
    expect(normalizeGridPlaylist({ id: 'PL123', title: { toString: () => 'N/A' } })).toBeUndefined()
    expect(normalizeGridPlaylist({})).toBeUndefined()
  })

  it('normalizes a playlist row with the slot id its edits need', () => {
    expect(normalizePlaylistItem({
      id: 'abc',
      title: { text: 'Row title' },
      index: { text: '3' },
      set_video_id: 'slot-1',
      video_info: { text: '1.2M views • 3 years ago' },
      duration: { text: '10:00', seconds: 600 },
      thumbnails: [{ url: 'thumb', width: 640 }],
      author: { id: 'UC123', name: 'Channel' },
    })).toEqual({
      video: {
        id: 'abc',
        title: 'Row title',
        thumbnail: 'thumb',
        durationSeconds: 600,
        viewCount: '1.2M views',
        publishedText: '3 years ago',
        badges: [],
        channel: { id: 'UC123', name: 'Channel' },
      },
      setVideoId: 'slot-1',
      index: 3,
    })
  })

  it("drops a playlist row's placeholder author", () => {
    expect(normalizePlaylistItem({
      id: 'abc',
      title: { text: 'Row title' },
      author: { id: 'N/A', name: 'N/A' },
    })?.video.channel).toBeUndefined()
  })

  it('drops playlist rows that are not entries of the playlist', () => {
    expect(normalizePlaylistItem({
      id: 'abc',
      title: { text: 'Recommended' },
      style: 'PLAYLIST_VIDEO_RENDERER_STYLE_RECOMMENDED_VIDEO',
    })).toBeUndefined()
    expect(normalizePlaylistItem({ title: { text: 'No id' } })).toBeUndefined()
    expect(normalizePlaylistItem({})).toBeUndefined()
  })

  it('normalizes playlist details against the id the caller browsed with', () => {
    expect(normalizePlaylistDetails({
      info: {
        title: 'My playlist',
        description: 'What it holds',
        author: { id: 'UC123', name: 'Channel', thumbnails: [{ url: 'avatar', width: 88 }] },
        thumbnails: [{ url: 'cover', width: 640 }],
        total_items: '25 videos',
        views: '1,204 views',
        last_updated: 'Updated today',
        privacy: 'UNLISTED',
        is_editable: true,
        can_delete: true,
        can_reorder: true,
      },
    }, 'PL123')).toEqual({
      id: 'PL123',
      title: 'My playlist',
      description: 'What it holds',
      thumbnail: 'cover',
      videoCountText: '25 videos',
      viewCountText: '1,204 views',
      updatedText: 'Updated today',
      privacy: 'UNLISTED',
      isEditable: true,
      canDelete: true,
      canReorder: true,
      channel: { id: 'UC123', name: 'Channel', avatar: 'avatar' },
    })
  })

  it('treats absent playlist stats as absent rather than as the text N/A', () => {
    expect(normalizePlaylistDetails({
      info: { total_items: 'N/A', views: 'N/A', last_updated: 'N/A' },
    }, 'PL123')).toEqual({ id: 'PL123', title: 'PL123' })
    expect(normalizePlaylistDetails({}, 'PL123')).toEqual({ id: 'PL123', title: 'PL123' })
  })

  it('normalizes watch metadata from a /next response memo', () => {
    const memo = new Map<string, unknown[]>([
      ['VideoPrimaryInfo', [{
        view_count: { view_count: { text: '55,504,131 views' }, short_view_count: { text: '55M views' } },
        published: { text: 'Jun 8, 2021' },
        relative_date: { text: '4 years ago' },
      }]],
      ['VideoSecondaryInfo', [{
        owner: {
          subscriber_count: { text: '2.5M subscribers' },
          author: {
            id: 'UC123',
            name: 'Channel',
            thumbnails: [{ url: 'avatar', width: 88 }],
            url: 'https://www.youtube.com/@channel',
          },
        },
        description: { text: 'Full description\nwith lines' },
      }]],
      ['SegmentedLikeDislikeButtonView', [{ like_count: 123456, short_like_count: '123K' }]],
      ['CommentsEntryPointHeader', [{ comment_count: { text: '4.2K' } }]],
      ['CompactVideo', [{
        video_id: 'rel1',
        title: { text: 'Related one' },
        duration: { seconds: 60 },
        author: { id: 'UC456', name: 'Other' },
      }]],
      ['LockupView', [{
        content_id: 'rel2',
        content_type: 'VIDEO',
        metadata: { title: { text: 'Related two' } },
      }]],
    ])
    expect(normalizeWatchMeta({ contents_memo: memo }, 'abc')).toEqual({
      id: 'abc',
      isLive: false,
      concurrentViewers: undefined,
      viewCountText: '55,504,131 views',
      publishedDateText: 'Jun 8, 2021',
      likeCountText: '123K',
      commentCountText: '4.2K',
      description: 'Full description\nwith lines',
      descriptionRuns: [{ text: 'Full description\nwith lines', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined }],
      channel: {
        id: 'UC123',
        name: 'Channel',
        avatar: 'avatar',
        handle: '@channel',
        subscriberCountText: '2.5M subscribers',
      },
      related: [
        { id: 'rel1', title: 'Related one', durationSeconds: 60, badges: [], channel: { id: 'UC456', name: 'Other' } },
        { id: 'rel2', title: 'Related two', badges: [] },
      ],
    })
  })

  it('reads liveness off the view count, which is where upstream puts it', () => {
    const memo = new Map<string, unknown[]>([
      ['VideoPrimaryInfo', [{
        title: { text: 'Live now' },
        view_count: { view_count: { text: '12,043 watching now' }, is_live: true, original_view_count: 12043 },
      }]],
    ])
    const meta = normalizeWatchMeta({ contents_memo: memo }, 'live1')
    expect(meta?.isLive).toBe(true)
    expect(meta?.concurrentViewers).toBe(12043)
  })

  it('normalizes a queue row off its singular thumbnail field', () => {
    expect(normalizePlaylistPanelVideo({
      video_id: 'q1',
      title: { text: 'Queue row' },
      thumbnail: [{ url: 'small', width: 120 }, { url: 'large', width: 480 }],
      duration: { text: '1:01', seconds: 61 },
      author: 'Owner',
      set_video_id: 'set-q1',
    })).toEqual({
      id: 'q1',
      title: 'Queue row',
      thumbnail: 'large',
      thumbnailSrcset: 'small 120w, large 480w',
      durationSeconds: 61,
      badges: [],
    })
  })

  it('unwraps a queue row and drops the rows that carry no video', () => {
    expect(normalizePlaylistPanelVideo({ primary: { video_id: 'q2', title: { text: 'Wrapped' } } }))
      .toEqual({ id: 'q2', title: 'Wrapped', thumbnail: undefined, durationSeconds: undefined, badges: [] })
    expect(normalizePlaylistPanelVideo({ playlist_video: {} })).toBeUndefined()
    expect(normalizePlaylistPanelVideo({
      video_id: 'q3',
      title: { text: 'No length' },
      duration: { text: 'N/A', seconds: Number.NaN },
    })).toMatchObject({ id: 'q3', durationSeconds: undefined })
  })

  it('reads the queue panel off the watch response container', () => {
    expect(normalizeWatchMeta({
      contents_memo: new Map([
        ['TwoColumnWatchNextResults', [{
          playlist: {
            id: 'PL1',
            title: 'My queue',
            author: { id: 'UC1', name: 'Owner' },
            contents: [{ video_id: 'q1', title: { text: 'First' } }],
            current_index: 0,
            is_infinite: false,
          },
        }]],
      ]),
    }, 'q1')?.playlist).toEqual({
      id: 'PL1',
      title: 'My queue',
      author: 'Owner',
      items: [{ id: 'q1', title: 'First', thumbnail: undefined, durationSeconds: undefined, badges: [] }],
      currentIndex: 0,
      isInfinite: false,
    })
  })

  it('takes a mix byline off its Text node and reports the queue as infinite', () => {
    expect(normalizeWatchPlaylist({
      id: 'RD1',
      title: 'Mix',
      author: { text: 'YouTube' },
      is_infinite: true,
    })).toEqual({ id: 'RD1', title: 'Mix', author: 'YouTube', items: [], currentIndex: undefined, isInfinite: true })
    expect(normalizeWatchPlaylist(undefined)).toBeUndefined()
    expect(normalizeWatchPlaylist({})).toBeUndefined()
  })

  it('returns undefined watch metadata without parsed contents', () => {
    expect(normalizeWatchMeta(undefined, 'abc')).toBeUndefined()
    expect(normalizeWatchMeta({}, 'abc')).toBeUndefined()
  })

  it('normalizes comment threads', () => {
    expect(normalizeCommentThread({
      comment: {
        comment_id: 'UgxComment',
        content: { text: 'Nice video' },
        published_time: '2 days ago',
        like_count: '1.2K',
        reply_count: '24',
        is_pinned: true,
        is_hearted: true,
        author: {
          id: 'UC123',
          name: '@viewer',
          thumbnails: [{ url: 'avatar', width: 48 }],
        },
      },
    })).toEqual({
      id: 'UgxComment',
      author: { id: 'UC123', name: '@viewer', avatar: 'avatar', handle: '@viewer' },
      text: 'Nice video',
      runs: [{ text: 'Nice video', url: undefined, videoId: undefined, startSeconds: undefined, browseId: undefined }],
      publishedText: '2 days ago',
      likeCountText: '1.2K',
      replyCount: 24,
      isPinned: true,
      isHearted: true,
    })
  })

  it('normalizes account info into a session', () => {
    expect(normalizeSession({
      contents: {
        contents: [{
          account_name: { text: 'Banou' },
          account_photo: [
            { url: 'small', width: 32 },
            { url: 'large', width: 88 },
          ],
          channel_handle: { text: '@banou' },
          is_selected: true,
        }],
      },
    })).toEqual({
      signedIn: true,
      name: 'Banou',
      avatar: 'large',
      handle: '@banou',
      channelId: undefined,
      accounts: [{
        index: 0,
        name: 'Banou',
        avatar: 'large',
        handle: '@banou',
        selected: true,
        hasChannel: undefined,
      }],
    })
  })

  it('numbers accounts by position among the NAMED rows', () => {
    // account_index becomes X-Goog-Authuser, so the number has to match the order authuser itself uses.
    const session = normalizeSession({
      contents: {
        contents: [
          { navigation_endpoint: {} },
          { account_name: { text: 'First' } },
          { navigation_endpoint: {} },
          { account_name: { text: 'Second' }, is_selected: true },
        ],
      },
    })
    expect(session.accounts.map((account) => [account.index, account.name])).toEqual([[0, 'First'], [1, 'Second']])
    expect(session.name).toBe('Second')
  })

  it('takes the selected account, not the first row', () => {
    expect(normalizeSession({
      contents: {
        contents: [
          { navigation_endpoint: {} },
          { account_name: { text: 'Other' }, account_photo: [{ url: 'other', width: 88 }] },
          { account_name: { text: 'Banou' }, account_photo: [{ url: 'mine', width: 88 }], is_selected: true },
        ],
      },
    })).toMatchObject({ name: 'Banou', avatar: 'mine' })
  })

  it("treats youtubei.js's 'N/A' account texts as absent", () => {
    expect(normalizeSession({
      contents: {
        contents: [{
          account_name: { text: 'Banou' },
          channel_handle: { text: undefined, toString: () => 'N/A' },
        }],
      },
    })).toMatchObject({ signedIn: true, name: 'Banou', handle: undefined })
  })

  it('still reports a signed-in session when the account section is unreadable', () => {
    expect(normalizeSession({})).toEqual({
      signedIn: true,
      name: undefined,
      avatar: undefined,
      handle: undefined,
      channelId: undefined,
      accounts: [],
    })
    expect(normalizeSession({ contents: { contents: [] } })).toMatchObject({ signedIn: true, accounts: [] })
  })

  it('drops comments without an id and approximates shortened reply counts', () => {
    expect(normalizeCommentThread({ comment: { content: { text: 'orphan' } } })).toBeUndefined()
    expect(normalizeCommentThread({})).toBeUndefined()
    expect(normalizeCommentThread({
      comment: { comment_id: 'a', reply_count: '1.2K' },
    })).toMatchObject({ id: 'a', text: '', replyCount: 1200 })
  })
})
