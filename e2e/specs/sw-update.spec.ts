import type { Page } from '@playwright/test';
import { MIRROR_PATHS, PINNED_TAG } from '../fixtures/mirror.ts';
import { E2E_BUILD_META } from '../server/swVariants.ts';
import { gotoRoster, rosterHeading } from '../support/app.ts';
import { countDataFiles } from '../support/idb.ts';
import {
  isRememberedWorkerActive,
  rememberActiveWorker,
  swState,
  triggerSwUpdate,
  waitForSwControl,
} from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

// Each test deploys a new build on a server of its own (see swVariants.ts).
test.use({ privateServer: true });

const updateToast = (page: Page) => page.getByText('A new version of the app is ready.');

/** Which build served the page's shell: `v1` (dist as built) or `v2`. */
function shellBuild(page: Page): Promise<string> {
  return page.evaluate(
    (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? 'v1',
    E2E_BUILD_META,
  );
}

/**
 * First visit, controlled by the v1 worker, with the data install settled so
 * it cannot overlap the update. Remembers that worker (see
 * `isRememberedWorkerActive`).
 */
async function controlledByV1(page: Page): Promise<void> {
  await gotoRoster(page);
  await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
  await waitForSwControl(page);
  expect(await shellBuild(page)).toBe('v1');
  await rememberActiveWorker(page);
}

/** Clicks Update and waits for the reload the new worker's takeover triggers. */
async function applyUpdate(page: Page): Promise<void> {
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Update' }).click();
  await reloaded;
  await expect(rosterHeading(page)).toBeVisible();
}

test.describe('service worker updates', () => {
  test('apply: Update takes the new version, and it then works offline', async ({
    page,
    server,
    network,
  }) => {
    await controlledByV1(page);

    server.setVariant('v2');
    expect((await triggerSwUpdate(page)).state).toBe('installed');
    await expect(updateToast(page)).toBeVisible();

    await applyUpdate(page);
    expect(await shellBuild(page)).toBe('v2');
    await expect(updateToast(page)).toBeHidden();
    const state = await swState(page);
    expect(state.waiting).toBeNull();
    expect(state.controlled).toBe(true);

    await network.goOffline();
    await page.reload();
    await expect(rosterHeading(page)).toBeVisible();
    expect(await shellBuild(page)).toBe('v2');
    network.assertNothingServedOffline();
  });

  test('defer: Later keeps the old version until the update is applied', async ({
    page,
    server,
  }) => {
    await controlledByV1(page);

    server.setVariant('v2');
    expect((await triggerSwUpdate(page)).state).toBe('installed');
    await expect(updateToast(page)).toBeVisible();
    await page.getByRole('button', { name: 'Later' }).click();
    await expect(updateToast(page)).toBeHidden();

    // The old worker still controls the page, so a reload serves the old
    // shell from the old precache; the new worker is still waiting, so the
    // prompt comes back.
    await page.reload();
    await expect(rosterHeading(page)).toBeVisible();
    expect(await shellBuild(page)).toBe('v1');
    expect((await swState(page)).waiting).not.toBeNull();
    await expect(updateToast(page)).toBeVisible();

    await applyUpdate(page);
    expect(await shellBuild(page)).toBe('v2');
    expect((await swState(page)).waiting).toBeNull();
  });

  test('broken: a build that fails to install changes nothing, and a later good one applies', async ({
    page,
    server,
    network,
  }) => {
    await controlledByV1(page);

    // One precache entry 404s, so the new worker's install fails.
    server.setVariant('v2-broken');
    const update = await triggerSwUpdate(page);
    expect(update.state).toBe('redundant');
    expect(server.requests).toContainEqual({ path: '/assets/e2e-missing.js', status: 404 });
    expect(await isRememberedWorkerActive(page)).toBe(true);
    const state = await swState(page);
    expect(state.waiting).toBeNull();
    expect(state.installing).toBeNull();
    // The prompt is raised 200 ms after a new worker reaches `installed`
    // (workbox-window's 'waiting'). This one never did, so the absence below
    // is settled, not early.
    expect(update.states).not.toContain('installed');
    await expect(updateToast(page)).toBeHidden();

    // The old version keeps working, offline included.
    await network.goOffline();
    await page.reload();
    await expect(rosterHeading(page)).toBeVisible();
    expect(await shellBuild(page)).toBe('v1');
    network.assertNothingServedOffline();
    await network.goOnline();

    // Recovery: the next good deploy installs and applies normally.
    server.setVariant('v2');
    expect((await triggerSwUpdate(page)).state).toBe('installed');
    await expect(updateToast(page)).toBeVisible();
    await applyUpdate(page);
    expect(await shellBuild(page)).toBe('v2');
  });
});
