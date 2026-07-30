import { existsSync } from 'node:fs'

import { chromium, expect, test } from '@playwright/test'

/* The real unpacked extension, which is the one thing the default fixture
   cannot express: it needs its own persistent context, and loading an
   extension needs a CDP command rather than a launch flag.

   Kept because everything else about the extension path is tested against its
   page-visible CONTRACT (see extension-notice.spec.ts), and a contract test
   cannot notice the contract itself changing. This is the check that the
   extension really does serve egress and really does announce itself.

   Skipped rather than failed when the extension is not built next door: it
   lives in another repo, so this cannot be a hard requirement of running the
   suite. Build it with `npm run build` in fkn/web-extension. */

const EXTENSION_BUILD = '/home/banou/dev/fkn/web-extension/build'

test.describe('with the FKN extension installed', () => {
  test.skip(!existsSync(EXTENSION_BUILD), `no extension build at ${EXTENSION_BUILD}`)

  test('serves egress itself, and stops the header offering itself', async () => {
    test.setTimeout(180_000)
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      executablePath: '/etc/profiles/per-user/banou/bin/google-chrome',
      // playwright's defaults include --disable-extensions, which silently
      // defeats the load below, and --load-extension no longer works at all.
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
      viewport: { width: 1440, height: 900 },
    })

    try {
      const session = await context.browser()!.newBrowserCDPSession()
      await session.send('Extensions.loadUnpacked' as 'Browser.getVersion', { path: EXTENSION_BUILD } as object)
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker')

      const page = await context.newPage()
      const egress: string[] = []
      page.on('console', message => {
        if (message.text().includes('egress →')) egress.push(message.text())
      })

      await page.goto('http://localhost:4561/results?search_query=blender', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('a[href^="/watch"]').first()).toBeVisible({ timeout: 90_000 })

      // The content script announces itself in the page's own DOM, which is the
      // contract every other test in the suite simulates.
      await expect(page.locator('html')).toHaveAttribute('data-fkn-extension', 'true')

      // Results arrived, so egress worked; this is which path carried them.
      await expect.poll(() => egress.length, { timeout: 30_000 }).toBeGreaterThan(0)
      expect(egress.join(' ')).toContain('FKN extension')
      expect(egress.join(' ')).not.toContain('webvpn tunnel')

      // And with the extension present there is nothing to offer.
      await expect(page.getByRole('button', { name: 'Faster with the extension' })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
