import type { RichTextRun } from './rich-text'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

import { RichText } from './rich-text'

const style = css`
  margin-top: 1.2rem;
  padding: 0.8rem 1.2rem;
  border-radius: 1.2rem;
  background: var(--bg-hover);
  font-size: 1.4rem;
  line-height: 2rem;
  color: var(--text-primary);
  transition: background 0.15s ease;

  &.collapsed {
    cursor: pointer;
  }

  &.collapsed:hover {
    background: var(--bg-hover-strong);
  }

  .meta {
    font-size: 1.4rem;
    font-weight: 500;
    white-space: pre;
  }

  .text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  &.collapsed .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .toggle {
    display: block;
    margin-top: 0.4rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }
`

export const DescriptionBox = (
  { viewCountText, publishedDateText, description, runs, videoId }: {
    viewCountText?: string | null
    publishedDateText?: string | null
    description?: string | null
    // The same body segmented. Present whenever the watch query selected it;
    // the flat string is what the collapsed clamp measures.
    runs?: readonly RichTextRun[]
    videoId?: string
  }
) => {
  const [expanded, setExpanded] = useState(false)
  const meta = [viewCountText, publishedDateText].filter(part => part).join('  ')
  const collapsible = Boolean(description) && !expanded
  return (
    <div
      css={style}
      className={collapsible ? 'collapsed' : undefined}
      onClick={collapsible ? () => setExpanded(true) : undefined}
    >
      {meta ? <div className='meta'>{meta}</div> : undefined}
      {runs && runs.length > 0
        ? <RichText className='text' runs={runs} videoId={videoId} />
        : description ? <div className='text'>{description}</div> : undefined}
      {description
        ? (
          expanded
            ? <button type='button' className='toggle' onClick={() => setExpanded(false)}>Show less</button>
            : <button type='button' className='toggle'>...more</button>
        )
        : undefined}
    </div>
  )
}

export default DescriptionBox
