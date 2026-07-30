import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/* The header's offer to install the FKN extension.

   Exposure is simulated through the extension's own page-visible contract
   (`data-fkn-extension` on <html>, plus the content script's event when it
   flips) rather than by loading the real unpacked extension. That keeps the
   suite to one browser fixture and no sibling-repo build, and the contract is
   the whole of what the app can see anyway: `@fkn/lib`'s own
   `isExtensionExposed()` reads exactly this attribute.

   Every test runs on /settings rather than the home page: the header under test
   is identical there, and it needs neither the engine nor a YouTube round trip,
   so a failure here is always about the notice. */

const EXPOSURE_EVENT = 'FKN_WEB_EXTENSION_MAIN_WORLD_CONTENT_SCRIPT_ENABLED_EVENT_KEY'

const pillOf = (page: Page) => page.getByRole('button', { name: 'Faster with the extension' })
const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Faster with the FKN extension' })
// Rendered only once exposure has resolved to "absent", so it doubles as the
// positive signal that the component's grace period is over. Without it, an
// absent pill cannot be told apart from a pill that has not appeared yet.
const toggleOf = (page: Page) => page.getByLabel('Offer the extension in the header')

/* Marks the page as carrying the extension before any of its own scripts run,
   which is where the real content script gets to (document_start, ahead of the
   app's deferred module and so ahead of its first render).

   An init script can run EARLIER than that, before the parser has created
   <html> at all, so it cannot simply assign: `document.documentElement` is null
   and the assignment throws, leaving the page looking extension-less. */
const exposeExtension = (page: Page) =>
  page.addInitScript(() => {
    const mark = () => {
      document.documentElement.dataset.fknExtension = 'true'
    }
    if (document.documentElement) return mark()
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return
      mark()
      observer.disconnect()
    }).observe(document, { childList: true })
  })

/* The dismiss listeners are attached from an effect, which Preact flushes after
   paint, so a keypress or click issued in the same tick as the open lands
   before anything is listening. A human cannot hit that window; Playwright
   always does. Retrying the whole interaction covers it without a blind sleep,
   and still fails if dismissal is genuinely broken. */
const closesWith = async (page: Page, dismiss: () => Promise<void>) => {
  await expect(async () => {
    await dismiss()
    await expect(panelOf(page)).toHaveCount(0)
  }).toPass({ timeout: 10_000 })
}

const openPanel = async (page: Page) => {
  await pillOf(page).click()
  await expect(panelOf(page)).toBeVisible()
}

test('offers the extension when it is absent', async ({ page }) => {
  await page.goto('/settings')
  await expect(pillOf(page)).toBeVisible()

  await openPanel(page)
  const panel = panelOf(page)
  // Both halves of the reason the offer exists: the round trip it removes, and
  // the relay allowance it lifts.
  await expect(panel).toContainText('round trip')
  await expect(panel).toContainText('daily allowance')

  await expect(panel.getByRole('button', { name: 'Get the extension' })).toBeVisible()
})

test('hands installing over to the platform prompt', async ({ page }) => {
  await page.goto('/settings')
  await openPanel(page)
  await panelOf(page).getByRole('button', { name: 'Get the extension' }).click()

  /* The prompt itself is the platform's, rendered inside the fkn.app broker
     overlay, so what belongs to this app is the handoff: the request is marked,
     and the panel gets out of the overlay's way rather than sitting on top of
     it. Nothing here opens a tab, which is the fallback path and only runs when
     the broker never loaded. */
  await expect(page.locator('html')).toHaveAttribute('data-extension-prompt', 'open')
  await expect(panelOf(page)).toHaveCount(0)
  expect(page.context().pages()).toHaveLength(1)
})

test('paints the offer on the first render once it has been seen before', async ({ page }) => {
  // What a second visit looks like: the last answer is already stored.
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ extensionSeen: false }))
  })
  await page.goto('/settings')
  /* Deliberately under the grace period. Waiting it out would pass either way;
     only the remembered answer can put the pill on screen this early, and that
     is what keeps the header from resettling after paint, which is a layout
     shift on a fixed row. */
  await expect(pillOf(page)).toBeVisible({ timeout: 500 })
})

test('closes the panel on escape and on a click outside it', async ({ page }) => {
  await page.goto('/settings')
  await openPanel(page)
  await closesWith(page, () => page.keyboard.press('Escape'))
  // Focus returns to the trigger, or a keyboard user is stranded on <body>.
  await expect(pillOf(page)).toBeFocused()

  await openPanel(page)
  await closesWith(page, () => page.getByRole('heading', { name: 'Settings' }).click())
})

test('stops offering once declined, and settings brings it back', async ({ page }) => {
  await page.goto('/settings')
  await openPanel(page)
  await panelOf(page).getByRole('button', { name: 'Don\'t show this again' }).click()
  await expect(pillOf(page)).toHaveCount(0)
  await expect(toggleOf(page)).not.toBeChecked()

  // Declining has to outlive the tab, or it is not a decision.
  await page.reload()
  await expect(toggleOf(page)).toBeVisible()
  await expect(pillOf(page)).toHaveCount(0)

  await toggleOf(page).check()
  await expect(pillOf(page)).toBeVisible()
})

test('says nothing at all when the extension is installed', async ({ page }) => {
  await exposeExtension(page)
  await page.goto('/settings')
  // Resolved from the first render, so this is a real signal rather than a
  // not-answered-yet state.
  await expect(page.getByText('The FKN extension is active')).toBeVisible()
  await expect(pillOf(page)).toHaveCount(0)
  // No dead control either: there is nothing to offer, so the toggle is absent.
  await expect(toggleOf(page)).toHaveCount(0)
})

test('withdraws the offer when the extension appears mid-session', async ({ page }) => {
  await page.goto('/settings')
  await expect(pillOf(page)).toBeVisible()

  // Exactly what the content script does when the extension is enabled while
  // the page is already open.
  await page.evaluate((event) => {
    document.documentElement.dataset.fknExtension = 'true'
    document.dispatchEvent(new CustomEvent(event, { detail: { enabled: true } }))
  }, EXPOSURE_EVENT)

  await expect(pillOf(page)).toHaveCount(0)
  await expect(page.getByText('The FKN extension is active')).toBeVisible()
})
