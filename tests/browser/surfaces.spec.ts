import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/* A signed-out home feed is EMPTY by design, and a channel is reached by
   following the app's own link rather than a guessed URL. */

const ROUTES = [
  ['shorts', '/shorts'],
  ['settings', '/settings'],
  ['account', '/account'],
  ['sign in', '/signin'],
  ['subscriptions', '/feed/subscriptions'],
  ['history', '/feed/history'],
  ['playlists', '/feed/playlists'],
  ['unknown route', '/definitely-not-a-route'],
] as const

const collectPageErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message.split('\n')[0].slice(0, 140)))
  return errors
}

test('renders every route without a page error', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectPageErrors(page)

  for (const [name, path] of ROUTES) {
    await page.goto(path)
    await expect(page.locator('header'), `${name} did not render`).toBeVisible({ timeout: 30_000 })
    expect(errors, `${name} raised a page error`).toEqual([])
  }
})

test('shows an empty home for an anonymous session, and real search results', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await expect
    .poll(
      () => page.evaluate(() =>
        document.querySelectorAll('a[href^="/watch"]').length > 0
        || /Anonymous sessions start with an empty feed/i.test(document.body.innerText)),
      { timeout: 90_000 },
    )
    .toBe(true)

  await page.goto('/results?search_query=blender')
  await expect(page.locator('a[href^="/watch"]').first()).toBeVisible({ timeout: 90_000 })
  expect(await page.locator('a[href^="/watch"]').count()).toBeGreaterThanOrEqual(5)
})

test('opens a channel from the app own link', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/results?search_query=blender')
  const channelLink = page.locator('a[href^="/channel/"]').first()
  await expect(channelLink).toBeVisible({ timeout: 90_000 })
  const href = await channelLink.getAttribute('href')
  await page.goto(href ?? '/')
  await expect(page.locator('h1')).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.tab').first()).toBeVisible()
})

test('keeps playing in the miniplayer after leaving the watch page', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000 },
  ).toBeGreaterThan(1)

  // Client-side navigation, NOT page.goto: a full load tears the player down
  await page.evaluate(() => {
    history.pushState(null, '', '/settings')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 30_000 })

  await expect(video).toBeVisible()
  const before = await video.evaluate(element => (element as HTMLVideoElement).currentTime)
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 30_000 },
  ).toBeGreaterThan(before)
})

test('seeks forward and back', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(
    () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
    { timeout: 120_000 },
  ).toBeGreaterThan(1)

  for (const [target, floor] of [[32, 32], [6, 6]] as const) {
    await video.evaluate((element, time) => {
      (element as HTMLVideoElement).currentTime = time
    }, target)
    await expect.poll(
      () => video.evaluate(element => (element as HTMLVideoElement).currentTime),
      { timeout: 60_000, message: `playback did not resume after seeking to ${target}` },
    ).toBeGreaterThanOrEqual(floor)
  }
})
