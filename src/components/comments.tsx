import type { TargetedEvent } from 'preact'

import type { CommentRepliesQuery, CommentSort, CommentsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, ListFilter, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation } from 'wouter'

import { gql } from '../generated'
import { useSession } from '../session'
import { readable } from './format'
import { showToast } from './ui/toast'
import { RichText } from './rich-text'
import { Menu, MenuItem } from './ui/menu'
import { useInfiniteFeed } from './use-infinite-feed'

type CommentPage = CommentsQuery['comments']
type RepliesPage = CommentRepliesQuery['commentReplies']
type CommentRow = CommentPage['items'][number]

const COMMENTS_QUERY = gql(`
  query Comments($videoId: ID!, $sort: CommentSort, $cursor: String) {
    comments(videoId: $videoId, sort: $sort, cursor: $cursor) {
      items {
        id
        text
        runs { text url videoId startSeconds browseId }
        publishedText
        likeCountText
        replyCount
        repliesCursor
        actionsToken
        isPinned
        isHearted
        isCreator
        isMember
        isLiked
        isDisliked
        author { id name avatar isVerified }
      }
      cursor
      disabled
      countText
    }
  }
`)

const RATE_COMMENT = gql(`
  mutation RateComment($actionsToken: String!, $status: LikeStatus!) {
    rateComment(actionsToken: $actionsToken, status: $status) {
      id
      isLiked
      isDisliked
    }
  }
`)

const POST_COMMENT = gql(`
  mutation PostComment($videoId: ID!, $text: String!) {
    postComment(videoId: $videoId, text: $text)
  }
`)

const REPLY_TO_COMMENT = gql(`
  mutation ReplyToComment($actionsToken: String!, $text: String!) {
    replyToComment(actionsToken: $actionsToken, text: $text)
  }
`)

const SORTS: { value: CommentSort, label: string }[] = [
  { value: 'TOP', label: 'Top comments' },
  { value: 'NEWEST', label: 'Newest first' },
]

