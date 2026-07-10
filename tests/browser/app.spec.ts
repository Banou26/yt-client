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

test('plays a static YouTube video', async ({ page }) => {
  test.setTimeout(150_000)
  const logs: string[] = []
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/watch/dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 75_000 })
  const video = page.locator('video')
  await expect(video).toBeVisible()
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 100_000 },
  ).toBeGreaterThan(0).catch(async (error) => {
    const media = await video.evaluate((element) => {
      const player = element as HTMLVideoElement
      return {
        currentTime: player.currentTime,
        duration: player.duration,
        networkState: player.networkState,
        paused: player.paused,
        readyState: player.readyState,
        error: player.error?.message,
      }
    })
    const frame = page.frames().find((candidate) => candidate.url().includes('/proxy/'))
    const api = await frame?.locator('html').getAttribute('data-frame-api').catch(() => null)
    const content = await page.locator('main').innerText()
    throw new Error(`${error.message}\nmedia=${JSON.stringify(media)}\napi=${api}\ncontent=${JSON.stringify(content)}\nconsole=${JSON.stringify(logs)}`)
  })
})
