import { describe, expect, it } from 'vite-plus/test'

// Through the package's own surface rather than a deep path: `exports` does not
// publish dist/, so a direct file import does not resolve.
import { YTNodes } from 'youtubei.js'

const { CommentView } = YTNodes

/* Guards `patches/youtubei.js+17.0.1.patch`.

   Upstream reads the comment avatar as `comment.avatar.endpoint` inside
   `applyMutations`. YouTube dropped `avatar` from the comment entity payload,
   so that read throws a TypeError which escapes the `Comments` constructor and
   fails the whole page: every video rendered with NO comment section at all.

   The failure is worth a test rather than a note because nothing else catches
   it. It is not our code, so the normalizers pass; it is a runtime TypeError,
   so the type-check passes; and a plain `npm ci` that skipped the patch would
   put it straight back. This exercises the real upstream class against the real
   payload shape, which is the only thing that actually proves the patch is on. */

// Shape taken from a live response: keys are key/properties/author/toolbar plus
// logging, and the avatar url and channel endpoint ride on `author`.
const entity = () => ({
  key: 'comment-key',
  properties: {
    content: { content: 'can confirm: he never gave us up' },
    publishedTime: '1 year ago',
  },
  author: {
    channelId: 'UCBR8-60-B28hp2BmDPdntcQ',
    displayName: '@YouTube',
    avatarThumbnailUrl: 'https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj',
    isVerified: true,
    isCreator: false,
    channelPageEndpoint: { browseEndpoint: { browseId: 'UCBR8-60-B28hp2BmDPdntcQ' } },
  },
  toolbar: {
    likeCountNotliked: '273K',
    replyCount: '961',
    creatorThumbnailUrl: '',
  },
})

describe('youtubei.js comment replies patch', () => {
  // The second half of the same patch. A thread's replies continuation moved
  // out of `contents` and into `subThreads`, so every thread parsed with an
  // empty continuation list: the reply count rendered as inert text with no
  // control to open it, and upstream's own CommentThread.getReplies() threw
  // "Replies continuation not found."
  const subThreads = [{
    continuationItemRenderer: {
      trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
      continuationEndpoint: {
        commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/next' } },
        continuationCommand: { token: 'REPLY_TOKEN', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' },
      },
    },
  }]

  it('finds the continuation under subThreads', () => {
    const replies = new YTNodes.CommentReplies({
      viewReplies: { buttonRenderer: { text: { runs: [{ text: '961 replies' }] } } },
      subThreads,
    })
    // What commentPage looks for: an item carrying an endpoint it can call.
    const continuation = [...replies.contents].find(item => (item as { endpoint?: unknown }).endpoint !== undefined)
    expect(continuation).toBeDefined()
  })

  it('still reads the old contents shape', () => {
    const replies = new YTNodes.CommentReplies({ contents: subThreads })
    expect([...replies.contents].some(item => (item as { endpoint?: unknown }).endpoint !== undefined)).toBe(true)
  })

  it('stays empty when a thread carries neither', () => {
    const replies = new YTNodes.CommentReplies({ viewReplies: { buttonRenderer: {} } })
    expect([...replies.contents]).toHaveLength(0)
  })
})

describe('youtubei.js comment entity patch', () => {
  it('applies a mutation whose payload carries no avatar', () => {
    const view = new CommentView({ commentId: 'c1' })
    expect(() => view.applyMutations(entity())).not.toThrow()
    expect(view.author?.id).toBe('UCBR8-60-B28hp2BmDPdntcQ')
    expect(view.author?.name).toBe('@YouTube')
  })

  it('reads the avatar off the author and keeps the size hint', () => {
    const view = new CommentView({ commentId: 'c1' })
    view.applyMutations(entity())
    expect(view.author?.thumbnails?.[0]).toEqual({
      url: 'https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj',
      width: 88,
      height: 88,
    })
  })

  it('still prefers the old avatar shape when upstream sends one', () => {
    // The patch adds a fallback rather than replacing the read, so a response
    // that goes back to carrying `avatar` keeps working unchanged.
    const view = new CommentView({ commentId: 'c1' })
    view.applyMutations({
      ...entity(),
      avatar: {
        endpoint: { browseEndpoint: { browseId: 'UCold' } },
        image: { sources: [{ url: 'https://yt3.ggpht.com/old', width: 48, height: 48 }] },
      },
    })
    expect(view.author?.thumbnails?.[0]?.url).toBe('https://yt3.ggpht.com/old')
  })
})
