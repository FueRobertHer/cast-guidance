import { devices, type Locator, type Page } from '@playwright/test';
import { jsonFile } from '../fixtures/characterFile.ts';
import { MIRROR_PATHS, NEXT_TAG, PINNED_TAG, withNextRelease } from '../fixtures/mirror.ts';
import {
  animationsSettled,
  createBlankCharacter,
  dataFailureBanner,
  gettingStartedDismiss,
  gotoRoster,
  gotoRosterSettled,
  gotoSheetTab,
  offlineReadyNotice,
  openCharacterActions,
  renameCharacter,
  SHEET_TABS,
  type SheetTab,
  settingsValue,
  skipOfflineReadyNotice,
  startDataInstall,
} from '../support/app.ts';
import { putSetting } from '../support/idb.ts';
import { triggerSwUpdate, waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';
import { scanState } from './scan.ts';

/**
 * The axe gate (A11Y-003): every main route, and the dialogs, drawers, banners
 * and toasts that open over them, each scanned as a named state and held to
 * `axe-baseline.json` (see `scan.ts` for the policy, and docs/a11y-audit.md).
 *
 * Each state is scanned only once it is settled, so the counts are the same
 * every run: the data install done, the one-time offline notice kept away
 * (it has a state of its own), the overlay open and its slide-in finished.
 * The viewport is the project's fixed phone; a few states are scanned again
 * at a desktop size, where the layout changes.
 */

const NAME = 'Brin Ashdown';

/** Waits for a dialog to be open and done animating. */
async function opened(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await animationsSettled(page);
}

/** Closes the top dialog with Escape and waits for it to go. */
async function closeWithEscape(page: Page, dialog: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** Opens a page by URL and waits for its main heading. */
async function gotoHeading(page: Page, url: string, heading: string | RegExp): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await animationsSettled(page);
}

/** One homebrew collection holding one spell, as a file to import. */
const HOMEBREW = jsonFile('axe-brew.json', {
  _meta: {
    sources: [{ json: 'AXE', abbreviation: 'AXE', full: 'Axe Test Brew', version: '1.0.0' }],
  },
  spell: [
    {
      name: 'Test Bolt',
      source: 'AXE',
      level: 1,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { type: 'feet', amount: 60 } },
      components: { v: true },
      duration: [{ type: 'instant' }],
      entries: ['A bolt of test energy.'],
    },
  ],
});

