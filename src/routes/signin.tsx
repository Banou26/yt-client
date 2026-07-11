import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

import { closeSignIn, openSignIn, startEngine } from '../scramjet/client'

const style = css`
  min-height: calc(100vh - 5.6rem);

  /* Full overlay above the host sign-in frame (z-index 1500) until Google's
     login page paints, so the user never stares at a blank dark panel. */
  .loading {
    position: fixed;
    top: 5.6rem;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1550;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.8rem;
    background: #0f0f0f;
  }

  .spinner {
    width: 3.6rem;
    height: 3.6rem;
    border: 0.3rem solid #272727;
    border-top-color: #3ea6ff;
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
    color: #aaaaaa;
  }

  .error {
    max-width: 42rem;
    font-size: 1.4rem;
    color: #f28b82;
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
    background: #f1f1f1;
    color: #0f0f0f;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }

  /* Cancel floats above BOTH the loader and the login frame so the flow is
     always escapable. */
  .cancel {
    position: fixed;
    bottom: 2.4rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1600;
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
    // Fallback: reveal the frame after a max wait even if the loaded signal
    // never arrives (e.g. a page that renders slowly or oddly through the
    // proxy), so the user is never stranded on an endless spinner.
    const revealTimer = setTimeout(() => { if (active) setLoaded(true) }, 12000)
    void openSignIn({ onLoaded: () => { if (active) setLoaded(true) } })
      .then(async () => {
        if (!active) return
        // Full reload picks up the authenticated jar with clean identity state.
        await (await startEngine()).resetIdentity().catch(() => {})
        location.assign('/')
      })
      .catch((cause: Error) => {
        // deliberate closes (cancel/unmount) keep quiet; genuine failures surface.
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
