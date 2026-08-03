import type { TargetedEvent, TargetedKeyboardEvent, TargetedSubmitEvent } from 'preact'

import { css } from '@emotion/react'
import { CircleUserRound, EllipsisVertical, Menu, Mic, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { gql } from '../generated'
import { AccountMenu } from './account-menu'
import { ExtensionNotice } from './extension-notice'
import { NotificationsMenu } from './notifications-menu'

const SEARCH_SUGGESTIONS_QUERY = gql(`
  query SearchSuggestions($query: String!) {
    searchSuggestions(query: $query)
  }
`)

const SUGGEST_DEBOUNCE_MS = 200

const HEADER_SESSION_QUERY = gql(`
  query HeaderSession {
    session {
      signedIn
      name
      avatar
      handle
      accounts { index name avatar handle selected hasChannel }
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
    /* Anchors the suggestion list, which hangs below the box rather than
       participating in the header's own row layout. */
    position: relative;
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

  .suggestions {
    position: absolute;
    top: calc(100% + 0.4rem);
    left: -1.6rem;
    right: -1px;
    z-index: var(--z-popup);
    margin: 0;
    padding: 0.8rem 0;
    list-style: none;
    border-radius: 1.2rem;
    background: var(--bg-menu);
    box-shadow: 0 4px 32px rgba(0, 0, 0, 0.3);
    max-height: 60vh;
    overflow-y: auto;
  }

  .suggestion {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0.6rem 1.6rem;
    color: var(--text-primary);
    font-size: 1.6rem;
    cursor: pointer;
  }

  .suggestion:hover,
  .suggestion.active {
    background: var(--bg-hover);
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
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const [debounced, setDebounced] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
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

  // src/scramjet/client.ts has no cancellation path for a non-segment call, so the debounce is load-bearing rather than a nicety
  useEffect(() => {
    if (typed === undefined) return
    const timer = setTimeout(() => setDebounced(typed.trim()), SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const [{ data: suggestData }] = useQuery({
    query: SEARCH_SUGGESTIONS_QUERY,
    variables: { query: debounced },
    pause: !engineReady || debounced.length === 0 || !suggestOpen,
  })
  const suggestions = suggestOpen ? suggestData?.searchSuggestions ?? [] : []

  const currentQuery = new URLSearchParams(search).get('search_query') ?? undefined

  const submitQuery = (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setSuggestOpen(false)
    setActiveSuggestion(-1)
    setTyped(undefined)
    navigate(`/results?search_query=${encodeURIComponent(trimmed)}`)
  }

  const onSearchKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = activeSuggestion + step
      const wrapped = next < -1 ? suggestions.length - 1 : next >= suggestions.length ? -1 : next
      setActiveSuggestion(wrapped)
      if (inputRef.current) inputRef.current.value = wrapped === -1 ? typed ?? '' : suggestions[wrapped] ?? ''
      return
    }
    if (event.key === 'Escape' && activeSuggestion !== -1) {
      event.preventDefault()
      setActiveSuggestion(-1)
      if (inputRef.current) inputRef.current.value = typed ?? ''
      return
    }
    if (event.key === 'Escape') setSuggestOpen(false)
  }

  const onSubmit = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitQuery(inputRef.current?.value ?? '')
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
            /* `type='search'` renders a native clear affordance that steals the Escape key from the listbox */
            type='text'
            placeholder='Search'
            aria-label='Search'
            defaultValue={currentQuery}
            autoComplete='off'
            role='combobox'
            aria-expanded={suggestions.length > 0}
            aria-controls='search-suggestions'
            aria-autocomplete='list'
            aria-activedescendant={activeSuggestion === -1 ? undefined : `suggestion-${activeSuggestion}`}
            onInput={(event: TargetedEvent<HTMLInputElement>) => {
              setTyped(event.currentTarget.value)
              setSuggestOpen(true)
              setActiveSuggestion(-1)
            }}
            onFocus={() => setSuggestOpen(true)}
            /* a blur that lands on a suggestion would close the list before the click resolves, so the commit runs on pointerdown below */
            onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
            onKeyDown={onSearchKeyDown}
          />
          {suggestions.length > 0
            ? (
              <ul className='suggestions' id='search-suggestions' role='listbox'>
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion}
                    id={`suggestion-${index}`}
                    role='option'
                    aria-selected={index === activeSuggestion}
                    className={index === activeSuggestion ? 'suggestion active' : 'suggestion'}
                    onPointerDown={(event: TargetedEvent<HTMLLIElement>) => {
                      event.preventDefault()
                      submitQuery(suggestion)
                    }}
                  >
                    <Search size={16} strokeWidth={1.5} />
                    {suggestion}
                  </li>
                ))}
              </ul>
            )
            : undefined}
        </div>
        <button type='submit' className='search-button' aria-label='Search'>
          <Search size={24} strokeWidth={1.5} />
        </button>
        <button type='button' className='mic-button' aria-label='Search with your voice'>
          <Mic size={24} strokeWidth={1.5} />
        </button>
      </form>
      <div className='end'>
        {/* renders nothing at all with the extension installed, or once declined */}
        <ExtensionNotice />
        <Link href='/settings' className='icon-button' aria-label='Settings'>
          <EllipsisVertical size={24} strokeWidth={1.5} />
        </Link>
        <NotificationsMenu />
        {session?.signedIn
          ? <AccountMenu
              name={session.name ?? undefined}
              avatar={session.avatar ?? undefined}
              handle={session.handle ?? undefined}
              accounts={session.accounts.map((account) => ({
                index: account.index,
                name: account.name ?? undefined,
                avatar: account.avatar ?? undefined,
                handle: account.handle ?? undefined,
                selected: account.selected ?? undefined,
                hasChannel: account.hasChannel ?? undefined,
              }))}
            />
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
