import type { FunctionComponent } from 'preact'

import { css } from '@emotion/react'
import { Clapperboard, Flame, Gamepad2, History, House, ListVideo, Menu, Music2 } from 'lucide-react'
import { useEffect } from 'preact/hooks'
import { Link, useLocation } from 'wouter'

import { Logo } from './header'

type GuideEntry = {
  label: string
  href: string
  Icon: FunctionComponent<{ size?: number, strokeWidth?: number }>
  match?: string
}

const MAIN_ENTRIES: GuideEntry[] = [
  { label: 'Home', href: '/', Icon: House, match: '/' },
  { label: 'Shorts', href: '/', Icon: Clapperboard },
  { label: 'Subscriptions', href: '/', Icon: ListVideo }
]

const YOU_ENTRIES: GuideEntry[] = [
  { label: 'History', href: '/', Icon: History }
]

const EXPLORE_ENTRIES: GuideEntry[] = [
  { label: 'Trending', href: '/', Icon: Flame },
  { label: 'Music', href: '/search/Music', Icon: Music2, match: '/search/Music' },
  { label: 'Gaming', href: '/search/Gaming', Icon: Gamepad2, match: '/search/Gaming' }
]

const MINI_ENTRIES: GuideEntry[] = [...MAIN_ENTRIES, ...YOU_ENTRIES]

const FOOTER_LINKS = ['About', 'Press', 'Contact', 'Terms', 'Privacy', 'Developers']

const sectionsStyle = css`
  .section {
    padding-bottom: 1.2rem;
  }

  .section + .section {
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    margin-top: 1.2rem;
    padding-top: 1.2rem;
  }

  .section-title {
    padding: 0.6rem 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: #f1f1f1;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    height: 4rem;
    padding: 0 1.2rem;
    border-radius: 1rem;
    color: #f1f1f1;
    font-size: 1.4rem;
    font-weight: 400;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .item svg {
    flex: none;
  }

  .item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .item.active {
    background: #272727;
    font-weight: 500;
  }

  .footer {
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    margin-top: 1.2rem;
    padding: 1.6rem 1.2rem;
    color: #aaaaaa;
    font-size: 1.2rem;
    line-height: 1.8rem;
  }

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    font-weight: 500;
    margin-bottom: 1.2rem;
  }

  .copyright {
    color: #717171;
  }
`

const GuideSections = () => {
  const [location] = useLocation()

  const renderEntry = (entry: GuideEntry) => (
    <Link
      key={entry.label}
      href={entry.href}
      className={entry.match !== undefined && entry.match === location ? 'item active' : 'item'}
    >
      <entry.Icon size={24} strokeWidth={1.5} />
      <span className='label'>{entry.label}</span>
    </Link>
  )

  return (
    <div css={sectionsStyle}>
      <div className='section'>
        {MAIN_ENTRIES.map(renderEntry)}
      </div>
      <div className='section'>
        <div className='section-title'>You</div>
        {YOU_ENTRIES.map(renderEntry)}
      </div>
      <div className='section'>
        <div className='section-title'>Explore</div>
        {EXPLORE_ENTRIES.map(renderEntry)}
      </div>
      <div className='footer'>
        <div className='footer-links'>
          {FOOTER_LINKS.map(label => <span key={label}>{label}</span>)}
        </div>
        <div className='copyright'>© 2026 yt-client</div>
      </div>
    </div>
  )
}

const expandedStyle = css`
  position: fixed;
  top: 5.6rem;
  bottom: 0;
  left: 0;
  width: 24rem;
  padding: 1.2rem;
  overflow-y: auto;
  background: #0f0f0f;
  z-index: 1000;
`

const miniStyle = css`
  position: fixed;
  top: 5.6rem;
  bottom: 0;
  left: 0;
  width: 7.2rem;
  padding: 0 0.4rem;
  overflow-y: auto;
  background: #0f0f0f;
  z-index: 1000;

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 1.6rem 0;
    border-radius: 1rem;
    color: #f1f1f1;
    transition: background 0.15s ease;
  }

  .item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .item .label {
    font-size: 1rem;
  }

  .item.active .label {
    font-weight: 500;
  }
`

const drawerStyle = css`
  position: fixed;
  inset: 0;
  z-index: 2100;

  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
  }

  .panel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 24rem;
    overflow-y: auto;
    background: #0f0f0f;
    animation: guide-slide-in 0.2s ease;
  }

  @keyframes guide-slide-in {
    from {
      transform: translateX(-100%);
    }

    to {
      transform: translateX(0);
    }
  }

  .panel-header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 1.6rem;
    height: 5.6rem;
    padding: 0 1.6rem;
    background: #0f0f0f;
    z-index: 1;
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

  .panel-sections {
    padding: 1.2rem;
  }
`

export const Guide = (
  { variant, onClose }:
  { variant: 'expanded' | 'mini' | 'drawer', onClose?: () => void }
) => {
  const [location] = useLocation()

  useEffect(() => {
    if (variant !== 'drawer') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [variant, onClose])

  return (
    variant === 'mini'
      ? (
        <nav css={miniStyle} aria-label='Guide'>
          {MINI_ENTRIES.map(entry => (
            <Link
              key={entry.label}
              href={entry.href}
              className={entry.match !== undefined && entry.match === location ? 'item active' : 'item'}
            >
              <entry.Icon size={24} strokeWidth={1.5} />
              <span className='label'>{entry.label}</span>
            </Link>
          ))}
        </nav>
      )
      : variant === 'drawer'
        ? (
          <div css={drawerStyle}>
            <div className='scrim' onClick={onClose} />
            <nav className='panel' role='dialog' aria-modal='true' aria-label='Guide'>
              <div className='panel-header'>
                <button type='button' className='icon-button' aria-label='Close guide' onClick={onClose}>
                  <Menu size={24} strokeWidth={1.5} />
                </button>
                <Logo />
              </div>
              <div className='panel-sections'>
                <GuideSections />
              </div>
            </nav>
          </div>
        )
        : (
          <nav css={expandedStyle} aria-label='Guide'>
            <GuideSections />
          </nav>
        )
  )
}

export default Guide
