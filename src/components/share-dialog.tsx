import type { TargetedFocusEvent } from 'preact'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

import { formatDuration } from './format'
import { playheadOf } from '../player/seek'
import { Dialog } from './ui/dialog'
import { showToast } from './ui/toast'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  min-width: 32rem;

  .link-row {
    display: flex;
    gap: 0.8rem;
  }

  .link {
    flex: 1;
    min-width: 0;
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .copy {
    flex: none;
    height: 4rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  .copy:hover {
    background: var(--bg-inverse-hover);
  }

  .start-at {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .embed-label {
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .embed {
    width: 100%;
    min-height: 8rem;
    padding: 0.8rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-family: monospace;
    font-size: 1.2rem;
    resize: vertical;
  }
`

const copy = (value: string) => {
  const clipboard = navigator.clipboard
  if (!clipboard) {
    showToast('Could not copy the link')
    return
  }
  void clipboard.writeText(value).then(
    () => showToast('Link copied to clipboard'),
    () => showToast('Could not copy the link'),
  )
}

// the start-at offset is read ONCE, when the dialog opens: an offset that kept moving with playback would copy a link the reader never saw
export const ShareDialog = (
  { videoId, list, onClose }: { videoId: string, list?: string, onClose: () => void },
) => {
  const [startAt] = useState(() => playheadOf(videoId))
  const [useStart, setUseStart] = useState(false)

  const params = new URLSearchParams({ v: videoId })
  if (list) params.set('list', list)
  if (useStart && startAt !== undefined) params.set('t', String(startAt))
  const url = `${location.origin}/watch?${params}`

  const embedSource = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}${useStart && startAt !== undefined ? `?start=${startAt}` : ''}`
  const embed = `<iframe width="560" height="315" src="${embedSource}" frameborder="0" allowfullscreen></iframe>`

  return (
    <Dialog title='Share' onClose={onClose}>
      <div css={style}>
        <div className='link-row'>
          <input className='link' readOnly value={url} aria-label='Share link' onFocus={(event: TargetedFocusEvent<HTMLInputElement>) => event.currentTarget.select()} />
          <button type='button' className='copy' onClick={() => copy(url)}>Copy</button>
        </div>
        {startAt !== undefined && startAt > 0
          ? (
            <label className='start-at'>
              <input type='checkbox' checked={useStart} onChange={() => setUseStart(value => !value)} />
              Start at {formatDuration(startAt) ?? '0:00'}
            </label>
          )
          : undefined}
        <div>
          <div className='embed-label'>Embed</div>
          <textarea className='embed' readOnly value={embed} aria-label='Embed code' onFocus={(event: TargetedFocusEvent<HTMLTextAreaElement>) => event.currentTarget.select()} />
        </div>
      </div>
    </Dialog>
  )
}

export default ShareDialog
