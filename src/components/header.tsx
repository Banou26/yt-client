import type { TargetedSubmitEvent } from 'preact'

import { css } from '@emotion/react'
import { CircleUserRound, EllipsisVertical, Menu, Mic, Search } from 'lucide-react'
import { useEffect, useRef } from 'preact/hooks'
import { Link, useLocation, useRoute } from 'wouter'

import { safeDecode } from './format'

const logoStyle = css`
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  color: #f1f1f1;

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
    color: #aaaaaa;
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
  height: 5.6rem;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.6rem;
  background: #0f0f0f;

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
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .icon-button:hover {
    background: rgba(255, 255, 255, 0.1);
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
    background: #121212;
    border: 1px solid #303030;
    border-radius: 4rem 0 0 4rem;
    padding-left: 1.6rem;
    transition: border-color 0.15s ease;
  }

  .search-box:focus-within {
    border-color: #1c62b9;
    box-shadow: inset 0 0.1rem 0.2rem rgba(0, 0, 0, 0.3);
  }

  .search-box input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: #f1f1f1;
    font-size: 1.6rem;
  }

  .search-box input::placeholder {
    color: #888888;
  }

  .search-button {
    flex: none;
    width: 6.4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #222222;
    border: 1px solid #303030;
    border-left: none;
    border-radius: 0 4rem 4rem 0;
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .search-button:hover {
    background: #3f3f3f;
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
    background: #181818;
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .mic-button:hover {
    background: #272727;
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
    border: 1px solid #3f3f3f;
    border-radius: 1.8rem;
    background: transparent;
    color: #3ea6ff;
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: rgba(62, 166, 255, 0.15);
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
  const [matchesSearch, searchParams] = useRoute('/search/:query')
  const inputRef = useRef<HTMLInputElement>(null)

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

  const currentQuery = matchesSearch && searchParams?.query ? safeDecode(searchParams.query) : undefined

  const onSubmit = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = inputRef.current?.value.trim()
    if (query) navigate(`/search/${encodeURIComponent(query)}`)
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
        <button type='button' className='sign-in'>
          <CircleUserRound size={24} strokeWidth={1.5} />
          Sign in
        </button>
      </div>
    </header>
  )
}

export default Header
