import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/* Startup budgets.

   The rest of the suite waits on these same milestones, but its timeouts are
   sized so a run never flakes: 75 seconds to an engine that arrives in half a
   second, 35 to a first frame that arrives in eight. Those are not budgets. A
   change that made startup twice as slow would pass every one of them, which is
   how a performance regression ships unnoticed.

   Measured on 2026-07-30 over three runs against the live source: engine-ready
   455/455/520ms, player-attached 7.8/7.9/7.8s, first-frame 8.06/8.20/8.08s. The
   ceilings below are deliberately a few multiples above those rather than a few
   percent: the numbers move with the network on every run, and a budget that
   fails on a slow afternoon gets deleted rather than investigated. They are
   still tight enough that the doubling this file exists to catch cannot pass.

   The marks come from src/perf.ts and are one-shot, so a rebuilt engine or a
   second video cannot overwrite what the first one measured. */

type Milestone = 'engine-ready' | 'player-attached' | 'first-frame'

const BUDGET_MS: Record<Milestone, number> = {
  'engine-ready': 3_000,
  'player-attached': 20_000,
  'first-frame': 25_000,
}

const timingOf = (page: Page, milestone: Milestone) =>
  page.evaluate(
    (name) => performance.getEntriesByName(`yt:${name}`, 'mark')[0]?.startTime,
    milestone,
  )

const reportedBudget = async (page: Page, milestone: Milestone) => {
  const at = await timingOf(page, milestone)
  expect(at, `${milestone} was never marked`).toBeDefined()
  // Reported on success too: a number drifting from 8s to 19s passes, and the
  // run output is the only place anyone would see it before it fails.
  test.info().annotations.push({ type: milestone, description: `${Math.round(at ?? 0)}ms` })
  expect(at, `${milestone} took ${Math.round(at ?? 0)}ms, over its ${BUDGET_MS[milestone]}ms budget`)
    .toBeLessThan(BUDGET_MS[milestone])
}

test('reaches an engine, a player and a first frame inside their budgets', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')

  // Waited for on the mark rather than on the dataset attribute, so the thing
  // under test is the same thing the budget is read from.
  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )

  await reportedBudget(page, 'engine-ready')
  await reportedBudget(page, 'player-attached')
  await reportedBudget(page, 'first-frame')

  // The order is part of the contract: a first frame cannot precede the engine
  // that fetched it, and a mark that fires in the wrong place would otherwise
  // satisfy a budget while measuring nothing.
  const [engine, attached, frame] = await Promise.all([
    timingOf(page, 'engine-ready'),
    timingOf(page, 'player-attached'),
    timingOf(page, 'first-frame'),
  ])
  expect(engine).toBeLessThanOrEqual(attached ?? 0)
  expect(attached).toBeLessThanOrEqual(frame ?? 0)
})

test('marks the first frame once, not on every later one', async ({ page }) => {
  await page.goto('/watch?v=dQw4w9WgXcQ')
  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )
  // A `timeupdate` fires roughly four times a second, so a mark that was not
  // one-shot would be hundreds of entries by now, and the startup number would
  // be whatever happened last rather than what happened first.
  await page.waitForTimeout(3_000)
  const count = await page.evaluate(() => performance.getEntriesByName('yt:first-frame', 'mark').length)
  expect(count).toBe(1)
})
