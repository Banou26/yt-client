import { css, Global } from '@emotion/react'
import { render } from 'preact'
import { Provider } from 'urql'

import App from './app'
import { client } from './graphql'
import { startEngine } from './scramjet/client'
import { setSource } from './sources/runtime'

const globalStyles = css`
  :root {
    color-scheme: dark;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    background: #090a0c;
    color: #f4f3ef;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body,
  #app {
    min-height: 100%;
    margin: 0;
  }

  body {
    min-width: 320px;
    background:
      radial-gradient(circle at 15% 0%, rgba(255, 78, 45, 0.12), transparent 35rem),
      #090a0c;
  }

  button,
  input {
    font: inherit;
  }

  a {
    color: inherit;
    text-decoration: none;
  }
`

const root = document.createElement('div')
root.id = 'app'
document.body.appendChild(root)
void startEngine().then(
  (source) => {
    setSource(source)
    document.documentElement.dataset.engine = 'ready'
  },
  (error) => {
    document.documentElement.dataset.engine = 'error'
    document.documentElement.dataset.engineError = error instanceof Error ? error.message : String(error)
  },
)

render(
  <Provider value={client}>
    <Global styles={globalStyles} />
    <App />
  </Provider>,
  root,
)
