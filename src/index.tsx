import { css, Global } from '@emotion/react'
import { render } from 'preact'
import { Provider } from 'urql'

import App from './app'
import Toasts from './components/ui/toast'
import { client } from './graphql'
import { startEngine } from './scramjet/client'
import { applyTheme, watchDeviceTheme } from './settings'
import { setSource } from './sources/runtime'

const globalStyles = css`
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');

  /* Dark is the base palette; the light block below overrides only what
     changes. 'Device' is resolved to one of the two in JS rather than by a
     media query, so an explicit choice always wins without a specificity
     fight. Inverse tokens are the pair that swaps between themes (the active
     chip is a light pill in dark mode and a dark pill in light mode), so they
     must stay distinct from --bg-base / --text-primary. */
  :root {
    color-scheme: dark;

    --bg-base: #0f0f0f;
    --bg-subtle: #1f1f1f;
    --bg-elevated: #212121;
    --bg-menu: #282828;
    --bg-chip: #272727;
    --bg-chip-hover: #3f3f3f;
    --bg-selected: #272727;
    --bg-hover: rgba(255, 255, 255, 0.1);
    --bg-hover-strong: rgba(255, 255, 255, 0.15);
    --bg-input: #121212;
    --bg-input-button: #222222;
    --bg-mic: #181818;
    --bg-mic-hover: #272727;
    --bg-inverse: #f1f1f1;
    --bg-inverse-hover: #ffffff;

    --border: #303030;
    --border-strong: #3f3f3f;
    --border-subtle: rgba(255, 255, 255, 0.2);

    --text-primary: #f1f1f1;
    --text-secondary: #aaaaaa;
    --text-tertiary: #717171;
    --text-placeholder: #888888;
    --text-inverse: #0f0f0f;

    --accent: #3ea6ff;
    --accent-hover: rgba(62, 166, 255, 0.15);
    --accent-focus: #1c62b9;
    --accent-inverse: #065fd4;
    --danger: #f28b82;

    --shadow-menu: 0 0.4rem 3.2rem rgba(0, 0, 0, 0.4);

    /* Theme-invariant on purpose, so the light block below must NOT override
       them: the brand mark is red in both themes, and anything drawn over a
       thumbnail or the video surface sits on media rather than on the page. */
    --brand: #ff0000;
    /* The progress red, which is NOT the logo red: upstream draws its playhead
       and played track in #ff0033, measured off their inline preview, and the
       mark itself in #ff0000.

       This existed only as four var(--brand-red) references with nothing
       defining it, so every one of them computed to an invalid background and
       painted NOTHING: the preview's played fill and its playhead knob, the
       search filter dot and the notifications badge were all invisible. */
    --brand-red: #ff0033;
    --bg-scrim: rgba(0, 0, 0, 0.5);
    --bg-badge: rgba(0, 0, 0, 0.8);
    --text-on-media: #ffffff;

    --header-height: 5.6rem;
    --guide-width: 24rem;
    --guide-mini-width: 7.2rem;

    --z-guide: 1000;
    --z-host-frame: 1500;
    --z-header: 2000;
    --z-drawer: 2100;
    --z-popup: 2200;
    --z-dialog: 2300;
    --z-toast: 2400;
  }

  /* The page is #f9f9f9 rather than white so that raised surfaces (menus,
     dialogs, cards) can be white and still read as raised. Every --bg-* pair
     that meets in one rule (a surface and its hover, a track and its ring)
     must resolve to different values here: dark has eight distinct surface
     greys to separate them, and collapsing them all onto white is what makes
     hover states and card edges silently vanish in light mode. */
  :root[data-theme='light'] {
    color-scheme: light;

    --bg-base: #f9f9f9;
    --bg-subtle: #ffffff;
    --bg-elevated: #f2f2f2;
    --bg-menu: #ffffff;
    --bg-chip: #f2f2f2;
    --bg-chip-hover: #e5e5e5;
    --bg-selected: #e5e5e5;
    --bg-hover: rgba(0, 0, 0, 0.05);
    --bg-hover-strong: rgba(0, 0, 0, 0.1);
    --bg-input: #ffffff;
    --bg-input-button: #f8f8f8;
    --bg-mic: #f2f2f2;
    --bg-mic-hover: #e5e5e5;
    --bg-inverse: #0f0f0f;
    --bg-inverse-hover: #000000;

    --shadow-menu: 0 0.2rem 1.2rem rgba(0, 0, 0, 0.15);

    --border: #d9d9d9;
    --border-strong: #d9d9d9;
    --border-subtle: rgba(0, 0, 0, 0.1);

    --text-primary: #0f0f0f;
    --text-secondary: #606060;
    --text-tertiary: #909090;
    --text-placeholder: #909090;
    --text-inverse: #ffffff;

    --accent: #065fd4;
    --accent-hover: rgba(6, 95, 212, 0.1);
    --accent-focus: #065fd4;
    --accent-inverse: #3ea6ff;
    --danger: #c5221f;
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
    scrollbar-color: var(--text-tertiary) transparent;
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
    background-color: var(--bg-base);
    color: var(--text-primary);
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

// Before the first render so the page never paints the wrong theme and flashes.
applyTheme()
watchDeviceTheme()

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
    <Toasts />
  </Provider>,
  root,
)
