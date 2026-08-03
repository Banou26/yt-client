import { css } from '@emotion/react'
import { Check, CircleUser, LogOut } from 'lucide-react'
import { useState } from 'preact/hooks'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import { clearSessionCookies, startEngine } from '../scramjet/client'
import { useSession } from '../session'

const style = css`
  max-width: 78rem;
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .current {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding: 1.6rem;
    border: 1px solid var(--border);
    border-radius: 1.2rem;
  }

  .current .avatar,
  .current .initial {
    width: 6.4rem;
    height: 6.4rem;
    font-size: 2.8rem;
  }

  .avatar {
    border-radius: 50%;
    object-fit: cover;
    flex: none;
  }

  .initial {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 500;
    text-transform: uppercase;
  }

  .identity { min-width: 0; }

  .name {
    font-size: 1.8rem;
    color: var(--text-primary);
  }

  .handle {
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .section {
    margin-top: 3.2rem;
  }

  .section-heading {
    margin: 0 0 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .hint {
    margin: 0 0 1.2rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    margin-bottom: 0.8rem;
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
  .row:disabled { cursor: default; }
  .row.selected { cursor: default; }

  .row .avatar,
  .row .initial {
    width: 3.2rem;
    height: 3.2rem;
    font-size: 1.4rem;
  }

  .row .label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row .state {
    flex: none;
    font-size: 1.2rem;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .danger {
    color: var(--danger);
  }

  .error {
    margin-top: 0.8rem;
    font-size: 1.3rem;
    color: var(--danger);
  }

  .signed-out {
    color: var(--text-secondary);
    font-size: 1.4rem;
  }
`

const Avatar = ({ name, avatar }: { name?: string, avatar?: string }) =>
  avatar
    ? <img className='avatar' src={avatar} alt='' referrerpolicy='no-referrer' />
    : <span className='initial' aria-hidden='true'>{name?.trim().charAt(0) || '?'}</span>

export const AccountPage = () => {
  useDocumentTitle('Account')
  const { ready, signedIn, name, avatar, handle, accounts } = useSession()
  const [switching, setSwitching] = useState<number>()
  const [signingOut, setSigningOut] = useState(false)
  const [failed, setFailed] = useState<string>()

  const busy = signingOut || switching !== undefined

  // youtubei.js has no runtime identity switch, so recording the choice and reloading IS the switch
  const onSwitch = async (index: number) => {
    if (busy) return
    setSwitching(index)
    setFailed(undefined)
    try {
      await (await startEngine()).switchAccount(index)
    } catch {
      setSwitching(undefined)
      setFailed('Could not switch account. Try again.')
      return
    }
    location.assign('/')
  }

  const onSignOut = async () => {
    if (busy) return
    setSigningOut(true)
    setFailed(undefined)
    try {
      await (await startEngine()).resetIdentity()
    } catch {}
    try {
      // The cookie clear IS the sign-out, so only reload once the jar is gone
      await clearSessionCookies()
    } catch {
      setSigningOut(false)
      setFailed('Could not clear the session. Try again.')
      return
    }
    location.assign('/')
  }

  if (ready && !signedIn) {
    return (
      <main css={style}>
        <h1 className='heading'>Account</h1>
        <p className='signed-out'>
          You are not signed in. <Link href='/signin'>Sign in</Link> to switch between accounts.
        </p>
      </main>
    )
  }

  return (
    <main css={style}>
      <h1 className='heading'>Account</h1>
      <div className='current'>
        <Avatar name={name} avatar={avatar} />
        <div className='identity'>
          <div className='name'>{name ?? 'Signed in'}</div>
          {handle ? <div className='handle'>{handle.startsWith('@') ? handle : `@${handle}`}</div> : undefined}
        </div>
      </div>

      {handle
        ? (
          <div className='section'>
            <Link className='row' href={`/channel/${handle.startsWith('@') ? handle : `@${handle}`}`}>
              <CircleUser size={20} strokeWidth={1.5} />
              <span className='label'>Your channel</span>
            </Link>
          </div>
        )
        : undefined}

      {accounts.length > 1
        ? (
          <div className='section'>
            <h2 className='section-heading'>Accounts</h2>
            <p className='hint'>
              Switching reloads the app: the connection to YouTube is rebuilt for the account you pick.
            </p>
            {accounts.map((account) => (
              <button
                key={account.index}
                type='button'
                className={`row ${account.selected ? 'selected' : ''}`}
                disabled={busy || account.selected}
                onClick={() => onSwitch(account.index)}
              >
                <Avatar name={account.name} avatar={account.avatar} />
                <span className='label'>
                  {account.name ?? account.handle ?? `Account ${account.index + 1}`}
                </span>
                <span className='state'>
                  {account.selected
                    ? <><Check size={16} strokeWidth={1.5} /> Current</>
                    : switching === account.index ? 'Switching…' : undefined}
                </span>
              </button>
            ))}
          </div>
        )
        : undefined}

      <div className='section'>
        <button type='button' className='row danger' disabled={busy} onClick={onSignOut}>
          <LogOut size={20} strokeWidth={1.5} />
          <span className='label'>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
        {failed ? <p className='error'>{failed}</p> : undefined}
      </div>
    </main>
  )
}

export default AccountPage
