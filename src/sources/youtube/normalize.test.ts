import { describe, expect, it } from 'vitest'

import { normalizeChannel, normalizeCommentThread, normalizeFeedVideo, normalizeLockupVideo, normalizeVideoDetails, normalizeWatchMeta } from './normalize'

describe('youtube normalization', () => {
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
      durationSeconds: 125,
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
      viewCountText: '55,504,131 views',
      publishedDateText: 'Jun 8, 2021',
      likeCountText: '123K',
      commentCountText: '4.2K',
      description: 'Full description\nwith lines',
      channel: {
        id: 'UC123',
        name: 'Channel',
        avatar: 'avatar',
        handle: '@channel',
        subscriberCountText: '2.5M subscribers',
      },
      related: [
        { id: 'rel1', title: 'Related one', durationSeconds: 60, channel: { id: 'UC456', name: 'Other' } },
        { id: 'rel2', title: 'Related two' },
      ],
    })
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
      publishedText: '2 days ago',
      likeCountText: '1.2K',
      replyCount: 24,
      isPinned: true,
      isHearted: true,
    })
  })

  it('drops comments without an id and approximates shortened reply counts', () => {
    expect(normalizeCommentThread({ comment: { content: { text: 'orphan' } } })).toBeUndefined()
    expect(normalizeCommentThread({})).toBeUndefined()
    expect(normalizeCommentThread({
      comment: { comment_id: 'a', reply_count: '1.2K' },
    })).toMatchObject({ id: 'a', text: '', replyCount: 1200 })
  })
})
