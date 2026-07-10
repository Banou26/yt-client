import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4561',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: '/etc/profiles/per-user/banou/bin/google-chrome',
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    port: 4561,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
