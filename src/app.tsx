import { css } from '@emotion/react'
import { lazy, Suspense } from 'preact/compat'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Redirect, Route, Switch, useLocation, useSearch } from 'wouter'

import { safeDecode } from './components/format'
import Guide from './components/guide'
import Header from './components/header'
import ErrorBoundary from './components/ui/error-boundary'
import PersistentPlayer from './player/persistent-player'
import HomePage from './routes/home'
import { getSettings, updateSettings } from './settings'

/* Every route except Home loads on demand. Home stays static because it is the
   landing page: routing it through Suspense would put a chunk fetch in front of
   the very first paint, which is the one navigation that has no previous page
   to keep showing. */
const ChannelPage = lazy(() => import('./routes/channel'))
const FeedHistoryPage = lazy(() => import('./routes/feed-history'))
const FeedPlaylistsPage = lazy(() => import('./routes/feed-playlists'))
const FeedSubscriptionsPage = lazy(() => import('./routes/feed-subscriptions'))
const PlaylistPage = lazy(() => import('./routes/playlist'))
const SearchPage = lazy(() => import('./routes/search'))
const SettingsPage = lazy(() => import('./routes/settings'))
const AccountPage = lazy(() => import('./routes/account'))
const ShortsPage = lazy(() => import('./routes/shorts'))
const SignInPage = lazy(() => import('./routes/signin'))
const WatchPage = lazy(() => import('./routes/watch'))

const style = css`
  min-height: 100vh;

  .content {
    padding-top: var(--header-height);
  }

  .page {
    min-width: 0;
  }

  .page.guide-expanded {
    margin-left: var(--guide-width);
  }

  .page.guide-mini {
    margin-left: var(--guide-mini-width);
  }

  .not-found {
    padding: 2.4rem 1.6rem;
    color: var(--text-secondary);
  }

  /* Deliberately blank rather than a spinner. Chunks are local and resolve in
     a frame or two, and a spinner that flashes on every navigation reads as
     the app being slower than it is. */
  .route-loading {
    min-height: 60vh;
  }
`

const BASE_TITLE = 'yt-client'

// index.html ships a static <title> and nothing else writes document.title, so
// a route owns the title while it is mounted and hands the base title back on
// the way out. Without the restore, a route with no title of its own inherits
// whatever the previous page left behind.
export const useDocumentTitle = (title?: string) => {
  useEffect(() => {
    if (title === undefined) return
    document.title = `${title} - ${BASE_TITLE}`
  }, [title])
  // Restoring on UNMOUNT only, not on every title change. A route whose title
  // arrives with async data re-renders with it briefly absent, and a cleanup
  // keyed on the title would race that render and leave the base title behind.
  useEffect(() => () => {
    document.title = BASE_TITLE
  }, [])
}

// A start time addresses a position inside the watch page rather than a
// different page, so it is kept out of the route identity: counting it as a
// navigation would remount the player mid-playback and jump the page to the top.
const POSITION_PARAMS = ['t']

/* The short being watched is a position inside the Shorts pager for exactly
   the same reason. The pager rewrites the path as slides scroll, and that path
   is what makes a reload land where the viewer was; but treating each rewrite
   as a navigation would remount the pager through the keyed ErrorBoundary and
   tear down the running player on every swipe. */
const collapsePath = (pathname: string) =>
  pathname.startsWith('/shorts/') ? '/shorts' : pathname

const routeKeyOf = (pathname: string, search: string) => {
  const params = new URLSearchParams(search)
  for (const param of POSITION_PARAMS) params.delete(param)
  const rest = params.toString()
  const path = collapsePath(pathname)
  return rest ? `${path}?${rest}` : path
}

// The path-param URLs shipped first and are linked from outside the app, so
// they bounce to the canonical query-string form instead of being served by a
// second copy of the page. Replacing rather than pushing keeps Back from
// landing on the legacy URL and redirecting again.
const LegacySearchRedirect = ({ params }: { params: { query: string } }) => (
  <Redirect to={`/results?${new URLSearchParams({ search_query: safeDecode(params.query) })}`} replace />
)

