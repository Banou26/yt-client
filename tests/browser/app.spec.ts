import { expect, test } from '@playwright/test'

test('boots the frame engine and loads YouTube search results', async ({ page }) => {
  const errors: string[] = []
  const logs: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/search/rick%20astley')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 75_000 }).catch(async (error) => {
    const state = await Promise.all(page.frames().map(async (frame) => ({
      url: frame.url(),
      stage: await frame.locator('html').getAttribute('data-stage').catch(() => null),
    })))
    throw new Error(`${error.message}\nframes=${JSON.stringify(state)}\nconsole=${JSON.stringify(logs)}`)
  })
  await expect(page.getByRole('heading', { name: 'Results for rick astley' })).toBeVisible()
  await expect(page.locator('article').first()).toBeVisible({ timeout: 75_000 }).catch(async (error) => {
    const content = await page.locator('main').innerText()
    const state = await Promise.all(page.frames().map(async (frame) => ({
      url: frame.url(),
      api: await frame.locator('html').getAttribute('data-frame-api').catch(() => null),
    })))
    const request = await page.locator('html').getAttribute('data-frame-request')
    const response = await page.locator('html').getAttribute('data-frame-response')
    throw new Error(`${error.message}\ncontent=${JSON.stringify(content)}\nrequest=${request}\nresponse=${response}\nframes=${JSON.stringify(state)}\nconsole=${JSON.stringify(logs)}`)
  })
  expect(errors.filter((error) => error.includes('yt-client'))).toEqual([])
})