const style = css`
  margin-top: 2.4rem;

  .heading-row {
    display: flex;
    align-items: center;
    gap: 3.2rem;
    margin-bottom: 2.4rem;
  }

  .heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2.4rem;
  }

  .comment {
    display: flex;
    align-items: flex-start;
  }

  .avatar {
    flex: none;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-chip);
  }

  .avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    font-size: 1.6rem;
    font-weight: 500;
  }

  .body {
    flex: 1;
    min-width: 0;
    margin-left: 1.6rem;
  }

  .pinned {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .byline {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
  }

  .author {
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .age {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .text {
    margin-top: 0.2rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.4rem;
  }

  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action:hover {
    background: var(--bg-hover);
  }

  .like-count {
    margin-left: -0.4rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .reply {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .reply:hover {
    background: var(--bg-hover);
  }

  .replies {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--accent);
  }

  .show-more {
    margin-top: 2.4rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .show-more:hover {
    background: var(--bg-chip-hover);
  }

  .show-more:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .composer {
    margin-top: 1.2rem;
  }

  .composer.top {
    margin: 0 0 2.4rem;
  }

  .composer-input {
    display: block;
    width: 100%;
    min-height: 4rem;
    padding: 0.4rem 0;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    resize: vertical;
  }

  .composer-input:focus {
    outline: none;
    border-bottom-color: var(--text-primary);
  }

  .composer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.8rem;
    margin-top: 0.8rem;
  }

  .composer-cancel,
  .composer-send {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .composer-cancel {
    background: transparent;
    color: var(--text-primary);
  }

  .composer-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .composer-send {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .composer-send:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .composer-send:disabled,
  .composer-cancel:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .composer-prompt {
    display: block;
    margin: 0 0 2.4rem;
    padding: 0.8rem 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .replies-block {
    margin-top: 0.4rem;
  }

  /* A disclosure rather than a label: it was inert text before, which read as a
     count that ought to be clickable and was not. */
  .replies {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .replies:hover {
    background: var(--accent-hover);
  }

  .reply-list {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    margin-top: 0.8rem;
    /* Indented to the depth of the parent's avatar column, so a reply reads as
       hanging off the comment above it rather than as a sibling. */
    padding-left: 2.4rem;
  }

  .reply {
    display: flex;
    gap: 1.2rem;
  }

  .reply .avatar {
    width: 2.4rem;
    height: 2.4rem;
    font-size: 1.1rem;
  }

  .name.creator {
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .disabled-notice,
  .more-error {
    margin: 2.4rem 0 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

const Composer = ({ videoId }: { videoId: string }) => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [, postComment] = useMutation(POST_COMMENT)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  if (ready && !signedIn) {
    return (
      <button type='button' className='composer-prompt' onClick={() => navigate('/signin')}>
        Sign in to comment
      </button>
    )
  }

  const send = () => {
    const body = draft.trim()
    if (body.length === 0 || sending) return
    setSending(true)
    void postComment({ videoId, text: body }).then((result) => {
      setSending(false)
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      setDraft('')
      // no optimistic row: a fabricated id would poison the normalized cache
      showToast('Comment posted')
    })
  }

  return (
    <div className='composer top'>
      <textarea
        className='composer-input'
        value={draft}
        placeholder='Add a comment…'
        aria-label='Add a comment'
        onInput={(event: TargetedEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
      />
      <div className='composer-actions'>
        <button type='button' className='composer-cancel' onClick={() => setDraft('')} disabled={draft.length === 0}>
          Cancel
        </button>
        <button
          type='button'
          className='composer-send'
          disabled={draft.trim().length === 0 || sending}
          onClick={send}
        >
          Comment
        </button>
      </div>
    </div>
  )
}

const CommentActions = ({ comment }: { comment: CommentRow }) => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [, rateComment] = useMutation(RATE_COMMENT)
  const [, replyToComment] = useMutation(REPLY_TO_COMMENT)
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const token = comment.actionsToken
  const rate = (status: 'LIKE' | 'DISLIKE') => {
    if (ready && !signedIn) {
      navigate('/signin')
      return
    }
    if (!token) return
    const next = (status === 'LIKE' && comment.isLiked) || (status === 'DISLIKE' && comment.isDisliked)
      ? 'INDIFFERENT'
      : status
    void rateComment({ actionsToken: token, status: next }).then((result) => {
      if (result.error) showToast(readable(result.error.message))
    })
  }

  const sendReply = () => {
    const body = draft.trim()
    if (!token || body.length === 0 || sending) return
    setSending(true)
    void replyToComment({ actionsToken: token, text: body }).then((result) => {
      setSending(false)
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      setDraft('')
      setReplying(false)
      showToast('Reply posted')
    })
  }

  return (
    <>
      <div className='actions'>
        <button
          type='button'
          className='action'
          aria-label='Like'
          aria-pressed={comment.isLiked === true}
          disabled={!token && signedIn}
          onClick={() => rate('LIKE')}
        >
          <ThumbsUp size={16} strokeWidth={1.5} fill={comment.isLiked ? 'currentColor' : 'none'} />
        </button>
        {comment.likeCountText ? <span className='like-count'>{comment.likeCountText}</span> : undefined}
        <button
          type='button'
          className='action'
          aria-label='Dislike'
          aria-pressed={comment.isDisliked === true}
          disabled={!token && signedIn}
          onClick={() => rate('DISLIKE')}
        >
          <ThumbsDown size={16} strokeWidth={1.5} fill={comment.isDisliked ? 'currentColor' : 'none'} />
        </button>
        {token
          ? (
            <button type='button' className='reply' onClick={() => setReplying(value => !value)}>
              Reply
            </button>
          )
          : undefined}
      </div>
      {replying
        ? (
          <div className='composer'>
            <textarea
              className='composer-input'
              value={draft}
              placeholder='Add a reply…'
              aria-label='Add a reply'
              onInput={(event: TargetedEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
            />
            <div className='composer-actions'>
              <button type='button' className='composer-cancel' onClick={() => { setReplying(false); setDraft('') }}>
                Cancel
              </button>
              <button
                type='button'
                className='composer-send'
                disabled={draft.trim().length === 0 || sending}
                onClick={sendReply}
              >
                Reply
              </button>
            </div>
          </div>
        )
        : undefined}
    </>
  )
}

const REPLIES_QUERY = gql(`
  query CommentReplies($cursor: String!) {
    commentReplies(cursor: $cursor) {
      items {
        id
        text
        runs { text url videoId startSeconds browseId }
        publishedText
        likeCountText
        isHearted
        isCreator
        isMember
        author { id name avatar isVerified }
      }
      cursor
    }
  }
