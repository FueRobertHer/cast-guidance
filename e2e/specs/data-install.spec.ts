import type { Page } from '@playwright/test';
import { ESSENTIALS_FILES, LIBRARY_EXTRAS_FILES } from '../../src/data5e/packs.ts';
import {
  MIRROR_PATHS,
  NEXT_ONLY_RACE,
  NEXT_TAG,
  PINNED_TAG,
  withNextRelease,
} from '../fixtures/mirror.ts';
import {
  announcements,
  dataFailureBanner,
  dataProgress,
  dataUpdateToast,
  expectDataSettled,
  gotoRaces,
  libraryEntry,
  onScreen,
  settingsValue,
  startDataInstall,
} from '../support/app.ts';
import { cachedPaths, countDataFiles, getSetting, putSetting } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * Data installs (#123): the background drain on a first launch, and
 * `updateToTag` from Settings and from the boot toast. The rules these hold
 * the loader to, from DATA-002 (#104, #152) and DATA-003 (#105):
 * - a failed install prunes what it staged, so a retry downloads the whole
 *   release again; the old release stays active and usable until the swap;
 * - after the swap, the old release's rows stay (with `dataTagRollback`) until
 *   a registry builds under the new one, then they are swept.
 */

/** A species both releases have, so a page that lists it has finished reading. */
const SHARED_RACE = 'Elf';

/** The last file `updateToTag` fetches: everything else is staged by then. */
const LAST_FILE = 'spells/spells-phb.json';

/** The settings key that holds an install on probation (see `loader.ts`). */
const ROLLBACK = 'dataTagRollback';

/** Online first launch: the pinned release fully installed, Settings open. */
async function installPinned(page: Page): Promise<void> {
  await page.goto('/');
  await expectDataSettled(page);
  expect(await countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
  expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
}

/** Opens the library's species list by its links, keeping this page's session. */
async function openRacesInApp(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Library' })
    .click();
  await page.getByRole('link', { name: /^Species \/ Races/ }).click();
  await expect(page).toHaveURL(/\/library\/race$/);
}

/** Every path of the release except `skip`. */
function pathsExcept(...skip: string[]): string[] {
  return MIRROR_PATHS.filter((p) => !skip.includes(p));
}

/**
 * The swap's aftermath once a registry has been built under `tag`: the
 * install confirmed (no rollback record) and every other release swept.
 */
async function expectConfirmedOn(page: Page, tag: string, swept: string): Promise<void> {
  await expect.poll(() => countDataFiles(page, swept)).toBe(0);
  expect(await getSetting(page, ROLLBACK)).toBeUndefined();
  expect(await getSetting(page, 'dataTag')).toBe(tag);
  expect(await countDataFiles(page, tag)).toBe(MIRROR_PATHS.length);
}

test.describe('data installs', () => {
  test('a first install that fails mid-drain keeps essentials, reports it, and Retry finishes', async ({
    page,
    mirror,
  }) => {
    // The drain goes essentials, classes, items, spells, library extras, and
    // stops at the first pack that fails.
    mirror.setFail((tag, path) => (tag === PINNED_TAG && path === LAST_FILE ? 500 : undefined));
    await page.goto('/');

    const banner = dataFailureBanner(
      page,
      `Game data download failed: failed to fetch "${LAST_FILE}"`,
    );
    await expect(banner).toBeVisible();
    await expect(dataProgress(page)).toHaveCount(0);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);

    // Essentials landed, and everything drained before the failure with them;
    // nothing after the failing pack was asked for.
    const onDisk = await cachedPaths(page, PINNED_TAG);
    for (const path of ESSENTIALS_FILES) expect(onDisk, path).toContain(path);
    expect(onDisk).not.toContain(LAST_FILE);
    for (const path of LIBRARY_EXTRAS_FILES) {
      expect(onDisk, path).not.toContain(path);
      expect(mirror.hits.get(`${PINNED_TAG}:${path}`) ?? 0, path).toBe(0);
    }

    // The app works on what landed, in this same session.
    await openRacesInApp(page);
    await expect(libraryEntry(page, SHARED_RACE)).toBeVisible();
    await expect(banner).toBeVisible();

    mirror.setFail(undefined);
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toBeHidden();
    await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    await expectDataSettled(page);

    // Retry fetched only what was missing: every file that had landed was
    // asked for once in total, the failed one again.
    for (const path of pathsExcept(LAST_FILE)) {
      expect(mirror.hits.get(`${PINNED_TAG}:${path}`), path).toBe(1);
    }
    expect(mirror.hits.get(`${PINNED_TAG}:${LAST_FILE}`)).toBeGreaterThan(1);
  });

  test('a first install interrupted by a reload finishes on the next launch, pinned once', async ({
    page,
    mirror,
  }) => {
    // Held, so the reload lands while essentials are still downloading.
    mirror.setHold((tag, path) => tag === PINNED_TAG && path === 'races.json');
    await page.goto('/');
    await expect.poll(() => mirror.hits.get(`${PINNED_TAG}:races.json`) ?? 0).toBe(1);
    expect(await countDataFiles(page, PINNED_TAG)).toBeLessThan(MIRROR_PATHS.length);

    await page.reload();
    mirror.releaseHeld();
    await expectDataSettled(page);

    // The tag the first launch pinned is the one the second one finished: the
    // release list was asked for once, and every file sits under that tag.
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
    expect(mirror.tagListRequests).toBe(1);
    expect(await cachedPaths(page, PINNED_TAG)).toEqual([...MIRROR_PATHS].sort());
  });

  test('an offered update installs from Settings, sweeps the old release once a registry builds, and survives a reload', async ({
    page,
    mirror,
  }) => {
    await installPinned(page);
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);

    await startDataInstall(page, NEXT_TAG);
    await expect(
      page.getByText(`Now on ${NEXT_TAG}. Characters re-derive automatically.`).and(onScreen(page)),
    ).toBeVisible();
    await expect(settingsValue(page, 'Dataset version')).toHaveText(NEXT_TAG);
    expect(await getSetting(page, 'dataTag')).toBe(NEXT_TAG);
    expect(await countDataFiles(page, NEXT_TAG)).toBe(MIRROR_PATHS.length);
    for (const path of MIRROR_PATHS) {
      expect(mirror.hits.get(`${NEXT_TAG}:${path}`), path).toBe(1);
    }

    // The old release is kept until a registry builds under the new one; the
    // library builds one, which confirms the install and sweeps it.
    await gotoRaces(page, NEXT_ONLY_RACE);
    await expectConfirmedOn(page, NEXT_TAG, PINNED_TAG);

    // A reload boots the new release from the cache, downloading nothing.
    const hits = mirror.totalHits();
    await page.reload();
    await expect(libraryEntry(page, NEXT_ONLY_RACE)).toBeVisible();
    await expectDataSettled(page);
    await expect(settingsValue(page, 'Dataset version')).toHaveText(NEXT_TAG);
    expect(mirror.totalHits()).toBe(hits);
  });

  test('a failed update keeps the old release active and usable, and Retry installs it', async ({
    page,
    mirror,
  }) => {
    await installPinned(page);
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);
    mirror.setFail((tag, path) => (tag === NEXT_TAG && path === LAST_FILE ? 500 : undefined));

    await startDataInstall(page, NEXT_TAG);
    // Shown twice, said once (A11Y-002): the line in Settings beside its
    // Retry install, and the banner every page shows, whose alert is the one
    // thing a screen reader hears about it.
    const inSettings = page.getByRole('main').getByText(/^Update failed:/);
    await expect(inSettings).toContainText(`failed to fetch "${LAST_FILE}"`);
    await expect(inSettings).toContainText('Your current version is untouched.');
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Retry install' }),
    ).toBeVisible();
    const banner = dataFailureBanner(page, `Update to ${NEXT_TAG} failed`);
    await expect(banner).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(1);
    // The alert is the speaker; the announcer does not say it a second time.
    const saidAsWell = () => announcements(page, 'any').filter({ hasText: /fail/i });
    await expect(saidAsWell()).toHaveCount(0);

    // Nothing moved: the old release is the one in use and still whole, and
    // everything the attempt had staged was pruned.
    await expect(settingsValue(page, 'Dataset version')).toHaveText(PINNED_TAG);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
    expect(await getSetting(page, ROLLBACK)).toBeUndefined();
    await expect.poll(() => countDataFiles(page, NEXT_TAG)).toBe(0);
    expect(await countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);

    await openRacesInApp(page);
    await expect(libraryEntry(page, SHARED_RACE)).toBeVisible();
    await expect(libraryEntry(page, NEXT_ONLY_RACE)).toHaveCount(0);
    // Checked again after these steps, which take longer than any throttle:
    // a polite duplicate held back by one would have landed by now.
    await expect(saidAsWell()).toHaveCount(0);

    // Retry from the banner, holding the last file so the install is caught
    // mid-flight: the old release is still the one in use until the swap.
    mirror.setFail(undefined);
    mirror.setHold((tag, path) => tag === NEXT_TAG && path === LAST_FILE);
    const failedHits = mirror.hits.get(`${NEXT_TAG}:${LAST_FILE}`) ?? 0;
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => mirror.hits.get(`${NEXT_TAG}:${LAST_FILE}`)).toBe(failedHits + 1);
    await expect(dataProgress(page)).toBeVisible();
    await expect(saidAsWell()).toHaveCount(0);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
    expect(await countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    // Read again, not just still on screen: Settings and the library mount
    // afresh (in-app, so the install keeps running) and read the old release.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(settingsValue(page, 'Dataset version')).toHaveText(PINNED_TAG);
    await openRacesInApp(page);
    await expect(libraryEntry(page, SHARED_RACE)).toBeVisible();
    await expect(libraryEntry(page, NEXT_ONLY_RACE)).toHaveCount(0);
    await expect(dataProgress(page)).toBeVisible();
    // The failed attempt's staged rows were pruned, so the retry downloads
    // every file again rather than resuming.
    for (const path of pathsExcept(LAST_FILE)) {
      expect(mirror.hits.get(`${NEXT_TAG}:${path}`), path).toBe(2);
    }

    // The swap reaches the page already open: it reads the new release.
    mirror.releaseHeld();
    await expect(dataProgress(page)).toBeHidden();
    await expect(banner).toHaveCount(0);
    await expect(libraryEntry(page, NEXT_ONLY_RACE)).toBeVisible();
    await expectConfirmedOn(page, NEXT_TAG, PINNED_TAG);
  });

  test('an update interrupted by closing the app leaves the old release intact, and installing again succeeds', async ({
    launchProfile,
    mirror,
  }, testInfo) => {
    // Two browser launches and two installs.
    test.slow();
    const dir = testInfo.outputPath('profile');
    const first = await launchProfile(dir);
    const page = first.pages()[0] ?? (await first.newPage());
    await installPinned(page);
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);

    // Hold the last file, so every other one is staged when the app closes.
    mirror.setHold((tag, path) => tag === NEXT_TAG && path === LAST_FILE);
    await startDataInstall(page, NEXT_TAG);
    await expect.poll(() => mirror.hits.get(`${NEXT_TAG}:${LAST_FILE}`) ?? 0).toBe(1);
    await expect.poll(() => countDataFiles(page, NEXT_TAG)).toBe(MIRROR_PATHS.length - 1);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
    await first.close();
    // The held request belongs to a closed browser now; answering it is a no-op.
    mirror.releaseHeld();

    const pinnedHits = pathsExcept().map((p) => mirror.hits.get(`${PINNED_TAG}:${p}`));
    const second = await launchProfile(dir);
    const again = second.pages()[0] ?? (await second.newPage());
    await again.goto('/');

    // The old release boots, whole, with nothing downloaded again, and the
    // release still on the mirror is offered again.
    const toast = dataUpdateToast(again, NEXT_TAG);
    await expect(toast).toContainText(`(current: ${PINNED_TAG})`);
    await gotoRaces(again, SHARED_RACE);
    await expect(libraryEntry(again, NEXT_ONLY_RACE)).toHaveCount(0);
    await expectDataSettled(again);
    await expect(settingsValue(again, 'Dataset version')).toHaveText(PINNED_TAG);
    expect(await getSetting(again, 'dataTag')).toBe(PINNED_TAG);
    expect(await getSetting(again, ROLLBACK)).toBeUndefined();
    expect(await countDataFiles(again, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    expect(pathsExcept().map((p) => mirror.hits.get(`${PINNED_TAG}:${p}`))).toEqual(pinnedHits);
    // The half-staged release is swept once the launch's drain finishes.
    await expect.poll(() => countDataFiles(again, NEXT_TAG)).toBe(0);

    await startDataInstall(again, NEXT_TAG);
    await expect(
      again
        .getByText(`Now on ${NEXT_TAG}. Characters re-derive automatically.`)
        .and(onScreen(again)),
    ).toBeVisible();
    // The install was waited on in Settings, so its outcome is said too.
    await expect(announcements(again).filter({ hasText: `Now on ${NEXT_TAG}.` })).toHaveCount(1);
    await expect(toast).toHaveCount(0);
    await gotoRaces(again, NEXT_ONLY_RACE);
    await expectConfirmedOn(again, NEXT_TAG, PINNED_TAG);
  });

  test('a launch whose remembered release list has gone stale offers the new release, and its toast installs it', async ({
    page,
    mirror,
  }) => {
    await installPinned(page);
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);
    // Remembered long ago, and without the new release, so only this launch's
    // own request to the mirror can be what offers it.
    await putSetting(page, 'dataTagList', { tags: [PINNED_TAG], checkedAt: 0 });
    const tagLists = mirror.tagListRequests;

    await page.goto('/');
    const toast = dataUpdateToast(page, NEXT_TAG);
    await expect(toast).toContainText(
      `Game data ${NEXT_TAG} is available (current: ${PINNED_TAG}).`,
    );
    expect(mirror.tagListRequests).toBe(tagLists + 1);

    await toast.getByRole('button', { name: 'Update' }).click();
    await expect(toast).toHaveCount(0);
    await expect.poll(() => getSetting(page, 'dataTag')).toBe(NEXT_TAG);
    await expect(dataProgress(page)).toBeHidden();
    await gotoRaces(page, NEXT_ONLY_RACE);
    await expectConfirmedOn(page, NEXT_TAG, PINNED_TAG);
  });

  test('a new release that keeps failing to start is rolled back on the next registry build, with a notice', async ({
    page,
    mirror,
  }) => {
    await installPinned(page);
    mirror.setTags([NEXT_TAG, PINNED_TAG]);
    mirror.setBodies(withNextRelease);
    await putSetting(page, 'dataTagList', { tags: [PINNED_TAG], checkedAt: 0 });

    // Installed from a page that builds no registry, so the install stays on
    // probation: both releases kept, no build started yet.
    await page.goto('/homebrew');
    const toast = dataUpdateToast(page, NEXT_TAG);
    await toast.getByRole('button', { name: 'Update' }).click();
    await expect.poll(() => getSetting(page, 'dataTag')).toBe(NEXT_TAG);
    await expect(dataProgress(page)).toBeHidden();
    expect(await getSetting(page, ROLLBACK)).toEqual({ prev: PINNED_TAG, to: NEXT_TAG, starts: 0 });
    expect(await countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    expect(await countDataFiles(page, NEXT_TAG)).toBe(MIRROR_PATHS.length);

    // Two launches whose registry build started and never finished, as a
    // release that crashes the app leaves them (see the README for why this
    // is seeded rather than produced).
    await putSetting(page, ROLLBACK, { prev: PINNED_TAG, to: NEXT_TAG, starts: 2 });

    await page.goto('/library/race');
    // A plain visual, said through the announcer (A11Y-002).
    const rollback = `Game data ${NEXT_TAG} could not start, so the app went back to ${PINNED_TAG}.`;
    const notice = page.getByText(rollback).and(onScreen(page)).locator('xpath=..');
    await expect(notice).toBeVisible();
    await expect(announcements(page).filter({ hasText: rollback })).toHaveCount(1);
    await expect(libraryEntry(page, SHARED_RACE)).toBeVisible();
    await expect(libraryEntry(page, NEXT_ONLY_RACE)).toHaveCount(0);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);
    expect(await getSetting(page, ROLLBACK)).toBeUndefined();
    expect(await getSetting(page, 'dataTagRejected')).toEqual({ tag: NEXT_TAG, dismissed: false });

    // The notice outlives a reload until it is read; the rejected release is
    // swept by that launch's drain.
    await expectDataSettled(page);
    await expect(notice).toBeVisible();
    await expect(settingsValue(page, 'Dataset version')).toHaveText(
      `${PINNED_TAG} (went back from ${NEXT_TAG}, which could not start)`,
    );
    await expect.poll(() => countDataFiles(page, NEXT_TAG)).toBe(0);
    expect(await countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);

    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toBeHidden();
    await expect
      .poll(() => getSetting(page, 'dataTagRejected'))
      .toEqual({ tag: NEXT_TAG, dismissed: true });
    await expectDataSettled(page);
    await expect(settingsValue(page, 'Dataset version')).toHaveText(PINNED_TAG);
    await expect(notice).toHaveCount(0);
  });
});
