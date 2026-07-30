import { expect, test } from '@playwright/test'

/* The channel URLs youtube.com hands out.

   This client keeps a channel's tab in the query string, because a tab is a
   view of one page rather than a separate page, so every path form upstream
   uses has to bounce to that canonical shape. `/@handle` alone was fixed in
   7454c90; the tab paths below still landed on Not found, which is what a
   reader gets for pasting any link off a channel page.

   Only the redirect is asserted, not the channel content: the destination is
   already covered elsewhere, and a URL assertion needs no network, so a failure
   here can only mean the routing broke. */

const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'

test('bounces the tab paths a channel page links to', async ({ page }) => {
  for (const [path, expected] of [
    ['/@Blender/videos', '/@Blender?tab=VIDEOS'],
    ['/@Blender/shorts', '/@Blender?tab=SHORTS'],
    // Upstream calls the live tab `streams`, and the enum calls it LIVE.
    ['/@Blender/streams', '/@Blender?tab=LIVE'],
    ['/@Blender/playlists', '/@Blender?tab=PLAYLISTS'],
    ['/@Blender/community', '/@Blender?tab=COMMUNITY'],
    ['/@Blender/about', '/@Blender?tab=ABOUT'],
    // The home tab is the channel's default view, so it drops the parameter.
    ['/@Blender/featured', '/@Blender'],
    [`/channel/${CHANNEL_ID}/videos`, `/channel/${CHANNEL_ID}?tab=VIDEOS`],
  ] as const) {
    await page.goto(path)
    await expect(page, `${path} should land on ${expected}`).toHaveURL(expected)
  }
})

test('replaces the tab path rather than stacking it in history', async ({ page }) => {
  await page.goto('/settings')
  await page.goto('/@Blender/videos')
  await expect(page).toHaveURL('/@Blender?tab=VIDEOS')
  // Back must reach the page before the channel. A pushed redirect would land
  // on the path form again and bounce forward forever.
  await page.goBack()
  await expect(page).toHaveURL('/settings')
})

test('refuses a segment that is not a tab', async ({ page }) => {
  // A dropped tab would be worse than a 404: the reader would get the channel's
  // default view and no sign the link meant something else.
  await page.goto('/@Blender/nonsense')
  await expect(page.getByText('Not found')).toBeVisible()
  await expect(page).toHaveURL('/@Blender/nonsense')

  // A two-segment path that is not a channel at all stays a 404.
  await page.goto('/nonsense/videos')
  await expect(page.getByText('Not found')).toBeVisible()
})
