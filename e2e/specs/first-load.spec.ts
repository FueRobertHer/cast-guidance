import { MIRROR_PATHS, PINNED_TAG } from '../fixtures/mirror.ts';
import {
  emptyRosterLine,
  expectDataSettled,
  gettingStartedDismiss,
  offlineReadyNotice,
  rosterHeading,
} from '../support/app.ts';
import { countDataFiles, getSetting } from '../support/idb.ts';
import { swState, waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

test.describe('first load', () => {
  test('boots online, installs the pinned release and activates the service worker', async ({
    page,
    mirror,
  }) => {
    // Hold one file so the download banner is on screen long enough to see.
    mirror.setHold((_tag, path) => path === 'races.json');
    await page.goto('/');

    await expect(rosterHeading(page)).toBeVisible();
    await expect(page).toHaveTitle('Characters · Cast Guidance');
    const progress = page.getByRole('progressbar', { name: 'Downloading game data' });
    await expect(progress).toBeVisible();

    mirror.releaseHeld();
    await expect(progress).toBeHidden();
    await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    expect(await getSetting(page, 'dataTag')).toBe(PINNED_TAG);

    // A fresh install asks for the release list once and every file at least once.
    expect(mirror.tagListRequests).toBe(1);
    for (const path of MIRROR_PATHS) {
      expect(mirror.hits.get(`${PINNED_TAG}:${path}`) ?? 0, path).toBeGreaterThanOrEqual(1);
    }

    await expect.poll(async () => (await swState(page)).active?.state).toBe('activated');
    // Prompt mode, no clientsClaim: the first load is not controlled yet.
    expect((await swState(page)).controlled).toBe(false);
  });

  test('a cold online deep link renders through the vercel.json SPA fallback', async ({
    page,
    server,
  }) => {
    await page.goto('/library/race');
    await expect(page).toHaveTitle(/· Library · Cast Guidance$/);
    await expect(page.getByRole('main').getByText('Elf', { exact: true })).toBeVisible();
    expect(server.requests.find((r) => r.path === '/library/race')).toEqual({
      path: '/library/race',
      status: 200,
      rewrittenTo: '/index.html',
    });
  });

  test('a first visit away from the roster announces offline readiness once', async ({ page }) => {
    // No getting-started card here to carry the news, so the notice does. The
    // page is not controlled yet, so it promises the next launch, not this one.
    await page.removeLocatorHandler(offlineReadyNotice(page));
    await page.goto('/settings');
    await expect(offlineReadyNotice(page)).toContainText('Ready to use offline next time');
    await expect(offlineReadyNotice(page)).toBeHidden();

    expect(
      await page.evaluate(() => localStorage.getItem('cast-guidance:offline-ready-announced')),
    ).not.toBeNull();

    // A second launch, controlled this time, with every condition for the
    // notice met again: the worker in control and the data settled. Only then
    // does its absence mean it was not repeated.
    await waitForSwControl(page);
    await expectDataSettled(page);
    await expect(offlineReadyNotice(page)).toHaveCount(0);
  });

  test('the roster shows the getting-started card until it is dismissed', async ({ page }) => {
    await page.removeLocatorHandler(gettingStartedDismiss(page));
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Getting started' });
    await expect(card).toBeVisible();
    await gettingStartedDismiss(page).click();
    await expect(card).toBeHidden();

    await page.reload();
    // The card is drawn in the same render as this line, so once it shows,
    // the card's absence is settled.
    await expect(emptyRosterLine(page)).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test('an unknown deep link renders the not-found screen with a way back', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page).toHaveTitle('Page not found · Cast Guidance');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to characters' }).click();
    await expect(rosterHeading(page)).toBeVisible();
  });

  test('mirror routes still see requests from a page the service worker controls', async ({
    page,
    mirror,
  }) => {
    // The canary for the whole harness: if the worker ever starts answering
    // cross-origin fetches, context.route would stop seeing them and every
    // mirror assertion would pass vacuously.
    await page.goto('/');
    await waitForSwControl(page);
    await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    const before = mirror.totalHits();
    const status = await page.evaluate(async (tag) => {
      const res = await fetch(
        `https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@${tag}/data/races.json`,
      );
      return res.status;
    }, PINNED_TAG);
    expect(status).toBe(200);
    expect(mirror.totalHits()).toBe(before + 1);
  });
});
