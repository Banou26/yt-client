import { css } from '@emotion/react'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { Route, Switch, useLocation } from 'wouter'

import Guide from './components/guide'
import Header from './components/header'
import ErrorBoundary from './components/ui/error-boundary'
import ChannelPage from './routes/channel'
import HomePage from './routes/home'
import SearchPage from './routes/search'
import SignInPage from './routes/signin'
import WatchPage from './routes/watch'

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
`

const GUIDE_COLLAPSED_KEY = 'yt-client:guide-collapsed'

const readGuideCollapsed = () => {
  try {
    return localStorage.getItem(GUIDE_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

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
  const [collapsed, setCollapsed] = useState(readGuideCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const narrow = useMediaQuery('(max-width: 1312px)')
  const tiny = useMediaQuery('(max-width: 792px)')

  const isWatch = location.startsWith('/watch')
  const isSignIn = location.startsWith('/signin')
  const overlayOnly = isWatch || isSignIn || tiny
  const guideVariant = overlayOnly ? undefined : collapsed || narrow ? 'mini' as const : 'expanded' as const

  useEffect(() => setDrawerOpen(false), [location])

  const onMenu = useCallback(() => {
    // overlay-only routes (watch, signin) have no in-flow guide, and narrow
    // widths force the mini rail — all open the overlay drawer instead.
    if (overlayOnly || narrow) {
      setDrawerOpen(open => !open)
      return
    }
    setCollapsed(value => {
      const next = !value
      try {
        localStorage.setItem(GUIDE_COLLAPSED_KEY, String(next))
      } catch {
        // storage unavailable — keep in-memory state only
      }
      return next
    })
  }, [overlayOnly, narrow])

  return (
    <div css={style}>
      <Header onMenu={onMenu} />
      <div className='content'>
        {guideVariant ? <Guide variant={guideVariant} /> : undefined}
        <div className={guideVariant ? `page guide-${guideVariant}` : 'page'}>
          {/* Keyed on the route so navigating away from a failed page clears
              the error instead of pinning the whole app to it. */}
          <ErrorBoundary key={location}>
            <Switch>
              <Route path='/' component={HomePage} />
              <Route path='/search/:query' component={SearchPage} />
              <Route path='/watch/:videoId' component={WatchPage} />
              <Route path='/channel/:channelId' component={ChannelPage} />
              <Route path='/signin' component={SignInPage} />
              <Route>
                <p className='not-found'>Not found</p>
              </Route>
            </Switch>
          </ErrorBoundary>
        </div>
      </div>
      {(overlayOnly || narrow) && drawerOpen ? <Guide variant='drawer' onClose={() => setDrawerOpen(false)} /> : undefined}
    </div>
  )
}

export default App
