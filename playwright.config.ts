import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  // Each spec is a Scramjet engine and a SABR stream of its own, and the default of half the cores makes specs fail on contention
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
