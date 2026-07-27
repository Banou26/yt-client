import { css } from '@emotion/react'
import { LogOut } from 'lucide-react'
import { useCallback, useRef, useState } from 'preact/hooks'

import { clearSessionCookies, startEngine } from '../scramjet/client'
import { useDismiss } from './ui/popup'

const style = css`
  position: relative;

  .avatar-button {
    display: block;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    overflow: hidden;
    background: transparent;
    cursor: pointer;
  }

  .avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .initial {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 1.6rem;
    font-weight: 500;
    text-transform: uppercase;
  }

  .menu {
    position: absolute;
    top: calc(100% + 0.8rem);
    right: 0;
    min-width: 26rem;
    padding: 0.8rem 0;
    border-radius: 1.2rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
  }

  .account {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 0.8rem 1.6rem 1.6rem;
  }

  .account .avatar,
  .account .initial {
    flex: none;
    width: 4rem;
    height: 4rem;
    font-size: 2rem;
  }

  .identity {
    min-width: 0;
  }

  .name {
    font-size: 1.6rem;
    font-weight: 400;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .handle {
    font-size: 1.4rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .divider {
    height: 1px;
    margin: 0 0 0.8rem;
    background: var(--border-subtle);
  }

  .sign-out {
    width: 100%;
    height: 4rem;
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 0 1.6rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .sign-out:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .sign-out:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sign-out-error {
    margin: 0.4rem 1.6rem 0;
    font-size: 1.2rem;
    color: var(--danger);
  }
`

const Avatar = ({ name, avatar }: { name?: string, avatar?: string }) =>
  avatar
    ? <img className='avatar' src={avatar} alt='' referrerpolicy='no-referrer' />
    : <span className='initial' aria-hidden='true'>{name?.trim().charAt(0) || '?'}</span>

export const AccountMenu = ({ name, avatar, handle }: { name?: string, avatar?: string, handle?: string }) => {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const onClose = useCallback(() => setOpen(false), [])
  useDismiss({ open, onClose, rootRef, triggerRef })

  const onSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError(false)
    // identity residue self-heals via token recovery — but the cookie clear IS
    // the sign-out: only reload once the jar is actually gone, else the user
    // comes back signed in believing they signed out.
    try {
      await (await startEngine()).resetIdentity()
    } catch {}
    try {
      await clearSessionCookies()
    } catch {
      setSigningOut(false)
      setSignOutError(true)
      return
    }
    // Full reload rebuilds the engine frame on the now-anonymous jar.
    location.assign('/')
  }

  return (
    <div css={style} ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        className='avatar-button'
        aria-label='Account menu'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Avatar name={name} avatar={avatar} />
      </button>
      {open
        ? (
          <div className='menu' role='menu' aria-label='Account'>
            <div className='account' role='presentation'>
              <Avatar name={name} avatar={avatar} />
              <div className='identity'>
                <div className='name'>{name}</div>
                {handle ? <div className='handle'>{handle.startsWith('@') ? handle : `@${handle}`}</div> : undefined}
              </div>
            </div>
            <div className='divider' role='presentation' />
            <button type='button' className='sign-out' role='menuitem' disabled={signingOut} onClick={onSignOut}>
              <LogOut size={20} strokeWidth={1.5} />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            {signOutError ? <p className='sign-out-error'>Couldn’t clear the session — try again.</p> : undefined}
          </div>
        )
        : undefined}
    </div>
  )
}

export default AccountMenu