test.describe('axe: pages and overlays', () => {
  test.beforeEach(async ({ page }) => {
    await skipOfflineReadyNotice(page);
  });

  test('roster: empty, with a character, and its dialogs', async ({ page }) => {
    // The empty roster is drawn with its getting-started card, so keep it.
    await page.removeLocatorHandler(gettingStartedDismiss(page));
    await gotoRosterSettled(page);
    await expect(gettingStartedDismiss(page)).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'roster-empty');

    await gettingStartedDismiss(page).click();
    await createBlankCharacter(page);
    await gotoRoster(page);
    await renameCharacter(page, 'New hero', NAME);
    await animationsSettled(page);
    await scanState(page, 'roster');

    const actions = await openCharacterActions(page, NAME);
    await animationsSettled(page);
    await scanState(page, 'roster-actions');

    await actions.getByRole('button', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename hero' });
    await opened(page, rename);
    await scanState(page, 'rename-dialog');
    await closeWithEscape(page, rename);

    const again = await openCharacterActions(page, NAME);
    await again.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: `Delete ${NAME}?` });
    await opened(page, confirm);
    await scanState(page, 'delete-confirm');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
  });

  test('character sheet: every tab', async ({ page }) => {
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);

    for (const tab of Object.keys(SHEET_TABS) as SheetTab[]) {
      await gotoSheetTab(page, id, tab);
      await animationsSettled(page);
      await scanState(page, `sheet-${tab.toLowerCase()}`);
    }
  });

  test('character sheet: its drawers and info sheets', async ({ page }) => {
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);

    await gotoSheetTab(page, id, 'Play');
    await page.getByRole('button', { name: 'Dice tray' }).click();
    const dice = page.getByRole('dialog', { name: 'Dice' });
    await opened(page, dice);
    await scanState(page, 'dice-tray');
    await closeWithEscape(page, dice);

    await page.getByRole('button', { name: 'Character history' }).click();
    const history = page.getByRole('dialog', { name: 'History' });
    await opened(page, history);
    await scanState(page, 'history-drawer');
    await closeWithEscape(page, history);

    // A number's breakdown, the sheet's most common info sheet.
    await gotoSheetTab(page, id, 'Stats');
    await page.getByRole('button', { name: /^STR score \d+.*: breakdown$/ }).click();
    const breakdown = page.getByRole('dialog', { name: 'STR score' });
    await opened(page, breakdown);
    await scanState(page, 'breakdown-sheet');
    await closeWithEscape(page, breakdown);

    // An entity's full description, from an option card on Build.
    await gotoSheetTab(page, id, 'Build');
    await page.getByRole('button', { name: 'Fighter details' }).click();
    const info = page.getByRole('dialog', { name: 'Fighter' });
    await opened(page, info);
    await scanState(page, 'entity-info-sheet');
    await closeWithEscape(page, info);
  });

  test('library: index, a list, a detail page and search results', async ({ page }) => {
    await gotoRosterSettled(page);
    await gotoHeading(page, '/library', 'Library');
    await scanState(page, 'library');

    await gotoHeading(page, '/library/spell', 'Spells');
    await expect(page.getByRole('link', { name: /Fireball/ })).toBeVisible();
    await scanState(page, 'library-spells');

    await page.getByRole('link', { name: /Fireball/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'library-detail');

    await gotoHeading(page, '/library', 'Library');
    await page.getByLabel('Search everything').fill('fire');
    await expect(page.getByRole('link', { name: /Fireball/ })).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'library-search');
  });

  test('homebrew: the list, a file, its remove confirm and the builder', async ({ page }) => {
    await gotoRosterSettled(page);
    await gotoHeading(page, '/homebrew', 'Homebrew');
    await scanState(page, 'homebrew-empty');

    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import file', exact: true }).click();
    await (await choosing).setFiles(HOMEBREW);
    await expect(page.getByText(/^Imported "axe-brew\.json"/)).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'homebrew');

    await page.getByRole('button', { name: 'Delete axe-brew.json' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove "axe-brew.json"?' });
    await opened(page, confirm);
    await scanState(page, 'homebrew-remove-confirm');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();

    // A collection of your own opens the builder, by way of a text prompt.
    await page.getByRole('button', { name: 'Create your own homebrew' }).click();
    const named = page.getByRole('dialog', { name: 'Homebrew collection name' });
    await opened(page, named);
    await scanState(page, 'text-prompt');
    await named.getByRole('textbox').fill('Axe Table');
    await named.getByRole('button', { name: 'OK' }).click();
    const abbrev = page.getByRole('dialog', { name: 'Short source id (shown on badges)' });
    await abbrev.getByRole('button', { name: 'OK' }).click();
    await page.waitForURL(/\/homebrew\/edit\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'homebrew-builder');

    await page.goto('/homebrew/edit/no-such-file');
    await expect(page.getByText('This homebrew file is no longer on this device.')).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'homebrew-builder-unknown');
  });

  test('settings, the creator and the not-found page', async ({ page }) => {
    await gotoRosterSettled(page);
    await gotoHeading(page, '/settings', 'Settings');
    await expect(settingsValue(page, 'Offline compendium')).toHaveText('ready ✓');
    await scanState(page, 'settings');

    await gotoHeading(page, '/create', /.+/);
    await scanState(page, 'creator');

    await gotoHeading(page, '/no-such-page', 'Page not found');
    await scanState(page, 'not-found');
  });
});

