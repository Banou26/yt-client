import { expect, test } from '@playwright/test'

test('boots the application and frame engine', async ({ page }) => {
  const errors: string[] = []
  const logs: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 75_000 }).catch(async (error) => {
    const state = await Promise.all(page.frames().map(async (frame) => ({
      url: frame.url(),
      stage: await frame.locator('html').getAttribute('data-stage').catch(() => null),
    })))
    throw new Error(`${error.message}\nframes=${JSON.stringify(state)}\nconsole=${JSON.stringify(logs)}`)
  })
  await expect(page.getByRole('heading', { name: 'Your lightweight YouTube client.' })).toBeVisible()
  expect(errors.filter((error) => error.includes('yt-client'))).toEqual([])
})
