import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'preact/hooks'

const style = css`
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: 2.4rem;

  .scrim {
    position: absolute;
    inset: 0;
    background: var(--bg-scrim);
  }

  .panel {
    position: relative;
    width: 100%;
    max-width: 48rem;
    max-height: calc(100vh - 4.8rem);
    display: flex;
    flex-direction: column;
    border-radius: 1.2rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 1.6rem 1.6rem 1.2rem 2.4rem;
  }

  .heading {
    flex: 1;
    min-width: 0;
    font-size: 2rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .close {
    flex: none;
    width: 4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .close:hover {
    background: var(--bg-hover);
  }

  .body {
    min-height: 0;
    overflow-y: auto;
    padding: 0 2.4rem 2.4rem;
    color: var(--text-primary);
  }
`

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export const Dialog = (
  { title, onClose, children }: { title: string, onClose: () => void, children: ComponentChildren },
) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Not `first?.focus() ?? panel?.focus()`: focus() returns undefined, so `??` always evaluated its right side too
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    if (first) first.focus()
    else panel?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previous?.focus()
    }
  }, [onClose])

  return (
    <div css={style}>
      <div className='scrim' onClick={onClose} />
      <div className='panel' ref={panelRef} role='dialog' aria-modal='true' aria-label={title} tabIndex={-1}>
        <div className='head'>
          <h2 className='heading'>{title}</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}>
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>
        <div className='body'>{children}</div>
      </div>
    </div>
  )
}

export default Dialog
