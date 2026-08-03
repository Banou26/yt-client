import { expect, test } from '@playwright/test'

/* The player root carries BOTH a 16/9 aspect-ratio box and theater mode's
   max-height, either of which letterboxes the video inside a fullscreened container. */

test('fills the viewport from the fullscreen control, and leaves again', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })

  // The controls hide after 2.5s idle, so the bar has to be kept alive rather than merely summoned
  const enter = page.getByRole('button', { name: 'Full screen' })
  await expect(async () => {
    await video.hover()
    await enter.hover({ timeout: 2_000 })
    await enter.click({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })

  const root = page.locator('[data-player-root]')
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-player-root') ?? false))
    .toBe(true)

  const [box, viewport] = await Promise.all([
    root.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ])
  expect(box?.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(box?.height).toBeGreaterThanOrEqual(viewport.height - 1)

  const exit = page.getByRole('button', { name: 'Exit full screen' })
  await expect(exit).toBeVisible()
  await exit.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false)
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible()
})

test('double clicking the video is the same toggle', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })

  await video.dblclick()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-player-root') ?? false))
    .toBe(true)
  await video.dblclick()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false)
})