const LegacyWatchRedirect = ({ params }: { params: { videoId: string } }) => (
  <Redirect to={`/watch?${new URLSearchParams({ v: params.videoId })}`} replace />
)

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    setMatches(media.matches)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export const App = () => {
  const [location] = useLocation()
  // Subscribes App to the query string as well as the path: without it a move
  // from ?v=A to ?v=B would not re-render, so nothing below would notice.
  const search = useSearch()
  const route = routeKeyOf(location, search)
  const [collapsed, setCollapsed] = useState(() => getSettings().guideCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const narrow = useMediaQuery('(max-width: 1312px)')
  const tiny = useMediaQuery('(max-width: 792px)')
  const currentRoute = useRef(route)
  const offsets = useRef(new Map<string, number>())
  const wentBack = useRef(false)

  const isWatch = location.startsWith('/watch')
  const isSignIn = location.startsWith('/signin')
  const overlayOnly = isWatch || isSignIn || tiny
  const guideVariant = overlayOnly ? undefined : collapsed || narrow ? 'mini' as const : 'expanded' as const

  useEffect(() => {
    // The browser only restores scroll for real document loads, and its attempt
    // lands before a client-rendered page has any height, so own it here.
    history.scrollRestoration = 'manual'
    const onScroll = () => offsets.current.set(currentRoute.current, scrollY)
    const onPopState = () => {
      wentBack.current = true
    }
    // wouter patches history.pushState to dispatch this event, and it is the
    // counterpart to popstate: clearing the flag on every push keeps it
    // describing the last navigation even when that navigation left the route
    // key alone and the effect below never ran.
    const onPushState = () => {
      wentBack.current = false
    }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('popstate', onPopState)
    addEventListener('pushState', onPushState)
    return () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('popstate', onPopState)
      removeEventListener('pushState', onPushState)
    }
  }, [])

  // Before paint, so the new page never flashes at the outgoing page's offset.
  useLayoutEffect(() => {
    if (currentRoute.current === route) return
    currentRoute.current = route
    setDrawerOpen(false)
    // Back and forward return to a page that was already read, so they land
    // where it was left. Every other navigation opens a page for the first time
    // and starts at the top, the way a fresh document load would.
    const restored = wentBack.current ? offsets.current.get(route) : undefined
    wentBack.current = false
    scrollTo(0, restored ?? 0)
  }, [route])

  const onMenu = useCallback(() => {
    // overlay-only routes (watch, signin) have no in-flow guide, and narrow
    // widths force the mini rail: all open the overlay drawer instead.
    if (overlayOnly || narrow) {
      setDrawerOpen(open => !open)
      return
    }
    setCollapsed(value => updateSettings({ guideCollapsed: !value }).guideCollapsed)
  }, [overlayOnly, narrow])

  return (
    <div css={style}>
      <Header onMenu={onMenu} />
      <div className='content'>
        {guideVariant ? <Guide variant={guideVariant} /> : undefined}
        <div className={guideVariant ? `page guide-${guideVariant}` : 'page'}>
          {/* Keyed on the route so navigating away from a failed page clears
              the error instead of pinning the whole app to it. */}
          {/* A chunk that fails to load (a stale deploy, a dropped
              connection) throws into the boundary above rather than blanking
              the page. */}
          <ErrorBoundary key={route}>
            <Suspense fallback={<div className='route-loading' />}>
            <Switch>
              <Route path='/' component={HomePage} />
              <Route path='/results' component={SearchPage} />
              <Route path='/watch' component={WatchPage} />
              {/* No path param: the playlist and the position live in the query
                  string, matching youtube.com. */}
              <Route path='/playlist' component={PlaylistPage} />
              {/* Both forms are real routes rather than one redirecting to the
                  other: /shorts is the feed entry and /shorts/:videoId is a
                  deep link into it, and the pager rewrites the path as it goes. */}
              <Route path='/shorts' component={ShortsPage} />
              <Route path='/shorts/:videoId' component={ShortsPage} />
              <Route path='/feed/subscriptions' component={FeedSubscriptionsPage} />
              <Route path='/feed/history' component={FeedHistoryPage} />
              <Route path='/feed/playlists' component={FeedPlaylistsPage} />
              <Route path='/channel/:channelId' component={ChannelPage} />
              <Route path='/settings' component={SettingsPage} />
              <Route path='/account' component={AccountPage} />
              <Route path='/signin' component={SignInPage} />
              <Route path='/search/:query' component={LegacySearchRedirect} />
              <Route path='/watch/:videoId' component={LegacyWatchRedirect} />
              {/* `/@handle`, the channel URL youtube.com hands out today, which
                  a reader following a link from outside the app arrives with.
                  Wouter's parser does not accept a literal prefix before a param
                  inside one segment, so `/@:handle` silently never matches and
                  such a link landed on Not found. Claim the whole segment and
                  keep it only when it is a handle: every real single-segment
                  route is declared above, and Switch takes the first match, so
                  this can only ever see paths nothing else wanted.

                  The source resolves the handle itself (it detects the leading
                  `@` and spends one resolveURL round trip), so it is passed
                  through rather than resolved here. */}
              <Route path='/:segment'>
                {(params: { segment?: string }) => params.segment?.startsWith('@')
                  ? <ChannelPage params={{ handle: params.segment.slice(1) }} />
                  : <p className='not-found'>Not found</p>}
              </Route>
              <Route>
                <p className='not-found'>Not found</p>
              </Route>
            </Switch>
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
      {(overlayOnly || narrow) && drawerOpen ? <Guide variant='drawer' onClose={() => setDrawerOpen(false)} /> : undefined}
      {/* Outside the <Switch> on purpose: this is the one thing on the page
          that has to survive a route change. */}
      <PersistentPlayer />
    </div>
  )
}

export default App
