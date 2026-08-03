import type { ConsoleMessage } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { FRAME_BOOTSTRAP_URL } from '../../src/scramjet/fkn-transport'

test('plays a complete static YouTube video', async ({ page }) => {
  test.setTimeout(420_000)
  const logs: string[] = []
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/watch/dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  const video = page.locator('video')
  await expect(video).toBeVisible()
  const currentFrame = () => page.frames().find((candidate) => candidate.url().includes('/proxy/'))
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
    const frame = currentFrame()
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
    async () => Number(await currentFrame()?.locator('html').getAttribute('data-segment-start-ms')),
    { timeout: 150_000 },
  ).toBeGreaterThanOrEqual(60_000).catch(fail)
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).ended),
    { timeout: 330_000 },
  ).toBe(true).catch(fail)
})

test('starts repeated playback sessions in one frame', async ({ page }) => {
  test.setTimeout(300_000)
  const logs: string[] = []
  const startupWarnings: { text: string, location: ReturnType<ConsoleMessage['location']> }[] = []
  page.on('console', (message) => {
    logs.push(message.text())
    if (logs.length > 100) logs.shift()
    if (message.text().includes('target origin provided') || message.text().startsWith('CAUGHT ERROR')) {
      startupWarnings.push({ text: message.text(), location: message.location() })
    }
  })
  await page.goto('/watch/dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await page.evaluate(() => {
        history.pushState(null, '', '/')
        dispatchEvent(new PopStateEvent('popstate'))
      })
      /* leaving the watch page KEEPS the video playing in the miniplayer, so close the dock first or the next attempt re-measures the running session */
      await page.getByRole('button', { name: 'Close miniplayer' }).click()
      await expect(page.locator('video')).toHaveCount(0)
      await page.evaluate(() => {
        history.pushState(null, '', '/watch/dQw4w9WgXcQ')
        dispatchEvent(new PopStateEvent('popstate'))
      })
    }
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect.poll(
      () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
      { timeout: 100_000, message: `playback session ${attempt} did not start` },
    ).toBeGreaterThan(1).catch(async (error) => {
      const frame = page.frames().find((candidate) => candidate.url().includes('/proxy/'))
      const api = await frame?.locator('html').getAttribute('data-frame-api').catch(() => null)
      throw new Error(`${error.message}\napi=${api}\nconsole=${JSON.stringify(logs)}`)
    })
  }
  expect(startupWarnings).toEqual([])
})

test('starts promptly and sustains fast playback after rapid seeks', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/watch/dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 35_000, message: 'playback did not start within 35 seconds' },
  ).toBeGreaterThan(1)
  await expect(page.locator('html')).toHaveAttribute('data-player-engine', 'shaka')

  for (const target of [150, 30, 120]) {
    await video.evaluate((element, time) => {
      const player = element as HTMLVideoElement
      player.playbackRate = 2
      player.currentTime = time
    }, target)
    await page.waitForTimeout(500)
  }

  await video.evaluate(async (element) => {
    const player = element as HTMLVideoElement
    player.currentTime = 60
    await player.play().catch(() => {})
  })
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 10_000, message: 'playback did not resume promptly after rapid seeks' },
  ).toBeGreaterThan(64)
  expect(await video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(2)

  const sustainedStart = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  await page.waitForTimeout(15_000)
  const sustainedEnd = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  expect(sustainedEnd - sustainedStart).toBeGreaterThan(24)
})

test('rebuilds the engine after a lost segment request', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    const send = MessagePort.prototype.postMessage as (...args: unknown[]) => void
    let dropped = false
    Object.defineProperty(MessagePort.prototype, 'postMessage', {
      configurable: true,
      value(this: MessagePort, ...args: unknown[]) {
        const message = args[0] as { method?: string } | undefined
        if (!dropped && message?.method === 'requestSegment') {
          dropped = true
          document.documentElement.dataset.testDroppedSegment = 'true'
          return
        }
        Reflect.apply(send, this, args)
      },
    })
  })
  await page.goto('/watch/dQw4w9WgXcQ')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  await expect(page.locator('html')).toHaveAttribute('data-test-dropped-segment', 'true', { timeout: 75_000 })
  const video = page.locator('video')
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    { timeout: 150_000 },
  ).toBeGreaterThan(1)
})

test('boots the frame engine and loads YouTube search results', async ({ page }) => {
  const errors: string[] = []
  const logs: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/search/rick%20astley')
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 }).catch(async (error) => {
    const state = await Promise.all(page.frames().map(async (frame) => ({
      url: frame.url(),
      stage: await frame.locator('html').getAttribute('data-stage').catch(() => null),
    })))
    throw new Error(`${error.message}\nframes=${JSON.stringify(state)}\nconsole=${JSON.stringify(logs)}`)
  })
  const frame = page.frames().find((candidate) => candidate.url().includes('/proxy/'))
  expect(decodeURIComponent(frame?.url() ?? '')).toContain(FRAME_BOOTSTRAP_URL)
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
