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
  openCharacterActions,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { getCharacter } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * One character open in two tabs (REL-007 #98, the IndexedDB risks of #121):
 * two pages in one context, so real IndexedDB and real BroadcastChannels
 * between them. Each tab warns that the other is open. A tab with nothing
 * unsaved follows the other's saves as they land, so its next edit builds on
 * them. A tab still holding an edit when the other saves is refused when it
 * tries to save, and offers Reload stored version or Keep mine; either way
 * nothing is lost silently. `src/stores/characterSession.multitab.indexeddb.test.ts`
 * covers the same in process.
 *
 * To hold an edit unsaved while the other tab saves, the clock is frozen so
 * the 400 ms save debounce cannot fire on its own. Playwright's clock belongs
 * to the whole context, so it holds both tabs: the tab that must save first
 * is flushed the way a page going away flushes it (a `pagehide`, as in
 * lifecycle.spec.ts), and the stale tab's debounce is then run past. The
 * clock also fakes `requestAnimationFrame`, which the focus move after
 * resolving and the History drawer's slide-in wait on, and the timers the
 * roster's live list waits on, so it resumes once the conflict is up.
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

function heading(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}

/** The banner for a refused save, by a fragment of what it says happened. */
function conflictBanner(page: Page, happened: 'changed' | 'deleted'): Locator {
  return page.getByRole('alert').filter({ hasText: `${happened} in another tab` });
}

/** Moves to another tab of the sheet through its tab bar, without a reload. */
async function switchSheetTab(page: Page, label: string): Promise<void> {
  const link = page
    .getByRole('navigation', { name: 'Character sheet' })
    .getByRole('link', { name: label, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
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
  // A new character's HP follows its maximum, which the sheet saves by
  // itself; B opens on that save, not before it.
  await expect.poll(() => storedHp(a)).toBe(max);

  await gotoSheetTab(b, ID, 'Build');
  await expect(openElsewhere(a)).toBeVisible();
  await expect(openElsewhere(b)).toBeVisible();
  return max;
}

/** Freezes the context's clock (both tabs), so no save debounce fires on its own. */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000);
}

/** Saves a tab's pending edit now, as a page going away does. */
async function flushByPagehide(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
}

/** B's rename, held unsaved by the frozen clock. */
async function holdRename(b: Page): Promise<void> {
  await b.getByRole('textbox', { name: 'Name' }).fill(RENAMED);
  await expect(heading(b)).toHaveText(RENAMED);
  await expect(saveIndicator(b)).toHaveText('Unsaved');
}

/**
 * Leaves an edit unsaved in `b` (a rename) while `a` takes 5 damage and saves
 * it, then runs the clock past `b`'s debounce. Its save is refused, and the
 * clock resumes.
 */
async function staleRenameRefused(a: Page, b: Page, max: number): Promise<void> {
  await freezeClock(b);
  await holdRename(b);
  // Not saved yet, so what follows really is A saving first.
  expect((await getCharacter(a, ID))?.name).toBe(NAME);

  await a.getByRole('button', { name: 'Damage 5 hit points' }).click();
  await expect(saveIndicator(a)).toHaveText('Unsaved');
  await flushByPagehide(a);
  await expect(saveIndicator(a)).toHaveText('Saved');
  await expect.poll(() => storedHp(a)).toBe(max - 5);
  // B, holding an edit of its own, did not take A's save.
  await expect(heading(b)).toHaveText(RENAMED);

  await b.clock.runFor(500);
  await expect(conflictBanner(b, 'changed')).toBeVisible();
  await expect(saveIndicator(b)).toHaveText('Not saved');
  const stored = await getCharacter(a, ID);
  expect(stored?.name).toBe(NAME);
  expect(await storedHp(a)).toBe(max - 5);
  await b.clock.resume();
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

  test("both warn, a clean tab follows the other's save, and closing one clears the warning", async ({
    page: a,
  }) => {
    const b = await secondTab(a);
    const max = await openInTwoTabs(a, b);

    // Tab A takes damage and saves it.
    await a.getByRole('button', { name: 'Damage 5 hit points' }).click();
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max - 5));
    await expect(saveIndicator(a)).toHaveText('Saved');
    await expect.poll(() => storedHp(a)).toBe(max - 5);

    // Tab B, which had nothing unsaved, has it without a reload.
    await switchSheetTab(b, 'Play');
    await expect(hpMeter(b)).toHaveAttribute('aria-valuenow', String(max - 5));

    // B's rename builds on it, and A follows in turn.
    await switchSheetTab(b, 'Build');
    await b.getByRole('textbox', { name: 'Name' }).fill(RENAMED);
    await expect(heading(b)).toHaveText(RENAMED);
    await expect(saveIndicator(b)).toHaveText('Saved');
    await expect.poll(async () => (await getCharacter(b, ID))?.name).toBe(RENAMED);
    expect(await storedHp(a)).toBe(max - 5);
    await expect(heading(a)).toHaveText(RENAMED);
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max - 5));
    await expect(conflictBanner(a, 'changed')).toHaveCount(0);
    await expect(conflictBanner(b, 'changed')).toHaveCount(0);

    // Closing B clears A's warning: at once by B's goodbye, or, if that is
    // lost, at A's first heartbeat after B's last ping is STALE_MS old (a
    // second of margin for timer drift).
    await b.close();
    await expect
      .poll(() => openElsewhere(a).count(), { timeout: STALE_MS + HEARTBEAT_MS + 1_000 })
      .toBe(0);
  });

  test("a stale tab's save is refused, and Reload stored version keeps both", async ({
    page: a,
  }) => {
    const b = await secondTab(a);
    const max = await openInTwoTabs(a, b);
    await staleRenameRefused(a, b, max);

    await b.getByRole('button', { name: 'Reload stored version' }).click();
    await expect(conflictBanner(b, 'changed')).toHaveCount(0);
    await expect(heading(b)).toHaveText(NAME);
    await expect(b.locator('#sheet-title')).toBeFocused();
    await expect(b.getByRole('textbox', { name: 'Name' })).toHaveValue(NAME);
    await switchSheetTab(b, 'Play');
    await expect(hpMeter(b)).toHaveAttribute('aria-valuenow', String(max - 5));

    // The rename B did not keep is in its history.
    await b.getByRole('button', { name: 'Character history' }).click();
    const history = b.getByRole('dialog', { name: 'History' });
    await expect(history.getByText('Not saved: the stored copy had changed')).toBeVisible();
    const stored = await getCharacter(a, ID);
    expect(stored?.name).toBe(NAME);
  });

  test("Keep mine saves the stale tab's version, and the other tab follows it", async ({
    page: a,
  }) => {
    const b = await secondTab(a);
    const max = await openInTwoTabs(a, b);
    await staleRenameRefused(a, b, max);

    await b.getByRole('button', { name: 'Keep mine (overwrite)' }).click();
    await expect(conflictBanner(b, 'changed')).toHaveCount(0);
    await expect(b.locator('#sheet-title')).toBeFocused();
    await expect.poll(async () => (await getCharacter(a, ID))?.name).toBe(RENAMED);
    // B's whole version, HP it had and all: A's damage stays in A's history.
    expect(await storedHp(a)).toBe(max);
    await expect(saveIndicator(b)).toHaveText('Saved');

    // A had nothing unsaved, so it shows B's version without a reload.
    await expect(heading(a)).toHaveText(RENAMED);
    await expect(hpMeter(a)).toHaveAttribute('aria-valuenow', String(max));
  });

  for (const [choice, kept] of [
    ['Keep mine (restore it)', true],
    ['Discard my edits', false],
  ] as const) {
    test(`a character the other tab deleted: ${choice}`, async ({ page: a }) => {
      const b = await secondTab(a);
      await openInTwoTabs(a, b);
      await gotoRoster(a);

      await freezeClock(b);
      await holdRename(b);
      // The roster's list waits on timers to drop the row, so the delete is
      // checked in the database instead.
      const actions = await openCharacterActions(a, NAME);
      await actions.getByRole('button', { name: 'Delete' }).click();
      const confirm = a.getByRole('dialog', { name: `Delete ${NAME}?` });
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(confirm).toBeHidden();
      await expect.poll(() => getCharacter(a, ID)).toBeUndefined();

      await b.clock.runFor(500);
      await expect(conflictBanner(b, 'deleted')).toBeVisible();
      // The refused save did not bring it back.
      expect(await getCharacter(a, ID)).toBeUndefined();
      await b.clock.resume();

      await b.getByRole('button', { name: choice }).click();
      await expect(conflictBanner(b, 'deleted')).toHaveCount(0);
      if (kept) {
        await expect.poll(async () => (await getCharacter(a, ID))?.name).toBe(RENAMED);
        await expect(heading(b)).toHaveText(RENAMED);
        await expect(a.getByRole('button', { name: `Actions for ${RENAMED}` })).toBeVisible();
      } else {
        await expect(b.getByText('Character not found.')).toBeVisible();
        expect(await getCharacter(a, ID)).toBeUndefined();
      }
    });
  }

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
