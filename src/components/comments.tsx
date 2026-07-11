import type { CommentsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ListFilter, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { gql } from '../generated'

type CommentData = CommentsQuery['comments']['items'][number]

const COMMENTS_QUERY = gql(`
  query Comments($videoId: ID!, $cursor: String) {
    comments(videoId: $videoId, cursor: $cursor) {
      items {
        id
        text
        publishedText
        likeCountText
        replyCount
        isPinned
        author { id name avatar }
      }
      cursor
      disabled
    }
  }
`)

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
    color: #f1f1f1;
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0;
    border: none;
    background: transparent;
    color: #f1f1f1;
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
    background: #272727;
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
    color: #f1f1f1;
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
    color: #aaaaaa;
  }

  .byline {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
  }

  .author {
    font-size: 1.3rem;
    font-weight: 500;
    color: #f1f1f1;
  }

  .age {
    font-size: 1.2rem;
    color: #aaaaaa;
  }

  .text {
    margin-top: 0.2rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: #f1f1f1;
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
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .like-count {
    margin-left: -0.4rem;
    font-size: 1.2rem;
    color: #aaaaaa;
  }

  .reply {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: #f1f1f1;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .reply:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .replies {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    font-weight: 500;
    color: #3ea6ff;
  }

  .show-more {
    margin-top: 2.4rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: #272727;
    color: #f1f1f1;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .show-more:hover {
    background: #3f3f3f;
  }

  .show-more:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .disabled-notice,
  .more-error {
    margin: 2.4rem 0 0;
    font-size: 1.4rem;
    color: #aaaaaa;
  }
`

export const Comments = ({ videoId, commentCountText }: { videoId: string, commentCountText?: string | null }) => {
  const [loaded, setLoaded] = useState<{ items: CommentData[], cursor: string | null }>({ items: [], cursor: null })
  const [{ data, error, fetching }] = useQuery({
    query: COMMENTS_QUERY,
    variables: { videoId, cursor: loaded.cursor }
  })
  const page = data?.comments
  const loadedIds = new Set(loaded.items.map(item => item.id))
  const items = [...loaded.items, ...(page?.items.filter(item => !loadedIds.has(item.id)) ?? [])]
  const heading = commentCountText
    ? /comment/i.test(commentCountText) ? commentCountText : `${commentCountText} Comments`
    : 'Comments'
  const onMore = () => {
    if (!page?.cursor) return
    setLoaded(previous => {
      const previousIds = new Set(previous.items.map(item => item.id))
      return {
        items: [...previous.items, ...page.items.filter(item => !previousIds.has(item.id))],
        cursor: page.cursor ?? null
      }
    })
  }
  // only bail entirely when the FIRST page failed — a pagination error must not
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
        <button type='button' className='sort'>
          <ListFilter size={24} strokeWidth={1.5} />
          Sort by
        </button>
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
              <div className='text'>{comment.text}</div>
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
