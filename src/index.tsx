import { css, Global } from '@emotion/react'
import { render } from 'preact'
import { Provider } from 'urql'

import App from './app'
import { client } from './graphql'
import { startEngine } from './scramjet/client'
import { setSource } from './sources/runtime'

const globalStyles = css`
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');

  :root {
    color-scheme: dark;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: #717171 transparent;
  }

  html {
    font-size: 62.5%;
  }

  html,
  body,
  #app {
    min-height: 100%;
  }

  body {
    min-width: 320px;
    font-family: 'Roboto', Arial, sans-serif;
    font-size: 1.4rem;
    background-color: #0f0f0f;
    color: #f1f1f1;
  }

  button,
  input {
    font: inherit;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  ul {
    list-style: none;
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
