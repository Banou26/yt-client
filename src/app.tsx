import type { TargetedSubmitEvent } from 'preact'

import { css } from '@emotion/react'
import { Link, Route, Switch } from 'wouter'

import ChannelPage from './routes/channel'
import HomePage from './routes/home'
import SearchPage from './routes/search'
import WatchPage from './routes/watch'

const shell = css`
  width: min(1480px, 100%);
  min-height: 100vh;
  margin: 0 auto;
  padding: 24px clamp(18px, 4vw, 58px) 64px;
`

const header = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 42px;
`

const logo = css`
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
`

const search = css`
  width: min(520px, 58vw);
  padding: 11px 16px;
  border: 1px solid #2a2d33;
  border-radius: 999px;
  outline: none;
  background: rgba(16, 18, 22, 0.88);
  color: inherit;

  &:focus {
    border-color: #ff6648;
  }
`

const App = () => (
  <div css={shell}>
    <header css={header}>
      <Link href="/" css={logo}>yt-client</Link>
      <form action="/search" onSubmit={(event: TargetedSubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        const query = new FormData(event.currentTarget).get('q')
        if (query) location.assign(`/search/${encodeURIComponent(String(query))}`)
      }}>
        <input css={search} name="q" type="search" placeholder="Search videos" aria-label="Search videos" />
      </form>
    </header>
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/search/:query" component={SearchPage} />
      <Route path="/watch/:videoId" component={WatchPage} />
      <Route path="/channel/:channelId" component={ChannelPage} />
      <Route>Not found</Route>
    </Switch>
  </div>
)

export default App
