import { css } from '@emotion/react'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { Route, Switch, useLocation } from 'wouter'

import Guide from './components/guide'
import Header from './components/header'
import ChannelPage from './routes/channel'
import HomePage from './routes/home'
import SearchPage from './routes/search'
import SignInPage from './routes/signin'
import WatchPage from './routes/watch'

const style = css`
  min-height: 100vh;

  .content {
    padding-top: 5.6rem;
  }

  .page {
    min-width: 0;
  }

  .page.guide-expanded {
    margin-left: 24rem;
  }

  .page.guide-mini {
    margin-left: 7.2rem;
  }

  .not-found {
    padding: 2.4rem 1.6rem;
    color: #aaaaaa;
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
        </div>
      </div>
      {(overlayOnly || narrow) && drawerOpen ? <Guide variant='drawer' onClose={() => setDrawerOpen(false)} /> : undefined}
    </div>
  )
}

export default App
