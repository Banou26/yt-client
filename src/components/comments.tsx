import type { CommentSort, CommentsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ListFilter, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'
import { RichText } from './rich-text'
import { Menu, MenuItem } from './ui/menu'
import { useInfiniteFeed } from './use-infinite-feed'

type CommentPage = CommentsQuery['comments']

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
        isPinned
        isHearted
        isCreator
        isMember
        author { id name avatar isVerified }
      }
      cursor
      disabled
      countText
    }
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

  .disabled-notice,
  .more-error {
    margin: 2.4rem 0 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

export const Comments = ({ videoId, commentCountText }: { videoId: string, commentCountText?: string | null }) => {
  const [sort, setSort] = useState<CommentSort>('TOP')
  // Consumed pages carry the ordering they came from, so switching sort starts
  // from an empty list in the same render. Without this the accumulator would
  // dedupe the new ordering against the old one and drop legitimately reordered
  // comments rather than reordering them.
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
  // The header's own count is exact and already reads as a count, so the regex
  // that had to guess whether the /next teaser said 'comments' is gone. That
  // teaser stays as the fallback for the render before the page arrives.
  const heading = page?.countText
    ?? (commentCountText
      ? /comment/i.test(commentCountText) ? commentCountText : `${commentCountText} Comments`
      : 'Comments')
  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ sort, pages: loadedPages[loadedPages.length - 1] === page ? loadedPages : [...loadedPages, page] })
  }
  // only bail entirely when the FIRST page failed: a pagination error must not
  // unmount already-loaded comments (comment cursors die on engine restarts).
  if (error && items.length === 0) return null
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
              <div className='actions'>
                <button type='button' className='action' aria-label='Like'>
                  <ThumbsUp size={16} strokeWidth={1.5} />
                </button>
                {comment.likeCountText ? <span className='like-count'>{comment.likeCountText}</span> : undefined}
                <button type='button' className='action' aria-label='Dislike'>
                  <ThumbsDown size={16} strokeWidth={1.5} />
                </button>
                <button type='button' className='reply'>Reply</button>
              </div>
              {comment.replyCount
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
