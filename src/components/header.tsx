import type { TargetedSubmitEvent } from 'preact'

import { css } from '@emotion/react'
import { CircleUserRound, EllipsisVertical, Menu, Mic, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { gql } from '../generated'
import { AccountMenu } from './account-menu'

const HEADER_SESSION_QUERY = gql(`
  query HeaderSession {
    session {
      signedIn
      name
      avatar
      handle
    }
  }
`)

const logoStyle = css`
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  color: var(--text-primary);

  .mark {
    display: block;
    margin-top: 0.1rem;
  }

  .wordmark {
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: -0.05rem;
    line-height: 2.2rem;
    white-space: nowrap;
  }

  .region {
    font-size: 1rem;
    line-height: 1;
    color: var(--text-secondary);
  }
`

export const Logo = () => (
  <Link href='/' css={logoStyle} aria-label='yt-client home'>
    <svg className='mark' width='28' height='20' viewBox='0 0 28 20' aria-hidden='true'>
      <rect width='28' height='20' rx='4.5' fill='#ff0000' />
      <path d='M11.2 5.8 19 10l-7.8 4.2z' fill='#ffffff' />
    </svg>
    <span className='wordmark'>YT client</span>
    <sup className='region'>DEV</sup>
  </Link>
)

const style = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.6rem;
  background: var(--bg-base);

  .start {
    display: flex;
    align-items: center;
    gap: 1.6rem;
  }

  .icon-button {
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

  .icon-button:hover {
    background: var(--bg-hover);
  }

  .search {
    flex: 0 1 73.2rem;
    display: flex;
    align-items: center;
    margin: 0 4rem;
    min-width: 0;
  }

  .search-box {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    height: 4rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4rem 0 0 4rem;
    padding-left: 1.6rem;
    transition: border-color 0.15s ease;
  }

  .search-box:focus-within {
    border-color: var(--accent-focus);
    box-shadow: inset 0 0.1rem 0.2rem rgba(0, 0, 0, 0.3);
  }

  .search-box input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 1.6rem;
  }

  .search-box input::placeholder {
    color: var(--text-placeholder);
  }

  .search-button {
    flex: none;
    width: 6.4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-input-button);
    border: 1px solid var(--border);
    border-left: none;
    border-radius: 0 4rem 4rem 0;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .search-button:hover {
    background: var(--bg-chip-hover);
  }

  .mic-button {
    flex: none;
    width: 4rem;
    height: 4rem;
    margin-left: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--bg-mic);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .mic-button:hover {
    background: var(--bg-mic-hover);
  }

  .end {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .sign-in {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  @media (max-width: 792px) {
    .search {
      margin: 0 1.6rem;
    }

    .mic-button {
      display: none;
    }
  }
`

export const Header = ({ onMenu }: { onMenu?: () => void }) => {
  const [, navigate] = useLocation()
  const search = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  // Defer the session probe until the engine is ready so its accounts_list call
  // never competes with the latency-critical watch/player boot.
  const [engineReady, setEngineReady] = useState(() => document.documentElement.dataset.engine === 'ready')
  const [{ data: sessionData }] = useQuery({ query: HEADER_SESSION_QUERY, pause: !engineReady })
  const session = sessionData?.session

  useEffect(() => {
    if (engineReady) return
    const check = () => {
      if (document.documentElement.dataset.engine !== 'ready') return
      setEngineReady(true)
      observer.disconnect()
    }
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-engine'] })
    check()
    return () => observer.disconnect()
  }, [engineReady])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Only /results carries search_query, so reading it off whatever the current
  // location is keeps the box filled there and empty everywhere else.
  const currentQuery = new URLSearchParams(search).get('search_query') ?? undefined

  const onSubmit = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = inputRef.current?.value.trim()
    if (query) navigate(`/results?search_query=${encodeURIComponent(query)}`)
  }

  return (
    <header css={style}>
      <div className='start'>
        <button type='button' className='icon-button' aria-label='Guide' onClick={onMenu}>
          <Menu size={24} strokeWidth={1.5} />
        </button>
        <Logo />
      </div>
      <form className='search' role='search' onSubmit={onSubmit}>
        <div className='search-box'>
          <input
            key={currentQuery ?? ''}
            ref={inputRef}
            name='search_query'
            type='search'
            placeholder='Search'
            aria-label='Search'
            defaultValue={currentQuery}
            autoComplete='off'
          />
        </div>
        <button type='submit' className='search-button' aria-label='Search'>
          <Search size={24} strokeWidth={1.5} />
        </button>
        <button type='button' className='mic-button' aria-label='Search with your voice'>
          <Mic size={24} strokeWidth={1.5} />
        </button>
      </form>
      <div className='end'>
        <button type='button' className='icon-button' aria-label='Settings'>
          <EllipsisVertical size={24} strokeWidth={1.5} />
        </button>
        {session?.signedIn
          ? <AccountMenu name={session.name ?? undefined} avatar={session.avatar ?? undefined} handle={session.handle ?? undefined} />
          : (
            <button type='button' className='sign-in' onClick={() => navigate('/signin')}>
              <CircleUserRound size={24} strokeWidth={1.5} />
              Sign in
            </button>
          )}
      </div>
    </header>
  )
}

export default Header
