import type { FunctionComponent } from 'preact'

import { css } from '@emotion/react'
import { Clapperboard, Clock, Flame, Gamepad2, History, House, Library, ListVideo, Menu, Music2, ThumbsUp } from 'lucide-react'
import { useEffect } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { gql } from '../generated'
import { useSession } from '../session'
import { Logo } from './header'
import { LIKED_VIDEOS_ID, playlistHrefFor, WATCH_LATER_ID } from './playlist'

const GUIDE_SUBSCRIPTIONS_QUERY = gql(`
  query GuideSubscriptions {
    subscribedChannels {
      id
      name
      avatar
    }
  }
`)

type GuideEntry = {
  label: string
  href: string
  Icon: FunctionComponent<{ size?: number, strokeWidth?: number }>
  match?: string
}

const MAIN_ENTRIES: GuideEntry[] = [
  { label: 'Home', href: '/', Icon: House, match: '/' },
  // No Shorts route exists yet (Phase 7), so this lands on Home instead of
  // linking to a page that is not there. No `match`: it is never the current page.
  { label: 'Shorts', href: '/', Icon: Clapperboard },
  { label: 'Subscriptions', href: '/feed/subscriptions', Icon: ListVideo, match: '/feed/subscriptions' }
]

const HISTORY_ENTRY: GuideEntry = { label: 'History', href: '/feed/history', Icon: History, match: '/feed/history' }

// Watch later and Liked videos are ordinary playlists with fixed ids upstream,
// so they address the same route the library cards do rather than getting a
// page each. Their `match` holds the whole query string, which is why a row
// opened at a position (?list=WL&index=4) stops lighting the entry: the same
// limitation the Music and Gaming search entries already have.
const YOU_ENTRIES: GuideEntry[] = [
  HISTORY_ENTRY,
  { label: 'Playlists', href: '/feed/playlists', Icon: Library, match: '/feed/playlists' },
  { label: 'Watch later', href: playlistHrefFor(WATCH_LATER_ID), Icon: Clock, match: playlistHrefFor(WATCH_LATER_ID) },
  { label: 'Liked videos', href: playlistHrefFor(LIKED_VIDEOS_ID), Icon: ThumbsUp, match: playlistHrefFor(LIKED_VIDEOS_ID) }
]

const EXPLORE_ENTRIES: GuideEntry[] = [
  // No Trending route exists yet (Phase 5), same placeholder as Shorts above.
  { label: 'Trending', href: '/', Icon: Flame },
  { label: 'Music', href: '/results?search_query=Music', Icon: Music2, match: '/results?search_query=Music' },
  { label: 'Gaming', href: '/results?search_query=Gaming', Icon: Gamepad2, match: '/results?search_query=Gaming' }
]

// The mini rail is an icon column one short label wide, so it keeps carrying the
// top-level destinations only: 'Watch later' and 'Liked videos' do not fit on
// one 1rem line there, and the rail is not where the library is browsed from.
const MINI_ENTRIES: GuideEntry[] = [...MAIN_ENTRIES, HISTORY_ENTRY]

const FOOTER_LINKS = ['About', 'Press', 'Contact', 'Terms', 'Privacy', 'Developers']

// Prefix rather than equality, so a route nested under an entry (a section of
// History, a channel tab) keeps that entry lit. Home is the one entry whose
// prefix is every path, so it only ever matches exactly.
const isActive = (match: string | undefined, path: string, search: string) => {
  if (match === undefined) return false
  // Query-backed entries have to match the query too: without it every search
  // result would light up Music. wouter's useSearch keeps the leading '?', so
  // it is stripped before joining or the result is '/results??search_query=...'
  // and never matches.
  const query = search.startsWith('?') ? search.slice(1) : search
  const current = match.includes('?') && query ? `${path}?${query}` : path
  return current === match || current.startsWith(`${match}/`)
}

