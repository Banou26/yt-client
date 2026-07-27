import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

export type Toast = {
  id: number
  message: string
  action?: { label: string, onAction: () => void }
}

const DISMISS_MS = 5_000

let toasts: Toast[] = []
let nextId = 0
const listeners = new Set<(value: Toast[]) => void>()

const publish = () => {
  for (const listener of listeners) listener(toasts)
}

export const dismissToast = (id: number) => {
  const next = toasts.filter(toast => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  publish()
}

// A module-level queue rather than a context provider: the callers are mutation
// handlers and event listeners as often as components, and they should not each
// have to reach a hook to say "Saved to Watch later".
export const showToast = (message: string, action?: Toast['action']) => {
  const id = ++nextId
  toasts = [...toasts, { id, message, action }]
  publish()
  setTimeout(() => dismissToast(id), DISMISS_MS)
  return id
}

const style = css`
  position: fixed;
  left: 2.4rem;
  bottom: 2.4rem;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  pointer-events: none;

  .toast {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    min-width: 28rem;
    max-width: 44rem;
    padding: 1.4rem 1.6rem;
    border-radius: 0.4rem;
    /* A snackbar has no scrim behind it and floats over arbitrary scrolled
       content, so it uses the inverse pair rather than a raised surface: in
       light mode a --bg-menu panel would be white-on-white with only a shadow
       to separate it from the page. */
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    box-shadow: var(--shadow-menu);
    pointer-events: auto;
    animation: toast-in 0.15s ease;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(0.8rem);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message {
    flex: 1;
    min-width: 0;
  }

  .action {
    flex: none;
    border: none;
    background: transparent;
    color: var(--accent-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    text-transform: uppercase;
    cursor: pointer;
  }

  @media (max-width: 792px) {
    left: 1.2rem;
    right: 1.2rem;
    bottom: 1.2rem;

    .toast {
      min-width: 0;
      max-width: none;
    }
  }
`

export const Toasts = () => {
  const [items, setItems] = useState(toasts)
  useEffect(() => {
    listeners.add(setItems)
    setItems(toasts)
    return () => {
      listeners.delete(setItems)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div css={style} role='status' aria-live='polite'>
      {items.map(toast => (
        <div key={toast.id} className='toast'>
          <span className='message'>{toast.message}</span>
          {toast.action
            ? (
              <button
                type='button'
                className='action'
                onClick={() => {
                  dismissToast(toast.id)
                  toast.action?.onAction()
                }}
              >
                {toast.action.label}
              </button>
            )
            : undefined}
        </div>
      ))}
    </div>
  )
}

export default Toasts
