import type { Page } from '@playwright/test';
import { MIRROR_PATHS, PINNED_TAG } from '../fixtures/mirror.ts';
import {
  characterLink,
  createBlankCharacter,
  expectDataSettled,
  gotoRoster,
  rosterHeading,
} from '../support/app.ts';
import { countDataFiles } from '../support/idb.ts';
import { waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

/** Online first visit: full data, one character, and a page the worker controls. */
async function installForOffline(page: Page): Promise<string> {
  await gotoRoster(page);
  const id = await createBlankCharacter(page);
  await gotoRoster(page);
  await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
  await waitForSwControl(page);
  return id;
}

async function expectAppWorksOffline(page: Page, id: string): Promise<void> {
  await expect(rosterHeading(page)).toBeVisible();
  await expect(characterLink(page, 'New hero')).toBeVisible();

  await page.goto('/settings');
  await expect(page).toHaveTitle('Settings · Cast Guidance');

  await page.goto('/library/race');
  await expect(page).toHaveTitle(/· Library · Cast Guidance$/);
  await expect(page.getByRole('main').getByText('Elf', { exact: true })).toBeVisible();

  await page.goto(`/c/${id}`);
  await expect(page).toHaveTitle('Play · New hero · Cast Guidance');
  await expect(page.getByRole('heading', { level: 1, name: 'New hero' })).toBeVisible();
}

test.describe('offline reload', () => {
  test('reloads and deep-links offline from the precache and IndexedDB', async ({
    page,
    mirror,
    network,
  }) => {
    const id = await installForOffline(page);
    const hitsBefore = mirror.totalHits();
    const tagListBefore = mirror.tagListRequests;

    await network.goOffline();
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expectAppWorksOffline(page, id);
    network.assertNothingServedOffline();

    // Back online, nothing is downloaded again: the release is complete.
    await network.goOnline();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'New hero' })).toBeVisible();
    await gotoRoster(page);
    await expect(characterLink(page, 'New hero')).toBeVisible();
    await expectDataSettled(page);
    expect(mirror.totalHits()).toBe(hitsBefore);
    expect(mirror.tagListRequests).toBe(tagListBefore);
  });

  test('a browser restart in airplane mode still opens the app', async ({
    launchProfile,
    network,
  }, testInfo) => {
    const dir = testInfo.outputPath('profile');
    const online = await launchProfile(dir);
    const first = online.pages()[0] ?? (await online.newPage());
    const id = await installForOffline(first);
    await online.close();

    // A cold start: new browser process, the worker starting from nothing.
    await network.goOffline();
    const offline = await launchProfile(dir, { offline: true });
    const page = offline.pages()[0] ?? (await offline.newPage());
    await page.goto('/');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expectAppWorksOffline(page, id);
    network.assertNothingServedOffline();
  });
});
