import type { Page } from '@playwright/test';
import {
  characterLink,
  createBlankCharacter,
  deleteCharacter,
  gotoRoster,
  renameCharacter,
  rosterHeading,
} from '../support/app.ts';
import { getCharacter } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/** The Play tab's Heroic Inspiration toggle: one tap, one saved field. */
const inspiration = (page: Page) => page.getByRole('button', { name: 'Inspiration' });

async function savedInspiration(page: Page, id: string): Promise<boolean | undefined> {
  const doc = await getCharacter(page, id);
  return (doc?.play as { inspiration?: boolean } | undefined)?.inspiration;
}

/**
 * Opens a new character's Play tab and freezes the page's timers there, so
 * the session's 400 ms save debounce cannot fire on its own. Installed only
 * after the sheet has loaded: a fake clock during boot would stall it.
 */
async function openSheetWithFrozenClock(page: Page): Promise<string> {
  await gotoRoster(page);
  const id = await createBlankCharacter(page);
  await page.goto(`/c/${id}`);
  await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'false');
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000);
  return id;
}

test.describe('character lifecycle', () => {
  test('create, rename, edit, reload and delete a character', async ({ page }) => {
    await gotoRoster(page);
    const id = await createBlankCharacter(page);
    await expect(page).toHaveTitle('Build · New hero · Cast Guidance');

    await gotoRoster(page);
    await renameCharacter(page, 'New hero', 'Aria');
    expect((await getCharacter(page, id))?.name).toBe('Aria');

    await characterLink(page, 'Aria').click();
    await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
    await expect(page).toHaveTitle('Play · Aria · Cast Guidance');
    await inspiration(page).click();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Saved');

    await page.reload();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await savedInspiration(page, id)).toBe(true);

    await gotoRoster(page);
    await deleteCharacter(page, 'Aria');
    expect(await getCharacter(page, id)).toBeUndefined();

    await page.goto(`/c/${id}`);
    await expect(page).toHaveTitle('Character not found · Cast Guidance');
    await page.getByRole('main').getByRole('link', { name: 'Back to characters' }).click();
    await expect(rosterHeading(page)).toBeVisible();
  });

  test.fixme('an edit made just before a reload survives it (tracks the reload data loss)', async ({
    page,
  }) => {
    // Known gap found by this suite: the pagehide flush starts its IndexedDB
    // write, but the reload tears the document down before the transaction
    // commits, so an edit inside the 400 ms debounce is lost (5 of 5 runs).
    // Fixing it needs a synchronous journal (or similar) in characterSession;
    // drop the fixme when that lands.
    await gotoRoster(page);
    const id = await createBlankCharacter(page);
    await page.goto(`/c/${id}`);
    await inspiration(page).click();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await savedInspiration(page, id)).toBe(true);
  });

  test('an edit saves after the debounce, and not before', async ({ page }) => {
    // The control for the two flush tests: with the clock frozen, the save
    // waits on fake time alone, so in those tests only a flush can write.
    const id = await openSheetWithFrozenClock(page);
    await inspiration(page).click();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');

    await page.clock.runFor(399);
    expect(await savedInspiration(page, id)).toBe(false);
    await page.clock.runFor(2);
    await expect.poll(() => savedInspiration(page, id)).toBe(true);
  });

  test('a pending edit is flushed when the page is hidden', async ({ page }) => {
    const id = await openSheetWithFrozenClock(page);
    await inspiration(page).click();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await savedInspiration(page, id)).toBe(false);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => savedInspiration(page, id)).toBe(true);
  });

  test('a pending edit is flushed on pagehide', async ({ page }) => {
    const id = await openSheetWithFrozenClock(page);
    await inspiration(page).click();
    await expect(inspiration(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await savedInspiration(page, id)).toBe(false);

    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    });
    await expect.poll(() => savedInspiration(page, id)).toBe(true);
  });
});
