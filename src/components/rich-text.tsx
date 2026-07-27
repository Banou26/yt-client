import type { TextRun } from '../generated/graphql'

import { css } from '@emotion/react'
import { Link } from 'wouter'

import { seekTo } from '../player/seek'
import { watchHrefFor } from './video-card'

export type RichTextRun = Pick<TextRun, 'text'> & Partial<Pick<TextRun, 'browseId' | 'startSeconds' | 'url' | 'videoId'>>

const style = css`
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  a,
  .seek {
    color: var(--accent);
  }

  /* A seek reads as a link and has to look like one, but it is a button: it
     acts on the page rather than navigating, so anchor semantics would promise
     the wrong thing to a screen reader and to middle-click. */
  .seek {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  a:hover,
  .seek:hover {
    text-decoration: underline;
  }
`

/**
 * A rich text body rendered from its runs.
 *
 * `videoId` is the video the body belongs to, which is what decides whether a
 * timestamp seeks or navigates: a comment can link to a timestamp in a
 * DIFFERENT video, and that has to open it rather than jump the current one.
 */
export const RichText = (
  { runs, videoId, className }: { runs: readonly RichTextRun[], videoId?: string, className?: string },
) => (
  <span css={style} className={className}>
    {runs.map((run, index) => {
      // Runs are positional and their text repeats ('and ', ' - '), so the
      // index is the only stable identity available.
      const key = `${index}:${run.text}`

      if (run.videoId) {
        const seconds = run.startSeconds ?? undefined
        const sameVideo = videoId !== undefined && run.videoId === videoId
        if (sameVideo && seconds !== undefined) {
          return (
            <button
              type='button'
              key={key}
              className='seek'
              onClick={() => {
                // Falls through to nothing only if the player has gone away
                // between render and click, which a reload fixes and a thrown
                // error would not.
                seekTo(run.videoId!, seconds)
              }}
            >
              {run.text}
            </button>
          )
        }
        return (
          <Link key={key} href={watchHrefFor(run.videoId)}>{run.text}</Link>
        )
      }

      if (run.browseId) {
        return <Link key={key} href={`/channel/${run.browseId}`}>{run.text}</Link>
      }

      if (run.url) {
        return (
          // noreferrer as well as noopener: these are author-supplied links and
          // the referrer would leak which page they were followed from.
          <a key={key} href={run.url} target='_blank' rel='noreferrer noopener'>{run.text}</a>
        )
      }

      return <span key={key}>{run.text}</span>
    })}
  </span>
)

export default RichText
