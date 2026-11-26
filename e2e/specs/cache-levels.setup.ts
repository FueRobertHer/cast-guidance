import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { casterFile } from '../fixtures/caster.ts';
import { jsonFile } from '../fixtures/characterFile.ts';
import { PINNED_TAG } from '../fixtures/mirror.ts';
import {
  answerImportPreview,
  createBlankCharacter,
  gotoRoster,
  importCharacterFile,
  importHomebrewFile,
  settingsValue,
} from '../support/app.ts';
import {
  CACHE_LEVELS,
  CASTER_NAME,
  type CacheLevel,
  filesAt,
  HOMEBREW_NAME,
  HOMEBREW_TITLE,
  leftOut,
  publishLevel,
} from '../support/cacheLevels.ts';
import { expect, test } from '../support/coldLaunch.ts';
import { countDataFiles, getCharacter, getHomebrewFiles } from '../support/idb.ts';
import { levelsDir } from '../support/stableOrigin.ts';
import { waitForSwControl } from '../support/sw.ts';

/**
 * Builds one persistent profile per cache level at the stable origin, for the
 * offline route matrix to copy (`offline-routes.spec.ts`). Each holds a
 * blank character, a caster who knows Fireball, an imported homebrew file,
 * the level's game data, and an installed service worker, and is closed
 * before it is published.
 */

/** The caster's id: imported, so it is the file's to choose. */
const CASTER_ID = 'e2e-matrix-caster';

/**
 * Imports the caster (fixtures/caster.ts), built on the stored blank
 * character, knowing Fireball: its Play tab lists the spell whatever the
 * level, and its Spells tab reads the spell files.
 */
async function importCaster(page: Page, blankId: string): Promise<string> {
  const blank = await getCharacter(page, blankId);
  if (blank === undefined) throw new Error('The blank character was not stored');
  const { file, previewTitle } = casterFile(blank, CASTER_ID, CASTER_NAME, {
    known: [{ name: 'Fireball', source: 'PHB' }],
  });
  await gotoRoster(page);
  await importCharacterFile(page, file);
  await answerImportPreview(page, previewTitle);
  // The preview closes before the import is written, and the next step
  // navigates away, which can drop a write still in flight: the level then
  // had no caster ("Character not found" in the full cache's spell cells).
  await expect.poll(async () => (await getCharacter(page, CASTER_ID)) !== undefined).toBe(true);
  return CASTER_ID;
}

/** The table's homebrew file: one spell under a source of its own. */
const HOMEBREW = jsonFile(HOMEBREW_NAME, {
  _meta: {
    sources: [{ json: 'TBR', abbreviation: 'TBR', full: HOMEBREW_TITLE, version: '1.0.0' }],
  },
  spell: [
    {
      name: 'Table Spark',
      source: 'TBR',
      level: 0,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { type: 'feet', amount: 30 } },
      components: { v: true },
      duration: [{ type: 'instant' }],
      entries: ['A spark of light.'],
    },
  ],
});

/**
 * Imports the table's homebrew file through the Workshop's Import sheet and
 * returns its stored row's id, the id an old Builder link and a collection
 * link from before keys name. Imported, not made: the editor needs the game
 * data, which the `none` level never has, and an import's preview does not.
 */
async function importHomebrew(page: Page): Promise<string> {
  await importHomebrewFile(page, HOMEBREW);
  await answerImportPreview(page, `Import "${HOMEBREW_NAME}"?`);
  await expect(
    page.getByRole('main').getByRole('link', { name: new RegExp(`^${HOMEBREW_TITLE}\\s*,`) }),
  ).toBeVisible();
  const rows = (await getHomebrewFiles(page)).filter((r) => r.fileName === HOMEBREW_NAME);
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Expected one stored "${HOMEBREW_NAME}", found ${rows.length}`);
  }
  return row.id;
}

/** Waits for the download queue to stop where the level stops it. */
async function expectLevelSettled(page: Page, level: CacheLevel): Promise<void> {
  await page.goto('/settings');
  await expect(settingsValue(page, 'Download')).toHaveText(
    level === 'full' ? 'Complete' : 'Failed',
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
    const casterId = await importCaster(page, characterId);
    const homebrewId = await importHomebrew(page);
    await expectLevelSettled(page, level);
    await waitForSwControl(page);
    await context.close();

    publishLevel(dir, { level, characterId, casterId, homebrewId });
  });
}
