import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  /* Most specs here start real playback, and each one is a Scramjet engine, an
     attestation session and a SABR stream of its own. Left to the default of
     half the cores, this box ran eight of those at once and five specs failed
     on a video that never appeared, while every one of them passed when run
     alone. Two keeps the suite honest: a failure means the app broke, not that
     the run was competing with itself. */
  workers: 2,
  use: {
    baseURL: 'http://localhost:4561',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: '/etc/profiles/per-user/banou/bin/google-chrome',
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run dev -- --host localhost',
    port: 4561,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
