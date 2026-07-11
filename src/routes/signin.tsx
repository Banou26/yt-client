import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

import { closeSignIn, openSignIn, startEngine } from '../scramjet/client'

const style = css`
  min-height: calc(100vh - 5.6rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.6rem;
  padding: 2.4rem 1.6rem;

  p {
    font-size: 1.4rem;
    color: #aaaaaa;
  }

  .actions {
    display: flex;
    gap: 0.8rem;
  }

  /* the sign-in overlay (host iframe) sits at z-index 1500 over the page —
     the cancel affordance floats above it so the flow is always escapable. */
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
`

const SignInPage = () => {
  const [, navigate] = useLocation()
  const [error, setError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setError(undefined)
    void openSignIn()
      .then(async () => {
        if (!active) return
        // Full reload picks up the authenticated jar with clean identity state.
        await (await startEngine()).resetIdentity().catch(() => {})
        location.assign('/')
      })
      .catch((cause: Error) => {
        // deliberate closes (cancel/unmount) keep the page copy; genuine
        // failures surface with a retry.
        if (!active || /sign-in (closed|restarted)/.test(String(cause?.message))) return
        setError(String(cause?.message ?? cause))
      })
    return () => {
      active = false
      closeSignIn()
    }
  }, [attempt])

  return (
    <main css={style}>
      {error
        ? (
          <>
            <p>Sign-in failed: {error}</p>
            <div className='actions'>
              <button type='button' className='retry' onClick={() => setAttempt(value => value + 1)}>Retry</button>
            </div>
          </>
        )
        : <p>Signing in through the secure proxy…</p>}
      <button type='button' className='cancel' onClick={() => navigate('/')}>Cancel sign-in</button>
    </main>
  )
}

export default SignInPage
