import { expect, test } from '@playwright/test'

test('plays a complete static YouTube video', async ({ page }) => {
  test.setTimeout(420_000)
  const logs: string[] = []
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/watch/dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 75_000 })
  const video = page.locator('video')
  await expect(video).toBeVisible()
  const frame = page.frames().find((candidate) => candidate.url().includes('/proxy/'))
  const fail = async (error: Error): Promise<never> => {
    const media = await video.evaluate((element) => {
      const player = element as HTMLVideoElement
      return {
        currentTime: player.currentTime,
        duration: player.duration,
        ended: player.ended,
        networkState: player.networkState,
        paused: player.paused,
        readyState: player.readyState,
        buffered: Array.from({ length: player.buffered.length }, (_, index) => [
          player.buffered.start(index),
          player.buffered.end(index),
        ]),
        error: player.error?.message,
      }
    })
    const api = await frame?.locator('html').getAttribute('data-frame-api').catch(() => null)
    const segmentStartMs = await frame?.locator('html').getAttribute('data-segment-start-ms').catch(() => null)
    const content = await page.locator('main').innerText()
    throw new Error(`${error.message}\nmedia=${JSON.stringify(media)}\napi=${api}\nsegmentStartMs=${segmentStartMs}\ncontent=${JSON.stringify(content)}\nconsole=${JSON.stringify(logs)}`)
  }
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 100_000 },
  ).toBeGreaterThan(0).catch(fail)
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).duration),
    { timeout: 30_000 },
  ).toBeGreaterThan(120).catch(fail)
  expect(await video.evaluate((element) => (element as HTMLVideoElement).duration)).toBeLessThan(240)
  await expect.poll(
    async () => Number(await frame?.locator('html').getAttribute('data-segment-start-ms')),
    { timeout: 150_000 },
  ).toBeGreaterThanOrEqual(60_000).catch(fail)
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).ended),
    { timeout: 330_000 },
  ).toBe(true).catch(fail)
})

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