`)

const Replies = (
  { cursor, count, videoId }: { cursor: string, count?: number | null, videoId: string },
) => {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<RepliesPage[]>([])
  const [{ data, error, fetching }] = useQuery({
    query: REPLIES_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor ?? cursor },
    pause: !open,
  })
  const page = data?.commentReplies
  const { items, cursor: next } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: reply => reply.id,
  })
  const label = count === 1 ? '1 reply' : `${count ?? ''} replies`.trim()

  return (
    <div className='replies-block'>
      <button
        type='button'
        className='replies'
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {open ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
        {label}
      </button>
      {open
        ? (
          <div className='reply-list'>
            {items.map(reply => (
              <div className='reply' key={reply.id}>
                {reply.author
                  ? (
                    <Link
                      href={`/channel/${reply.author.id}`}
                      className={reply.author.avatar ? 'avatar' : 'avatar fallback'}
                      aria-label={reply.author.name}
                    >
                      {reply.author.avatar
                        ? <img src={reply.author.avatar} alt='' loading='lazy' />
                        : reply.author.name.slice(0, 1).toUpperCase()}
                    </Link>
                  )
                  : <span className='avatar fallback'>?</span>}
                <div className='body'>
                  <div className='byline'>
                    {reply.author
                      ? <span className={reply.isCreator ? 'name creator' : 'name'}>{reply.author.name}</span>
                      : undefined}
                    {reply.publishedText ? <span className='age'>{reply.publishedText}</span> : undefined}
                  </div>
                  {reply.runs.length > 0
                    ? <RichText className='text' runs={reply.runs} videoId={videoId} />
                    : <div className='text'>{reply.text}</div>}
                  {reply.likeCountText ? <div className='age'>{reply.likeCountText}</div> : undefined}
                </div>
              </div>
            ))}
            {fetching ? <div className='age'>Loading replies…</div> : undefined}
            {error && items.length === 0 ? <div className='age'>{readable(error.message)}</div> : undefined}
            {next && !fetching
              ? (
                <button
                  type='button'
                  className='replies'
                  onClick={() => setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page!])}
                >
                  Show more replies
                </button>
              )
              : undefined}
          </div>
        )
        : undefined}
    </div>
  )
}

export const Comments = ({ videoId, commentCountText }: { videoId: string, commentCountText?: string | null }) => {
  const [sort, setSort] = useState<CommentSort>('TOP')
  // pages carry the sort they came from: without it the accumulator dedupes a reorder into a drop
  const [loaded, setLoaded] = useState<{ sort: CommentSort, pages: CommentPage[] }>({ sort, pages: [] })
  const loadedPages = loaded.sort === sort ? loaded.pages : []
  const [{ data, error, fetching }] = useQuery({
    query: COMMENTS_QUERY,
    variables: { videoId, sort, cursor: loadedPages[loadedPages.length - 1]?.cursor ?? null }
  })
  const page = data?.comments
  const { items } = useInfiniteFeed({
    pages: page ? [...loadedPages, page] : loadedPages,
    key: comment => comment.id
  })
  const heading = page?.countText
    ?? (commentCountText
      ? /comment/i.test(commentCountText) ? commentCountText : `${commentCountText} Comments`
      : 'Comments')
  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ sort, pages: loadedPages[loadedPages.length - 1] === page ? loadedPages : [...loadedPages, page] })
  }
  // a first-page failure REPORTS rather than unmounting: returning null reads as "no comments"
  if (error && items.length === 0) {
    return (
      <section css={style}>
        <p className='disabled-notice'>{readable(error.message)}</p>
      </section>
    )
  }
  if (!fetching && !error && items.length === 0 && !page?.disabled) return null
  if (page?.disabled && items.length === 0) {
    return (
      <section css={style}>
        <p className='disabled-notice'>Comments are turned off.</p>
      </section>
    )
  }
  return (
    <section css={style}>
      <div className='heading-row'>
        <h2 className='heading'>{heading}</h2>
        <Menu
          align='start'
          trigger={
            <button type='button' className='sort'>
              <ListFilter size={24} strokeWidth={1.5} />
              {SORTS.find(option => option.value === sort)?.label ?? 'Sort by'}
            </button>
          }
        >
          {SORTS.map(option => (
            <MenuItem
              key={option.value}
              label={option.label}
              checked={option.value === sort}
              onSelect={() => setSort(option.value)}
            />
          ))}
        </Menu>
      </div>
      <Composer videoId={videoId} />
      <div className='list'>
        {items.map(comment => (
          <div className='comment' key={comment.id}>
            {comment.author
              ? (
                <Link
                  href={`/channel/${comment.author.id}`}
                  className={comment.author.avatar ? 'avatar' : 'avatar fallback'}
                  aria-label={comment.author.name}
                >
                  {comment.author.avatar
                    ? <img src={comment.author.avatar} alt='' loading='lazy' />
                    : comment.author.name.slice(0, 1).toUpperCase()}
                </Link>
              )
              : <span className='avatar fallback'>?</span>}
            <div className='body'>
              {comment.isPinned ? <div className='pinned'>Pinned</div> : undefined}
              <div className='byline'>
                {comment.author
                  ? <Link href={`/channel/${comment.author.id}`} className='author'>{comment.author.name}</Link>
                  : undefined}
                {comment.publishedText ? <span className='age'>{comment.publishedText}</span> : undefined}
              </div>
              {comment.runs.length > 0
                ? <RichText className='text' runs={comment.runs} videoId={videoId} />
                : <div className='text'>{comment.text}</div>}
              <CommentActions comment={comment} />
              {comment.repliesCursor
                ? <Replies cursor={comment.repliesCursor} count={comment.replyCount} videoId={videoId} />
                : comment.replyCount
                  ? <div className='replies'>{comment.replyCount === 1 ? '1 reply' : `${comment.replyCount} replies`}</div>
                  : undefined}
            </div>
          </div>
        ))}
      </div>
      {error && items.length > 0
        ? <p className='more-error'>Couldn’t load more comments.</p>
        : page?.cursor
          ? (
            <button type='button' className='show-more' disabled={fetching} onClick={onMore}>
              Show more
            </button>
          )
          : undefined}
    </section>
  )
}

export default Comments
