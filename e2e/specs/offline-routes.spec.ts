import type { Locator, Page, TestInfo } from '@playwright/test';
import { PINNED_TAG } from '../fixtures/mirror.ts';
import { dataFailureBanner, libraryEntry, settingsValue } from '../support/app.ts';
import {
  CACHE_LEVELS,
  type CacheLevel,
  copyLevel,
  type LevelManifest,
  readManifest,
} from '../support/cacheLevels.ts';
import {
  expect,
  heardLines,
  type StableLaunch,
  type StableLaunchOptions,
  test,
} from '../support/coldLaunch.ts';
import {
  type Cell,
  downloadAlerts,
  failurePanel,
  OFFLINE_SPELL_LIST,
  offlineBanner,
  offlineData,
  offlineSection,
  offlineSpellList,
  ROUTE_ERROR,
  ROUTES,
  type RouteCase,
  type SheetCell,
  SPINNERS,
} from '../support/routeMatrix.ts';

/**
 * PWA-001: every route, cold and offline, at every cache level. Each cell is a
 * copy of the level's profile (`cache-levels.setup.ts`) launched in airplane
 * mode: a new browser process, the service worker starting from nothing, no
 * network at all. See `support/routeMatrix.ts` for what each cell expects.
 */

type Launch = (dir: string, options?: StableLaunchOptions) => Promise<StableLaunch>;

/** Copies the level's profile into this test's output and launches the copy. */
async function openLevel(
  launchStable: Launch,
  testInfo: TestInfo,
  level: CacheLevel,
  options: StableLaunchOptions = { offline: true },
): Promise<StableLaunch & { manifest: LevelManifest }> {
  const manifest = readManifest(level);
  const dir = testInfo.outputPath('profile');
  copyLevel(level, dir);
  const launch = await launchStable(dir, options);
  return { ...launch, manifest };
}

/** What every cell must show, whatever its state. */
async function expectCell(page: Page, route: RouteCase, cell: Cell, level: CacheLevel) {
  await expect(cell.shows(page)).toBeVisible();
  if (cell.action !== undefined) await expect(cell.action(page)).toBeVisible();
  for (const also of [cell.also?.(page) ?? []].flat()) await expect(also).toBeVisible();
  if (cell.absent !== undefined) await expect(cell.absent(page)).toHaveCount(0);
  await expect(route.frame(page)).toBeVisible();
  await expect(page).toHaveTitle(cell.title);
  // An incomplete download says why it stopped, on every page, with a way on.
  if (level !== 'full') {
    await expect(offlineBanner(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  }
  // One voice (A11Y-002): offline the banner is the only alert about the
  // download, whatever panels the page shows, and the announcer does not say
  // it again. (A page's own alert about something else, such as a homebrew
  // file that is gone, is a different outcome and stays.)
  await expect(downloadAlerts(page)).toHaveCount(level === 'full' ? 0 : 1);
  await expect(page.getByText(SPINNERS)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ROUTE_ERROR })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  if (cell.sheet !== undefined && route.open !== undefined) {
    await expectSheet(page, await route.open(page), cell.sheet, level);
  }
  // Last, so a line said late is caught too: everything the announcer added
  // during the visit, including lines that have already left its regions.
  expect((await heardLines(page)).filter((line) => SAYS_FAILURE.test(line))).toEqual([]);
}

/**
 * A sheet opened over the cell. The modal hides the rest of the app from
 * assistive tech, banner included, so inside it the sheet's own panel is the
 * one alert about the download: one while anything is missing, none at full.
 */
async function expectSheet(page: Page, dialog: Locator, sheet: SheetCell, level: CacheLevel) {
  await expect(sheet.shows(dialog)).toBeVisible();
  if (sheet.absent !== undefined) await expect(sheet.absent(dialog)).toHaveCount(0);
  await expect(dialog.getByText(SPINNERS)).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(level === 'full' ? 0 : 1);
  // Nothing outside the sheet is heard over it.
  await expect(downloadAlerts(page)).toHaveCount(level === 'full' ? 0 : 1);
}

/** Words that would repeat a download failure the banner already alerts. */
const SAYS_FAILURE = /offline|couldn't be downloaded|download failed/i;

test.describe.configure({ mode: 'parallel' });

for (const level of CACHE_LEVELS) {
  test.describe(`${level} cache, cold and offline`, () => {
    for (const route of ROUTES) {
      const cell = route.at(level);
      test(`${route.name}: ${cell.state}`, async ({ launchStable }, testInfo) => {
        const { page, manifest } = await openLevel(launchStable, testInfo, level);
        await page.goto(route.path(manifest));
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await expectCell(page, route, cell, level);
      });
    }
  });
}

test.describe('offline launches', () => {
  test('cannot reach the origin or the mirror', async ({ launchStable }, testInfo) => {
    const { page } = await openLevel(launchStable, testInfo, 'full');
    await page.goto('/');
    // The update check runs in the browser, below `offline: true`; only the
    // airplane-mode resolver stops it reaching the origin.
    const update = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg === undefined
        ? 'no registration'
        : reg.update().then(
            () => 'updated',
            (err: unknown) => (err instanceof Error ? err.name : String(err)),
          );
    });
    expect(update).toBe('TypeError');
  });
});

