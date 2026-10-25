import type { Page, TestInfo } from '@playwright/test';
import { PINNED_TAG } from '../fixtures/mirror.ts';
import { libraryEntry, settingsValue } from '../support/app.ts';
import {
  CACHE_LEVELS,
  type CacheLevel,
  copyLevel,
  type LevelManifest,
  readManifest,
} from '../support/cacheLevels.ts';
import {
  expect,
  type StableLaunch,
  type StableLaunchOptions,
  test,
} from '../support/coldLaunch.ts';
import {
  type Cell,
  offlineBanner,
  offlineData,
  offlineSection,
  ROUTE_ERROR,
  ROUTES,
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
async function expectCell(page: Page, cell: Cell, level: CacheLevel): Promise<void> {
  await expect(cell.shows(page)).toBeVisible();
  if (cell.action !== undefined) await expect(cell.action(page)).toBeVisible();
  await expect(page).toHaveTitle(cell.title);
  // An incomplete download says why it stopped, on every page, with a way on.
  if (level === 'full') {
    await expect(page.getByRole('alert').filter({ hasText: /Game data/ })).toHaveCount(0);
  } else {
    await expect(offlineBanner(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  }
  await expect(page.getByText(SPINNERS)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ROUTE_ERROR })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test.describe.configure({ mode: 'parallel' });

for (const level of CACHE_LEVELS) {
  test.describe(`${level} cache, cold and offline`, () => {
    for (const route of ROUTES) {
      const cell = route.at(level);
      test(`${route.name}: ${cell.state}`, async ({ launchStable }, testInfo) => {
        const { page, manifest } = await openLevel(launchStable, testInfo, level);
        await page.goto(route.path(manifest));
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await expectCell(page, cell, level);
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

test.describe('online, the failures are told apart', () => {
  test('a section that failed to download is not called offline', async ({
    launchStable,
    mirror,
  }, testInfo) => {
    mirror.setFail(() => 'abort');
    const { page } = await openLevel(launchStable, testInfo, 'essential', { offline: false });
    await page.goto('/library/spell');
    const failed = page
      .getByRole('alert')
      .filter({ hasText: "This section couldn't be downloaded" });
    await expect(failed).toBeVisible();
    await expect(offlineSection(page)).toHaveCount(0);
    mirror.setFail(undefined);
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect(libraryEntry(page, 'Fireball')).toBeVisible();
  });

  test('a corrupted section offers to download it again, and that repairs it', async ({
    launchStable,
  }, testInfo) => {
    const { page } = await openLevel(launchStable, testInfo, 'full', { offline: false });
    await page.goto('/');
    await corruptDataFile(page, 'spells/spells-phb.json', { spell: [] });
    await page.goto('/library/spell/fireball%7Cphb');
    const again = page.getByRole('button', { name: 'Download this section again' });
    await expect(again).toBeVisible();
    await expect(page).toHaveTitle('Not found · Spells · Library · Cast Guidance');
    await again.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();
  });
});

/**
 * Overwrites a cached data file's body in place, as a truncated write or a
 * body cached from a misbehaving proxy would leave it: still there, so
 * nothing counts it as missing.
 */
async function corruptDataFile(target: Page, path: string, json: unknown): Promise<void> {
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
            store.put({ ...get.result, json });
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