test.describe('axe: banners and toasts', () => {
  test('the one-time "Ready to use offline" notice', async ({ page }) => {
    await page.removeLocatorHandler(offlineReadyNotice(page));
    // On a fresh device it is only said away from the getting-started card.
    await page.goto('/settings');
    await expect(offlineReadyNotice(page)).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'toast-offline-ready');
  });

  test('the data download banner, and its failure', async ({ page, mirror }) => {
    await skipOfflineReadyNotice(page);
    const last = MIRROR_PATHS.at(-1) as string;
    mirror.setHold((_tag, path) => path === last);
    await gotoRoster(page);
    await expect(page.getByRole('progressbar', { name: 'Downloading game data' })).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'banner-data-download');

    mirror.setFail((_tag, path) => (path === last ? 503 : undefined));
    mirror.releaseHeld();
    const failed = page.getByRole('alert').filter({ hasText: 'Game data download failed' });
    await expect(failed).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'banner-data-error');
  });

  test('the "Game data ... available" toast', async ({ page, mirror }) => {
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    // A newer release appears, and the remembered list is out of date, so
    // the next boot asks for it and offers the update.
    mirror.setTags(['v2.33.0', PINNED_TAG]);
    await putSetting(page, 'dataTagList', { tags: [PINNED_TAG], checkedAt: 0 });
    await page.reload();
    await expect(page.getByText(/v2\.33\.0/)).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'toast-data-update');
  });

  test('a failed data update, in Settings and in the banner', async ({ page, mirror }) => {
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    await gotoHeading(page, '/settings', 'Settings');
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);
    // The last file the install fetches, so everything else is staged first.
    mirror.setFail((tag, path) =>
      tag === NEXT_TAG && path === 'spells/spells-phb.json' ? 500 : undefined,
    );
    await startDataInstall(page, NEXT_TAG);
    await expect(dataFailureBanner(page, `Update to ${NEXT_TAG} failed`)).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Update failed:' })).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'settings-update-failed');
  });

  test('a plain confirm, and the banner for a save that failed', async ({ page }) => {
    await skipOfflineReadyNotice(page);
    // Character writes fail on demand, as a full disk would refuse them.
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
        if ((window as { failSaves?: boolean }).failSaves === true && this.name === 'characters') {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return put.apply(this, args);
      };
    });
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);
    await gotoSheetTab(page, id, 'Play');

    // A confirm that is not destructive, so its button is the red fill.
    await page.getByRole('button', { name: 'Long rest' }).click();
    const rest = page.getByRole('dialog', { name: 'Long rest' });
    await opened(page, rest);
    await scanState(page, 'long-rest-confirm');
    await rest.getByRole('button', { name: 'Cancel' }).click();
    await expect(rest).toBeHidden();

    await page.evaluate(() => {
      (window as { failSaves?: boolean }).failSaves = true;
    });
    await page.getByRole('button', { name: 'Inspiration' }).click();
    const failed = page.getByRole('alert').filter({ hasText: 'could not be saved' });
    await expect(failed).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'banner-save-error');
  });

  test('the banner for a database another tab deleted', async ({ page }) => {
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);
    await gotoSheetTab(page, id, 'Play');
    // What clearing site data from another tab does: the app's connection
    // gets a versionchange, closes, and this tab stops saving.
    await page.evaluate(() => {
      indexedDB.deleteDatabase('cast-guidance');
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'saved data was cleared' }),
    ).toBeVisible();
    await animationsSettled(page);
    await scanState(page, 'banner-db-closed');
  });

  test.describe(() => {
    // A new build is deployed on a server of this test's own (swVariants.ts).
    test.use({ privateServer: true });

    test('the "A new version of the app is ready." toast', async ({ page, server }) => {
      await skipOfflineReadyNotice(page);
      await gotoRosterSettled(page);
      await waitForSwControl(page);
      server.setVariant('v2');
      expect((await triggerSwUpdate(page)).state).toBe('installed');
      await expect(page.getByText('A new version of the app is ready.')).toBeVisible();
      await animationsSettled(page);
      await scanState(page, 'toast-app-update');
    });
  });
});

test.describe('axe: desktop layout', () => {
  // The desktop layout moves the app nav and the sheet's tabs into a side
  // rail, so the main routes are scanned there too. `defaultBrowserType` is
  // dropped because a describe cannot switch browsers; it is Chromium anyway.
  const { defaultBrowserType: _, ...desktop } = devices['Desktop Chrome'];
  test.use(desktop);

  test('roster, library, settings and the Play tab', async ({ page }) => {
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);
    await gotoRoster(page);
    await animationsSettled(page);
    await scanState(page, 'desktop-roster');

    await gotoHeading(page, '/library', 'Library');
    await scanState(page, 'desktop-library');

    await gotoHeading(page, '/settings', 'Settings');
    await expect(settingsValue(page, 'Offline compendium')).toHaveText('ready ✓');
    await scanState(page, 'desktop-settings');

    await gotoSheetTab(page, id, 'Play');
    await animationsSettled(page);
    await scanState(page, 'desktop-sheet-play');
  });
});