test.describe('back online, each offline state recovers', () => {
  test('sheet at none: Retry offline stays put, and the sheet arrives once online', async ({
    launchStable,
    backOnline,
  }, testInfo) => {
    const launch = await openLevel(launchStable, testInfo, 'none');
    const { page, manifest } = launch;
    await page.goto(`/c/${manifest.characterId}`);
    // Pressed offline, Retry tries and says the same thing again: no spinner
    // left behind, no error in place of the reason.
    await offlineData(page).getByRole('button', { name: 'Retry' }).click();
    await expect(offlineData(page)).toBeVisible();
    await expect(page.getByText(SPINNERS)).toHaveCount(0);
    await backOnline(launch);
    await expect(page.getByRole('button', { name: 'Short rest', exact: true })).toBeVisible();
  });

  test('creator at none: the first step arrives once online', async ({
    launchStable,
    backOnline,
  }, testInfo) => {
    const launch = await openLevel(launchStable, testInfo, 'none');
    await launch.page.goto('/create');
    await expect(offlineData(launch.page)).toBeVisible();
    await backOnline(launch);
    await expect(launch.page.getByRole('textbox', { name: 'Character name' })).toBeVisible();
  });

  test('library at partial: the section arrives once online', async ({
    launchStable,
    backOnline,
  }, testInfo) => {
    const launch = await openLevel(launchStable, testInfo, 'partial');
    await launch.page.goto('/library/spell/fireball%7Cphb');
    await expect(offlineSection(launch.page)).toBeVisible();
    await backOnline(launch);
    await expect(launch.page).toHaveTitle('Fireball · Spells · Library · Cast Guidance');
  });

  test('caster spells at partial: the spell list arrives once online', async ({
    launchStable,
    backOnline,
  }, testInfo) => {
    // The banner's drain can land Fireball by itself, but only the panel's
    // own reconnect retry clears the spell download's error and the panel.
    const launch = await openLevel(launchStable, testInfo, 'partial');
    const { page, manifest } = launch;
    await page.goto(`/c/${manifest.casterId}/spells`);
    await expect(offlineSpellList(page)).toBeVisible();
    await backOnline(launch);
    await expect(page.getByRole('link', { name: 'Fireball', exact: true })).toBeVisible();
    await expect(page.getByText(OFFLINE_SPELL_LIST)).toHaveCount(0);
    await expect(page.getByText(SPINNERS)).toHaveCount(0);
  });

  test('banner at essential: the download finishes once online', async ({
    launchStable,
    backOnline,
  }, testInfo) => {
    const launch = await openLevel(launchStable, testInfo, 'essential');
    await launch.page.goto('/settings');
    await expect(offlineBanner(launch.page)).toBeVisible();
    await backOnline(launch);
    await expect(settingsValue(launch.page, 'Download queue')).toHaveText('done');
    await expect(settingsValue(launch.page, 'Offline compendium')).toHaveText('ready ✓');
    await expect(launch.page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('essentials that only partly landed', () => {
  test('Settings says not downloaded yet, not unreadable, when only the class index is missing', async ({
    launchStable,
    mirror,
  }, testInfo) => {
    // The essential level minus `class/index.json`: some game data on disk,
    // but nothing to count the compendium against. Prepared online with the
    // mirror refusing, so nothing comes back while the row is removed.
    mirror.setFail(() => 'abort');
    const prepare = await openLevel(launchStable, testInfo, 'essential', { offline: false });
    await prepare.page.goto('/');
    await editDataFile(prepare.page, 'class/index.json', null);
    await prepare.context.close();

    const { page } = await launchStable(testInfo.outputPath('profile'), { offline: true });
    await page.goto('/settings');
    await expect(settingsValue(page, 'Offline compendium')).toHaveText('not downloaded yet');
    await expect(page.getByRole('button', { name: 'Make available offline' })).toBeVisible();
    await expect(offlineBanner(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.describe('a failure with no banner to say it', () => {
  test('a repair pressed offline at full is said once, by the section panel', async ({
    launchStable,
  }, testInfo) => {
    // The whole release with one corrupt file. The queue is done, so the
    // banner is hidden: the panel is the only thing that can say the repair
    // could not run.
    const prepare = await openLevel(launchStable, testInfo, 'full', { offline: false });
    await prepare.page.goto('/');
    await editDataFile(prepare.page, 'spells/spells-phb.json', { spell: [] });
    await prepare.context.close();

    const { page } = await launchStable(testInfo.outputPath('profile'), { offline: true });
    await page.goto('/library/spell/fireball%7Cphb');
    await page.getByRole('button', { name: 'Download this section again' }).click();
    await expect(offlineSection(page)).toBeVisible();
    await expect(downloadAlerts(page)).toHaveCount(1);
    await expect(offlineSection(page)).toHaveAttribute('role', 'alert');
  });
});

test.describe('online, the failures are told apart', () => {
  test('a section that failed to download is not called offline', async ({
    launchStable,
    mirror,
  }, testInfo) => {
    mirror.setFail(() => 'abort');
    const { page } = await openLevel(launchStable, testInfo, 'essential', { offline: false });
    const banner = dataFailureBanner(page, 'Game data download failed');
    const failed = failurePanel(page, "This section couldn't be downloaded: ");
    // One outage, two pages that see it: the banner's queue and the section
    // both fail, in either order. Once both have, it is one alert (A11Y-002).
    for (const path of ['/library/spell/fireball%7Cphb', '/library/spell']) {
      await page.goto(path);
      await expect(banner).toBeVisible();
      await expect(failed).toBeVisible();
      await expect(downloadAlerts(page)).toHaveCount(1);
    }
    await expect(offlineSection(page)).toHaveCount(0);
    mirror.setFail(undefined);
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(libraryEntry(page, 'Fireball')).toBeVisible();
  });

  test("a caster's spell list that failed to download is not called offline", async ({
    launchStable,
    mirror,
  }, testInfo) => {
    mirror.setFail(() => 'abort');
    const { page, manifest } = await openLevel(launchStable, testInfo, 'essential', {
      offline: false,
    });
    await page.goto(`/c/${manifest.casterId}/spells`);
    await expect(dataFailureBanner(page, 'Game data download failed')).toBeVisible();
    await expect(failurePanel(page, "The spell list couldn't be downloaded: ")).toBeVisible();
    // One outage, said once (A11Y-002), whichever failed first.
    await expect(downloadAlerts(page)).toHaveCount(1);
    await expect(offlineSpellList(page)).toHaveCount(0);
    await expect(page.getByText(SPINNERS)).toHaveCount(0);
  });

  test('a corrupted section offers to download it again, and that repairs it', async ({
    launchStable,
  }, testInfo) => {
    const { page } = await openLevel(launchStable, testInfo, 'full', { offline: false });
    await page.goto('/');
    await editDataFile(page, 'spells/spells-phb.json', { spell: [] });
    await page.goto('/library/spell/fireball%7Cphb');
    const again = page.getByRole('button', { name: 'Download this section again' });
    await expect(again).toBeVisible();
    await expect(page).toHaveTitle('Not found · Spells · Library · Cast Guidance');
    await again.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();
  });
});

/**
 * Rewrites one cached data file in place: `json` replaces its body, as a
 * truncated write or a body cached from a misbehaving proxy would leave it
 * (still there, so nothing counts it as missing); `null` deletes the row, as
 * a download stopped part way through essentials would leave it.
 */
async function editDataFile(target: Page, path: string, json: unknown | null): Promise<void> {
  await target.evaluate(
    ({ key, json }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cast-guidance');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('dataFiles', 'readwrite');
          const store = tx.objectStore('dataFiles');
          const get = store.get(key);
          get.onsuccess = () => {
            if (get.result === undefined) {
              reject(new Error(`no cached row ${key}`));
              return;
            }
            if (json === null) store.delete(key);
            else store.put({ ...get.result, json });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { key: `${PINNED_TAG}:${path}`, json },
  );
}
