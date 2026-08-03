import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/* exposure is simulated through the extension's own page-visible contract, `data-fkn-extension` on <html> plus the content script's event, which is what `@fkn/lib`'s `isExtensionExposed()` reads */

const EXPOSURE_EVENT = 'FKN_WEB_EXTENSION_MAIN_WORLD_CONTENT_SCRIPT_ENABLED_EVENT_KEY'

const pillOf = (page: Page) => page.getByRole('button', { name: 'Faster with the extension' })
const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Faster with the FKN extension' })
const toggleOf = (page: Page) => page.getByLabel('Offer the extension in the header')

// an init script can run before the parser has created <html> at all, so it cannot simply assign: `document.documentElement` is null and the assignment throws
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

// the dismiss listeners are attached from an effect Preact flushes after paint, so a dismissal issued in the same tick as the open lands before anything is listening
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
  await expect(panel).toContainText('round trip')
  await expect(panel).toContainText('daily allowance')

  await expect(panel.getByRole('button', { name: 'Get the extension' })).toBeVisible()
})

test('hands installing over to the platform prompt', async ({ page }) => {
  await page.goto('/settings')
  await openPanel(page)
  await panelOf(page).getByRole('button', { name: 'Get the extension' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-extension-prompt', 'open')
  await expect(panelOf(page)).toHaveCount(0)
  expect(page.context().pages()).toHaveLength(1)
})

test('paints the offer on the first render once it has been seen before', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:settings', JSON.stringify({ extensionSeen: false }))
  })
  await page.goto('/settings')
  // deliberately under the grace period: only the remembered answer can put the pill on screen this early
  await expect(pillOf(page)).toBeVisible({ timeout: 500 })
})

test('closes the panel on escape and on a click outside it', async ({ page }) => {
  await page.goto('/settings')
  await openPanel(page)
  await closesWith(page, () => page.keyboard.press('Escape'))
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

  await page.reload()
  await expect(toggleOf(page)).toBeVisible()
  await expect(pillOf(page)).toHaveCount(0)

  await toggleOf(page).check()
  await expect(pillOf(page)).toBeVisible()
})

test('says nothing at all when the extension is installed', async ({ page }) => {
  await exposeExtension(page)
  await page.goto('/settings')
  await expect(page.getByText('The FKN extension is active')).toBeVisible()
  await expect(pillOf(page)).toHaveCount(0)
  await expect(toggleOf(page)).toHaveCount(0)
})

test('withdraws the offer when the extension appears mid-session', async ({ page }) => {
  await page.goto('/settings')
  await expect(pillOf(page)).toBeVisible()

  await page.evaluate((event) => {
    document.documentElement.dataset.fknExtension = 'true'
    document.dispatchEvent(new CustomEvent(event, { detail: { enabled: true } }))
  }, EXPOSURE_EVENT)

  await expect(pillOf(page)).toHaveCount(0)
  await expect(page.getByText('The FKN extension is active')).toBeVisible()
})
