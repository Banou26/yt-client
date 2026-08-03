import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

import { closeSignIn, openSignIn, startEngine } from '../scramjet/client'

const style = css`
  min-height: calc(100vh - var(--header-height));

  /* Full overlay above the host sign-in frame (--z-host-frame) until Google's
     login page paints, so the user never stares at a blank dark panel. */
  .loading {
    position: fixed;
    top: var(--header-height);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: calc(var(--z-host-frame) + 50);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.8rem;
    background: var(--bg-base);
  }

  .spinner {
    width: 3.6rem;
    height: 3.6rem;
    border: 0.3rem solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: signin-spin 0.8s linear infinite;
  }

  @keyframes signin-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .status {
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .error {
    max-width: 42rem;
    font-size: 1.4rem;
    color: var(--danger);
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 0.8rem;
  }

  .retry {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  /* Cancel floats above BOTH the loader and the login frame so the flow is
     always escapable. It overlays Google's login page, which is white whatever
     this app's theme is, so it deliberately does NOT track the theme: tracking
     it would make the one escape hatch near-invisible in light mode. */
  .cancel {
    position: fixed;
    bottom: 2.4rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: calc(var(--z-host-frame) + 100);
    height: 3.6rem;
    padding: 0 1.6rem;
    border: 1px solid #3f3f3f;
    border-radius: 1.8rem;
    background: #212121;
    color: #f1f1f1;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .cancel:hover {
    background: #3f3f3f;
  }
`

const SignInPage = () => {
  const [, navigate] = useLocation()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setError(undefined)
    const revealTimer = setTimeout(() => { if (active) setLoaded(true) }, 20000)
    void openSignIn({ onLoaded: () => { if (active) setLoaded(true) } })
      .then(async () => {
        if (!active) return
        await (await startEngine()).resetIdentity().catch(() => {})
        location.assign('/')
      })
      .catch((cause: Error) => {
        if (!active || /sign-in (closed|restarted)/.test(String(cause?.message))) return
        setError(String(cause?.message ?? cause))
      })
    return () => {
      active = false
      clearTimeout(revealTimer)
      closeSignIn()
    }
  }, [attempt])

  return (
    <main css={style}>
      {error
        ? (
          <div className='loading'>
            <p className='error'>Sign-in failed: {error}</p>
            <div className='actions'>
              <button type='button' className='retry' onClick={() => setAttempt(value => value + 1)}>Retry</button>
            </div>
          </div>
        )
        : !loaded
          ? (
            <div className='loading'>
              <div className='spinner' />
              <p className='status'>Loading the secure sign-in page…</p>
            </div>
          )
          : undefined}
      <button type='button' className='cancel' onClick={() => navigate('/')}>Cancel sign-in</button>
    </main>
  )
}

export default SignInPage
