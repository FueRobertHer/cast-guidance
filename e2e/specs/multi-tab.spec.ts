import type { Locator, Page } from '@playwright/test';
import { HEARTBEAT_MS, STALE_MS } from '../../src/features/sheet/multiTab.ts';
import { casterFile } from '../fixtures/caster.ts';
import {
  answerImportPreview,
  createBlankCharacter,
  gotoRoster,
  gotoRosterSettled,
  gotoSheetTab,
  handleOverlays,
  importCharacterFile,
  onScreen,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { getCharacter } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * One character open in two tabs (REL-007 #98, the IndexedDB risks of #121):
 * two pages in one context, so real IndexedDB and a real BroadcastChannel
 * between them. Each tab warns that the other is open. An edit in each tab,
 * each saved, ends in last-writer-wins: the tab that saves last writes the
 * whole document it loaded, so the other tab's change is gone. That pins
 * what `src/stores/characterSession.multitab.indexeddb.test.ts` documents in
 * process, and a conflict guard for #98 should flip both on purpose.
 */

const ID = 'e2e-two-tabs';
const NAME = 'Wren Hollow';
const RENAMED = 'Wren the Bold';

/**
 * The sheet's warning, on screen: matched by a fragment of its words, and
 * never the announcer's screen-reader-only copy of them (`onScreen`).
 */
function openElsewhere(page: Page): Locator {
  return page.getByText('open in another tab').and(onScreen(page));
}

/** The header's save indicator, a plain visual (not a live region). */
function saveIndicator(page: Page): Locator {
  return page.getByRole('banner').locator('[data-save-indicator]');
}

/** The stored character's current HP. */
async function storedHp(page: Page): Promise<number | undefined> {
  const doc = await getCharacter(page, ID);
  return (doc?.play as { currentHp?: number } | undefined)?.currentHp;
}

/** The Play tab's HP meter. */
function hpMeter(page: Page): Locator {
  return page.getByRole('meter', { name: 'Hit points' });
}

/**
 * Stores the caster (fixtures/caster.ts) under `ID`, opens it on Play in `a`
 * and on Build in `b`, and waits until both warn. Returns its max HP.
 */
async function openInTwoTabs(a: Page, b: Page): Promise<number> {
  await gotoRosterSettled(a);
  const blank = await getCharacter(a, await createBlankCharacter(a));
  if (blank === undefined) throw new Error('The blank character was not stored');
  const { file, previewTitle } = casterFile(blank, ID, NAME);
  await gotoRoster(a);
  await importCharacterFile(a, file);
  await answerImportPreview(a, previewTitle);

  await gotoSheetTab(a, ID, 'Play');
  await expect(openElsewhere(a)).toHaveCount(0);
  const max = Number(await hpMeter(a).getAttribute('aria-valuemax'));
  expect(max).toBeGreaterThan(5);

  await gotoSheetTab(b, ID, 'Build');
  await expect(openElsewhere(a)).toBeVisible();
  await expect(openElsewhere(b)).toBeVisible();
  return max;
}

test.describe('one character in two tabs', () => {
  test.beforeEach(async ({ page }) => {
    await skipOfflineReadyNotice(page);
  });

  /** The second tab, with the same overlay handling the first gets. */
  async function secondTab(page: Page): Promise<Page> {
    const b = await page.context().newPage();
    await skipOfflineReadyNotice(b);
    await handleOverlays(b);
    return b;
  }

  test('both warn, the later save wins the whole document, and closing one clears the warning', async ({
    page: a,
  }) => {
    const b = await secondTab(a);
    const max = await openInTwoTabs(a, b);
    const hpBefore = await storedHp(a);
    expect(hpBefore).toBeDefined();

    // Tab A takes damage and saves it.
    await a.getByRole('button', { name: 'Damage 5 hit points' }).click();
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max - 5));
    await expect(saveIndicator(a)).toHaveText('Saved');
    await expect.poll(() => storedHp(a)).toBe(max - 5);

    // Tab B, which loaded the character before that, renames it and saves.
    await b.getByRole('textbox', { name: 'Name' }).fill(RENAMED);
    await expect(b.getByRole('heading', { level: 1 })).toHaveText(RENAMED);
    await expect(saveIndicator(b)).toHaveText('Saved');
    await expect.poll(async () => (await getCharacter(b, ID))?.name).toBe(RENAMED);

    // Last writer wins: B wrote the document it had, A's damage and all.
    const stored = await getCharacter(a, ID);
    expect(stored?.name).toBe(RENAMED);
    expect(await storedHp(a)).toBe(hpBefore);
    // Tab A still shows its own edit until it reads the stored one again.
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max - 5));
    await a.reload();
    await expect(a.getByRole('heading', { level: 1 })).toHaveText(RENAMED);
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max));
    await expect(openElsewhere(a)).toBeVisible();

    // Closing B clears A's warning: at once by B's goodbye, or, if that is
    // lost, at A's first heartbeat after B's last ping is STALE_MS old (a
    // second of margin for timer drift).
    await b.close();
    await expect
      .poll(() => openElsewhere(a).count(), { timeout: STALE_MS + HEARTBEAT_MS + 1_000 })
      .toBe(0);
  });

  test('a tab that dies without a goodbye ages out of the warning', async ({ page: a }) => {
    const b = await secondTab(a);
    await openInTwoTabs(a, b);

    // A crashed renderer runs no pagehide, so no `bye` is sent: only
    // staleness can clear the warning, at A's first heartbeat after B's last
    // ping (at most HEARTBEAT_MS before the crash) is STALE_MS old.
    const crashed = b.waitForEvent('crash');
    const cdp = await a.context().newCDPSession(b);
    void cdp.send('Page.crash').catch(() => undefined);
    await crashed;
    const at = Date.now();
    await expect
      .poll(() => openElsewhere(a).count(), { timeout: STALE_MS + 2 * HEARTBEAT_MS + 2_000 })
      .toBe(0);
    // Not cleared by a goodbye, which would take milliseconds (a second of
    // slack for timer drift).
    expect(Date.now() - at).toBeGreaterThan(STALE_MS - HEARTBEAT_MS - 1_000);
  });
});
