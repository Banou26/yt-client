import { css } from '@emotion/react'
import { Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { promptExtensionInstall } from '../scramjet/platform'
import { getSettings, subscribeSettings, updateSettings } from '../settings'
import { useDismiss } from './ui/popup'

/* The fallback route to the extension, and the one the settings page links.

   The button below prefers the PLATFORM's install prompt, which knows the
   visitor's browser and its own store listings; this is where a reader lands if
   that prompt cannot be shown at all (the broker never loaded), and it is the
   marketing page rather than a store listing for the same reason: it picks the
   right store per browser and states what the extension is first, so this app
   never has to carry an extension id. */
export const EXTENSION_URL = 'https://www.fkn.app/#why'

/* The single app-specific line the platform prompt shows above its own copy. */
const INSTALL_REASON = 'Fetch YouTube straight from your browser instead of the shared FKN relay, for quicker playback.'

/* The content script announces itself in the page's own DOM: `data-fkn-extension`
   on <html>, plus this event on every flip of it (arrival, and the user
   disabling or re-enabling the extension later).

   Read from the DOM rather than through `@fkn/lib`'s `isExtensionExposed()`,
   even though this realm does own the lib. Importing it pulls the platform
   chunk and mounts the fkn.app broker iframe, which is a lot of machinery to
   answer a question the DOM answers directly, and the header renders long
   before `startPlatform()` resolves. */
const EXPOSURE_EVENT = 'FKN_WEB_EXTENSION_MAIN_WORLD_CONTENT_SCRIPT_ENABLED_EVENT_KEY'

const exposed = () => document.documentElement.dataset.fknExtension === 'true'

/* An unset flag is not yet an answer. The content script's loader lands a tick
   after document_start, which the app's own first render can beat, so treating
   absence as "missing" immediately would flash the notice at the one group of
   people who already did what it asks. Matches the lib's own exposure timeout.

   Only the ABSENT case waits: a flag that is already set is conclusive. */
const EXPOSURE_GRACE_MS = 1_000

/**
 * `undefined` while exposure is still unknown, so a caller can distinguish
 * "no extension" from "not answered yet".
 *
 * Seeded from the DOM first and only then from the last visit's answer. That
 * order is what matters: the content script runs at document_start, so an
 * exposed extension is already visible on this first render and the remembered
 * value can never contradict it. The memory only fills the gap the grace below
 * would otherwise leave, where the header would settle into its final shape
 * after paint rather than being painted in it.
 */
export const useExtensionExposed = () => {
  const [state, setState] = useState<boolean | undefined>(() =>
    exposed() || getSettings().extensionSeen
  )

  useEffect(() => {
    const read = () => {
      const now = exposed()
      setState(now)
      if (getSettings().extensionSeen !== now) updateSettings({ extensionSeen: now })
    }
    document.addEventListener(EXPOSURE_EVENT, read)
    // Re-read AFTER attaching: the flag can land in the gap between the render
    // that seeded the state and this effect, and that arrival dispatched an
    // event with nobody listening yet. Only the positive case, because an unset
    // flag is still not an answer until the grace below expires.
    if (exposed()) read()
    const timer = setTimeout(read, EXPOSURE_GRACE_MS)
    return () => {
      clearTimeout(timer)
      document.removeEventListener(EXPOSURE_EVENT, read)
    }
  }, [])

  return state
}

const style = css`
  position: relative;
  display: flex;
  align-items: center;
  flex: none;

  .pill {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease;
    /* Arrives a beat after the page rather than with it: appearing in the same
       frame as the header reads as a banner, appearing after it reads as an
       aside. */
    animation: notice-in 0.25s ease both;
  }

  .pill:hover,
  .pill[aria-expanded='true'] {
    background: var(--bg-chip-hover);
  }

  .pill svg {
    flex: none;
    color: var(--accent);
  }

  @keyframes notice-in {
    from {
      opacity: 0;
      transform: translateY(-0.4rem);
    }
  }

  .panel {
    position: absolute;
    top: calc(100% + 0.8rem);
    right: 0;
    z-index: var(--z-popup);
    /* Wide enough for both actions to sit on one row without either label
       wrapping, which is what sets it rather than the prose above them. */
    width: 36rem;
    max-width: calc(100vw - 3.2rem);
    padding: 1.6rem;
    border-radius: 1.2rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
    animation: notice-in 0.15s ease both;
  }

  .title {
    margin: 0 0 0.8rem;
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .body {
    margin: 0 0 0.8rem;
    font-size: 1.3rem;
    line-height: 1.9rem;
    color: var(--text-secondary);
  }

  .body:last-of-type {
    margin-bottom: 1.6rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .install {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    /* Paired the way the app pairs every filled control: both tokens flip with
       the theme together, so the label keeps its contrast. The inverse accent
       here would be the accent meant for the OPPOSITE background, which in
       light mode is pale blue and would carry white text at 2:1. */
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .install:hover {
    filter: brightness(1.1);
  }

  .never {
    height: 3.6rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.8rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 1.3rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .never:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* The label goes before the search box does: at this width the header is
     already tight, and the icon alone still reads as an offer. */
  @media (max-width: 1100px) {
    .pill .label {
      display: none;
    }

    .pill {
      width: 3.6rem;
      height: 3.6rem;
      padding: 0;
      justify-content: center;
      border-radius: 50%;
    }
  }
`

/**
 * A one-line offer in the header for readers running without the extension, and
 * nothing at all for everyone else.
 *
 * The installing itself is the platform's job, not this component's: the button
 * hands off to the prompt inside the trusted fkn.app overlay. What lives here is
 * the part the platform cannot know, which is why THIS app is asking. That is
 * also why `startPlatform()` leaves the automatic prompt switched off: an offer
 * with a reason attached, shown once and dismissible, is a different thing from
 * a prompt that fires on every extension-gated call.
 *
 * The tone the copy has to carry is that a missing extension is the ORDINARY
 * case here and not a fault: the relay is a complete answer on its own, so this
 * is an offer, never a warning.
 */
export const ExtensionNotice = () => {
  const extension = useExtensionExposed()
  const [suggest, setSuggest] = useState(() => getSettings().suggestExtension)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // The settings page owns the same flag, so following the store keeps the two
  // in step instead of needing a reload to notice.
  useEffect(() => subscribeSettings(settings => setSuggest(settings.suggestExtension)), [])

  const onClose = useCallback(() => setOpen(false), [])
  useDismiss({ open, onClose, rootRef, triggerRef })

  /* Hands off to the platform's own install prompt, which renders in the trusted
     fkn.app overlay and resolves once the extension is exposed. Nothing has to
     be done with that answer: the exposure hook above is watching the same
     signal, so a successful install withdraws this notice on its own.

     The panel closes first so the platform overlay is not covered by it, and
     the marketing page catches the case where the prompt cannot be shown at all
     (the broker never loaded, so `startPlatform()` rejects). The dataset flag
     marks the request the way the rest of the app marks engine state, and is
     what the browser test asserts on. */
  const install = useCallback(() => {
    setOpen(false)
    document.documentElement.dataset.extensionPrompt = 'open'
    const settle = () => {
      delete document.documentElement.dataset.extensionPrompt
    }
    void promptExtensionInstall(INSTALL_REASON).then(settle, (error: unknown) => {
      settle()
      console.warn('[yt-client] the FKN install prompt could not be shown', error)
      window.open(EXTENSION_URL, '_blank', 'noreferrer')
    })
  }, [])

  // `undefined` is "not answered yet", and it renders as nothing: the grace
  // above is what keeps this from flickering into view on a browser that turns
  // out to have the extension after all.
  if (extension !== false || !suggest) return null

  return (
    <div css={style} ref={rootRef}>
      <button
        type='button'
        className='pill'
        ref={triggerRef}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Zap size={16} strokeWidth={2} />
        <span className='label'>Faster with the extension</span>
      </button>
      {open
        ? (
          <div className='panel' role='dialog' aria-label='Faster with the FKN extension'>
            <p className='title'>Faster with the FKN extension</p>
            <p className='body'>
              Right now this app reaches YouTube through the shared FKN relay, which adds a
              round trip to every request. With the extension installed it goes straight from
              your browser, so pages and video start quicker and the relay's daily allowance
              stops applying to you.
            </p>
            <p className='body'>
              It is free, and every permission stays yours to grant or revoke per app.
            </p>
            <div className='actions'>
              <button type='button' className='install' onClick={install}>
                <Zap size={16} strokeWidth={2} />
                Get the extension
              </button>
              <button
                type='button'
                className='never'
                onClick={() => {
                  updateSettings({ suggestExtension: false })
                  setOpen(false)
                }}
              >
                Don't show this again
              </button>
            </div>
          </div>
        )
        : undefined}
    </div>
  )
}

export default ExtensionNotice
