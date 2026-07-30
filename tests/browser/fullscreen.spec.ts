import { expect, test } from '@playwright/test'

/* Fullscreen, confirmed by an actual click.

   The CSS this exercises exists because the player root carries BOTH a 16/9
   aspect-ratio box and theater mode's max-height, either of which letterboxes
   the video inside a container that is itself correctly fullscreened. That is
   the failure this asserts against: `fullscreenElement` being set proves the
   request was granted, not that anything filled the screen, so the size is
   checked too.

   The API needs a real user gesture, which is why this drives the control
   rather than calling requestFullscreen from a script. */

test('fills the viewport from the fullscreen control, and leaves again', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const video = page.locator('video')
  await expect(video).toBeVisible({ timeout: 60_000 })

  /* The controls are hover-revealed and hide again after 2.5s idle, so the bar
     has to be kept alive rather than merely summoned: revealing it, then
     asserting, then clicking is three round trips, and the bar is gone by the
     third. Moving onto the button itself is a pointer move inside the player,
     which is what resets that timer. */
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

  // The point of the exercise: fullscreen has to beat the aspect-ratio box and
  // the theater max-height, or this is a letterboxed video in a fullscreen box.
  const [box, viewport] = await Promise.all([
    root.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ])
  expect(box?.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(box?.height).toBeGreaterThanOrEqual(viewport.height - 1)

  // The control reflects the state it put the player in, including when the
  // browser's own UI is what leaves fullscreen.
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
