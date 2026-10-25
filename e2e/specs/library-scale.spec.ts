import type { Locator, Page } from '@playwright/test';
import { manySpells, spellName } from '../fixtures/manySpells.ts';
import { gotoRosterSettled, skipOfflineReadyNotice } from '../support/app.ts';
import { expect, test } from '../support/test.ts';

/**
 * The library at the size of a real compendium (A11Y-003, #114): 1,000
 * spells, of which the list renders only the rows near the window's scroll
 * position. On the suite's phone, which holds about 17 rows.
 *
 * Timings are recorded as annotations, not asserted: the suite has no timing
 * bounds, which would fail on a loaded runner rather than on a regression.
 */
const MANY = 1000;

/** At most this many rows rendered: a screenful, the overscan of 10 each side, and a pinned focus. */
const ROW_CAP = 60;

const list = (page: Page) => page.locator('[data-virtual-list]');
const rendered = (page: Page) => list(page).locator(':scope > li');
const count = (page: Page) => page.getByRole('main').locator('header span');

async function openList(page: Page): Promise<void> {
  await page.goto('/library/spell');
  await expect(count(page)).toHaveText(String(MANY));
}

/**
 * The first row drawn whole at the top of the window, by its place in the
 * list: the one under the window's top edge, or the next if that one is cut.
 */
function topRow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, 1);
    let row = hit?.closest('[data-virtual-list] > li') ?? null;
    if (row !== null && row.getBoundingClientRect().top < 0) row = row.nextElementSibling;
    return Number(row?.getAttribute('aria-posinset') ?? Number.NaN);
  });
}

/** Two frames, so the virtualizer has rendered and the browser painted what a scroll changed. */
function frames(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * A row's estimated height must be its rendered height. The list is laid
 * out from the estimate for every row not yet measured, so with only the
 * rows near the top measured, its height is 1,000 times a row's exactly
 * when the two agree, and is off by a thousand times any difference.
 */
async function expectEstimateExact(page: Page, row: Locator): Promise<void> {
  const [height, total] = await Promise.all([
    row.evaluate((el) => (el as HTMLElement).offsetHeight),
    list(page).evaluate((el) => (el as HTMLElement).offsetHeight),
  ]);
  expect(total, `${MANY} rows of ${height} px`).toBe(MANY * height);
}

test.describe('the library with 1,000 spells', () => {
  test.beforeEach(async ({ page, mirror }) => {
    mirror.setBodies(() => manySpells(MANY));
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
  });

  test('renders a window of the list, and filters it', async ({ page }, testInfo) => {
    await openList(page);
    await expect(rendered(page).first()).toHaveAttribute('aria-posinset', '1');
    const before = await rendered(page).count();
    expect(before, 'rows rendered').toBeLessThanOrEqual(ROW_CAP);
    await expect(rendered(page).first()).toHaveAttribute('aria-setsize', String(MANY));

    // "spell 9" is in Spell 900 to Spell 999 only; "Spell 090" has a 0 first.
    const filter = page.getByLabel('Filter spells');
    const started = Date.now();
    await filter.fill('Spell 9');
    await expect(count(page)).toHaveText('100');
    testInfo.annotations.push({
      type: 'filter to 100 (ms)',
      description: `${Date.now() - started}`,
    });
    await expect(rendered(page).first()).toHaveText(new RegExp(`^${spellName(900)}`));
    await expect(rendered(page).first()).toHaveAttribute('aria-setsize', '100');
    expect(await rendered(page).count(), 'rows rendered').toBeLessThanOrEqual(ROW_CAP);

    await filter.fill('');
    await expect(count(page)).toHaveText(String(MANY));
    await expect(rendered(page).first()).toHaveText(new RegExp(`^${spellName(1)}`));
  });

  test("a row's estimated height is its rendered height, at 16 px and at 200%", async ({
    page,
  }) => {
    await openList(page);
    await expectEstimateExact(page, rendered(page).first());

    // The estimate is read when the list mounts, so the text size is set
    // first and the list opened from the library home, in the same page.
    await page.goto('/library');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('link', { name: /^Spells/ }).click();
    await expect(count(page)).toHaveText(String(MANY));
    const row = rendered(page).first();
    expect(await row.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(90);
    await expectEstimateExact(page, row);
  });

  test('Back from a row 500 down the list returns to that row', async ({ page }, testInfo) => {
    await openList(page);
    // A screenful at a time, as a reader scrolls, so every row above is
    // measured on the way down. A jump would leave them estimated, which is
    // also what the restored list starts from, so a wrong estimate would put
    // both in the same wrong place and pass.
    const step = await page.evaluate(() => window.innerHeight);
    const rowHeight = await rendered(page)
      .first()
      .evaluate((el) => (el as HTMLElement).offsetHeight);
    const target = 500 * rowHeight;
    for (let y = step; y < target; y += step) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await frames(page);
    }
    await page.evaluate((to) => window.scrollTo(0, to), target);
    await frames(page);
    const top = await topRow(page);
    expect(top, 'the top row, about 500 down').toBeGreaterThan(480);
    expect(await rendered(page).count(), 'rows rendered').toBeLessThanOrEqual(ROW_CAP);

    // By its name, not its number: "Spell 1000" sorts after "Spell 100".
    const link = list(page).locator(`:scope > li[aria-posinset="${top}"] a`);
    const name = (await link.locator('span').first().textContent()) ?? '';
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    // Back is a POP: `ScrollRestoration` puts the window back where it was,
    // and the list, mounting again, must neither scroll it away (to its own
    // first reading of the offset) nor lay out its rows elsewhere.
    const started = Date.now();
    await page.goBack();
    await expect(count(page)).toHaveText(String(MANY));
    await frames(page);
    testInfo.annotations.push({
      type: 'back to the list (ms)',
      description: `${Date.now() - started}`,
    });
    const back = await topRow(page);
    expect(Math.abs(back - top), `back at row ${back}, left at row ${top}`).toBeLessThanOrEqual(1);
  });

  test('a focused row and its neighbours outlast a scroll, and Tab goes on from it', async ({
    page,
  }) => {
    await openList(page);
    const focusedAt = () =>
      page.evaluate(() =>
        document.activeElement?.closest('[data-virtual-list] > li')?.getAttribute('aria-posinset'),
      );
    await list(page).locator(':scope > li[aria-posinset="4"] a').focus();
    // Far past it, as a mouse wheel or a swipe would scroll, which moves no
    // focus: row 4 would be unmounted, dropping focus onto the page.
    await page.evaluate(() => window.scrollTo(0, 30_000));
    await frames(page);
    const order = await rendered(page).evaluateAll((rows) =>
      rows.map((r) => Number(r.getAttribute('aria-posinset'))),
    );
    expect(order.slice(0, 3), 'the pinned rows lead the DOM').toEqual([3, 4, 5]);
    expect(order[3], 'then the rows the window shows').toBeGreaterThan(500);
    expect(await focusedAt()).toBe('4');

    await page.keyboard.press('Tab');
    expect(await focusedAt(), 'Tab goes to the next row').toBe('5');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedAt(), 'Shift+Tab twice goes back past it').toBe('3');
  });
});
