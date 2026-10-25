import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { PINNED_TAG } from '../fixtures/mirror.ts';
import { createBlankCharacter, gotoRoster, settingsValue } from '../support/app.ts';
import {
  CACHE_LEVELS,
  type CacheLevel,
  filesAt,
  HOMEBREW_NAME,
  leftOut,
  publishLevel,
} from '../support/cacheLevels.ts';
import { expect, test } from '../support/coldLaunch.ts';
import { countDataFiles } from '../support/idb.ts';
import { levelsDir } from '../support/stableOrigin.ts';
import { waitForSwControl } from '../support/sw.ts';

/**
 * Builds one persistent profile per cache level at the stable origin, for the
 * offline route matrix to copy (`offline-routes.spec.ts`). Each holds a
 * character and an editable homebrew file, the level's game data, and an
 * installed service worker, and is closed before it is published.
 */

/** Creates an editable homebrew collection and returns its id. */
async function createHomebrew(page: Page): Promise<string> {
  await page.goto('/homebrew');
  await page.getByRole('button', { name: 'Create your own homebrew' }).click();
  const name = page.getByRole('dialog', { name: 'Homebrew collection name' });
  await name.getByRole('textbox').fill(HOMEBREW_NAME);
  await name.getByRole('button', { name: 'OK' }).click();
  const abbrev = page.getByRole('dialog', { name: 'Short source id (shown on badges)' });
  await abbrev.getByRole('button', { name: 'OK' }).click();
  await page.waitForURL(/\/homebrew\/edit\/[^/]+$/);
  const id = /\/homebrew\/edit\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error(`No homebrew id in ${page.url()}`);
  return id;
}

/** Waits for the download queue to stop where the level stops it. */
async function expectLevelSettled(page: Page, level: CacheLevel): Promise<void> {
  await page.goto('/settings');
  await expect(settingsValue(page, 'Download queue')).toHaveText(
    level === 'full' ? 'done' : 'error',
  );
  await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(filesAt(level));
}

for (const level of CACHE_LEVELS) {
  test(`build the ${level} cache level`, async ({ launchStable, mirror }) => {
    mirror.setFail((_tag, path) => (leftOut(level, path) ? 'abort' : undefined));
    const dir = levelsDir(`.building-${level}-${randomUUID()}`);
    const { context, page } = await launchStable(dir);

    await gotoRoster(page);
    const characterId = await createBlankCharacter(page);
    const homebrewId = await createHomebrew(page);
    await expectLevelSettled(page, level);
    await waitForSwControl(page);
    await context.close();

    publishLevel(dir, { level, characterId, homebrewId });
  });
}
