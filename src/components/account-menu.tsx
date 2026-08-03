import type { SessionAccount } from '../session'

import { css } from '@emotion/react'
import { Check, CircleUser, LogOut, UserRoundCog } from 'lucide-react'
import { useCallback, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

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

  .row {
    width: 100%;
    min-height: 4rem;
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 0.6rem 1.6rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .row:hover:not(:disabled) { background: var(--bg-hover); }
  .row:disabled { opacity: 0.5; cursor: default; }

  .row .avatar,
  .row .initial {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    font-size: 1.2rem;
  }

  .row .label {
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .section-title {
    padding: 0.8rem 1.6rem 0.4rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }
`

const Avatar = ({ name, avatar }: { name?: string, avatar?: string }) =>
  avatar
    ? <img className='avatar' src={avatar} alt='' referrerpolicy='no-referrer' />
    : <span className='initial' aria-hidden='true'>{name?.trim().charAt(0) || '?'}</span>

export const AccountMenu = (
  { name, avatar, handle, accounts = [] }: {
    name?: string
    avatar?: string
    handle?: string
    accounts?: SessionAccount[]
  },
) => {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [switching, setSwitching] = useState<number>()
  const [signOutError, setSignOutError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const onClose = useCallback(() => setOpen(false), [])
  useDismiss({ open, onClose, rootRef, triggerRef })

  const onSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError(false)
    // the cookie clear IS the sign-out: only reload once the jar is actually gone
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
    location.assign('/')
  }

  // youtubei.js has no runtime switch, so the frame only RECORDS the choice and the reload applies it
  const onSwitch = async (index: number) => {
    if (switching !== undefined || signingOut) return
    setSwitching(index)
    try {
      await (await startEngine()).switchAccount(index)
    } catch {
      setSwitching(undefined)
      return
    }
    location.assign('/')
  }

  const busy = signingOut || switching !== undefined
  const switchable = accounts.filter((account) => !account.selected)

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
            {/* By handle: the account endpoint carries GAIA tokens, not a browse id */}
            {handle
              ? (
                <Link className='row' role='menuitem' href={`/channel/${handle.startsWith('@') ? handle : `@${handle}`}`} onClick={onClose}>
                  <CircleUser size={20} strokeWidth={1.5} />
                  <span className='label'>Your channel</span>
                </Link>
              )
              : undefined}
            <Link className='row' role='menuitem' href='/account' onClick={onClose}>
              <UserRoundCog size={20} strokeWidth={1.5} />
              <span className='label'>Manage account</span>
            </Link>
            {switchable.length
              ? (
                <>
                  <div className='divider' role='presentation' />
                  <div className='section-title' role='presentation'>Switch account</div>
                  {switchable.map((account) => (
                    <button
                      key={account.index}
                      type='button'
                      className='row'
                      role='menuitem'
                      disabled={busy}
                      onClick={() => onSwitch(account.index)}
                    >
                      <Avatar name={account.name} avatar={account.avatar} />
                      <span className='label'>{account.name ?? account.handle ?? `Account ${account.index + 1}`}</span>
                      {switching === account.index ? <Check size={16} strokeWidth={1.5} /> : undefined}
                    </button>
                  ))}
                </>
              )
              : undefined}
            <div className='divider' role='presentation' />
            <button type='button' className='sign-out' role='menuitem' disabled={busy} onClick={onSignOut}>
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