const GuideLink = ({ entry }: { entry: GuideEntry }) => {
  const [path] = useLocation()
  const search = useSearch()
  const active = isActive(entry.match, path, search)
  return (
    <Link
      href={entry.href}
      className={active ? 'item active' : 'item'}
      aria-current={active ? 'page' : undefined}
    >
      <entry.Icon size={24} strokeWidth={1.5} />
      <span className='label'>{entry.label}</span>
    </Link>
  )
}

const SubscriptionRail = () => {
  const { signedIn } = useSession()
  const [path] = useLocation()
  // The guide renders on every route, so an ungated query would make every
  // anonymous page load pay a round trip that can only come back as an error.
  const [{ data }] = useQuery({ query: GUIDE_SUBSCRIPTIONS_QUERY, pause: !signedIn })
  const channels = data?.subscribedChannels ?? []

  if (!signedIn || channels.length === 0) return null

  return (
    <div className='section'>
      <div className='section-title'>Subscriptions</div>
      {channels.map(channel => {
        const href = `/channel/${channel.id}`
        const active = isActive(href, path, '')
        return (
          <Link
            key={channel.id}
            href={href}
            className={active ? 'item active' : 'item'}
            aria-current={active ? 'page' : undefined}
          >
            {channel.avatar
              ? <img className='avatar' src={channel.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
              : <span className='avatar fallback' aria-hidden='true'>{channel.name.slice(0, 1).toUpperCase()}</span>}
            <span className='label channel-name'>{channel.name}</span>
          </Link>
        )
      })}
    </div>
  )
}

const sectionsStyle = css`
  .section {
    padding-bottom: 1.2rem;
  }

  .section + .section {
    border-top: 1px solid var(--border-subtle);
    margin-top: 1.2rem;
    padding-top: 1.2rem;
  }

  .section-title {
    padding: 0.6rem 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    height: 4rem;
    padding: 0 1.2rem;
    border-radius: 1rem;
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 400;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .item svg {
    flex: none;
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.active {
    background: var(--bg-selected);
    font-weight: 500;
  }

  .avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: 500;
  }

  .channel-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .footer {
    border-top: 1px solid var(--border-subtle);
    margin-top: 1.2rem;
    padding: 1.6rem 1.2rem;
    color: var(--text-secondary);
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
    color: var(--text-tertiary);
  }
`

const GuideSections = () => (
  <div css={sectionsStyle}>
    <div className='section'>
      {MAIN_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />)}
    </div>
    <div className='section'>
      <div className='section-title'>You</div>
      {YOU_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />)}
    </div>
    <div className='section'>
      <div className='section-title'>Explore</div>
      {EXPLORE_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />)}
    </div>
    <SubscriptionRail />
    <div className='footer'>
      <div className='footer-links'>
        {FOOTER_LINKS.map(label => <span key={label}>{label}</span>)}
      </div>
      <div className='copyright'>© 2026 yt-client</div>
    </div>
  </div>
)

const expandedStyle = css`
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
  width: var(--guide-width);
  padding: 1.2rem;
  overflow-y: auto;
  background: var(--bg-base);
  z-index: var(--z-guide);
`

const miniStyle = css`
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
  width: var(--guide-mini-width);
  padding: 0 0.4rem;
  overflow-y: auto;
  background: var(--bg-base);
  z-index: var(--z-guide);

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 1.6rem 0;
    border-radius: 1rem;
    color: var(--text-primary);
    transition: background 0.15s ease;
  }

  .item:hover {
    background: var(--bg-hover);
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
  z-index: var(--z-drawer);

  .scrim {
    position: absolute;
    inset: 0;
    background: var(--bg-scrim);
  }

  .panel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--guide-width);
    overflow-y: auto;
    background: var(--bg-base);
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
    height: var(--header-height);
    padding: 0 1.6rem;
    background: var(--bg-base);
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
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .icon-button:hover {
    background: var(--bg-hover);
  }

  .panel-sections {
    padding: 1.2rem;
  }
`

export const Guide = (
  { variant, onClose }:
  { variant: 'expanded' | 'mini' | 'drawer', onClose?: () => void }
) => {
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
          {MINI_ENTRIES.map(entry => <GuideLink key={entry.label} entry={entry} />)}
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
