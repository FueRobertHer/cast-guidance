import type { Page } from '@playwright/test';
import { jsonFile } from '../fixtures/characterFile.ts';
import { MIRROR_PATHS, PINNED_TAG } from '../fixtures/mirror.ts';
import {
  answerImportPreview,
  createBlankCharacter,
  expectDataSettled,
  exportCharacter,
  gotoRoster,
  importCharacterFile,
  importHomebrewFile,
  importPreview,
  renameCharacter,
} from '../support/app.ts';
import { countDataFiles, countHomebrewFiles, listCharacters } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * IMP-002: an import shows what it would do before anything is written, and
 * Import or Cancel decide. Against the real build, the real data install
 * (the mirror's one official spell is Fireball|PHB) and real IndexedDB.
 */

/** A homebrew file that redefines an official spell and needs a source nobody has. */
const BREW = {
  _meta: {
    sources: [{ json: 'E2EB', full: 'E2E Brews' }],
    dependencies: { spell: ['NOPE'] },
  },
  spell: [
    { name: 'Zap', source: 'E2EB', level: 1 },
    { name: 'Fireball', source: 'PHB', level: 9 },
  ],
};

const homebrewStatus = (page: Page) => page.getByRole('main').getByRole('status');

test.describe('import preview', () => {
  test('a homebrew file is previewed, then Cancel writes nothing and Import stores it', async ({
    page,
  }) => {
    // Every pack in first, so the preview checks against all official data,
    // then on to Homebrew in the same page load, where the download queue
    // has already said it is done.
    await page.goto('/');
    await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    await expectDataSettled(page);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Homebrew' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Homebrew' })).toBeVisible();

    await importHomebrewFile(page, jsonFile('brew.json', BREW));
    const preview = importPreview(page, 'Import "brew.json"?');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('2 spell');
    await expect(preview).toContainText('E2E Brews (E2EB)');
    await expect(preview.getByRole('heading', { name: 'Depends on' })).toBeVisible();
    await expect(preview).toContainText(
      'NOPE is not on this device. Entries that need it may be incomplete until you import it.',
    );
    await expect(preview.getByRole('heading', { name: 'Clashes' })).toBeVisible();
    await expect(preview).toContainText(
      'Fireball (PHB) is also official content. Official wins, so a character that picks it gets the official version.',
    );
    expect(await countHomebrewFiles(page)).toBe(0);

    await answerImportPreview(page, 'Import "brew.json"?', 'Cancel');
    await expect(homebrewStatus(page)).toHaveText('Import canceled. Nothing was added.');
    expect(await countHomebrewFiles(page)).toBe(0);
    // Focus is back where the import started.
    await expect(page.getByRole('button', { name: 'Import file', exact: true })).toBeFocused();

    await importHomebrewFile(page, jsonFile('brew.json', BREW));
    await answerImportPreview(page, 'Import "brew.json"?');
    await expect(homebrewStatus(page)).toHaveText('Imported "brew.json" (2 spell)');
    await expect.poll(() => countHomebrewFiles(page)).toBe(1);
    await expect(page.getByRole('button', { name: 'Enable brew.json' })).toBeVisible();

    // The same file again is already here: the preview offers to keep it.
    await importHomebrewFile(page, jsonFile('brew-again.json', BREW));
    const again = importPreview(page, '"brew-again.json" is already here');
    await expect(again).toContainText('Already imported on');
    await expect(again.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
    await again.getByRole('button', { name: 'Keep the existing file' }).click();
    await expect(again).toBeHidden();
    await expect(homebrewStatus(page)).toHaveText(
      'Kept the existing "brew.json". Nothing was added.',
    );
    expect(await countHomebrewFiles(page)).toBe(1);
  });

  test('a character file is previewed, and a second import lands as a copy', async ({ page }) => {
    await gotoRoster(page);
    await createBlankCharacter(page);
    await gotoRoster(page);
    await renameCharacter(page, 'New hero', 'Ivo Penn');
    const { json } = await exportCharacter(page, 'Ivo Penn');

    await importCharacterFile(page, jsonFile('ivo.json', json));
    const preview = importPreview(page, 'Import Ivo Penn?');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('ClassNo class yet');
    await expect(preview.getByRole('heading', { name: 'Imports as a copy' })).toBeVisible();
    await expect(preview).toContainText(
      'A character with the same id is already on this device, so this one is added as a copy with its own id.',
    );
    expect(await listCharacters(page)).toHaveLength(1);

    await answerImportPreview(page, 'Import Ivo Penn?');
    await expect(page.getByRole('main').getByText(/^Imported Ivo Penn/)).toHaveText(
      'Imported Ivo Penn as a copy, since a character with the same id was already here',
    );
    await expect.poll(async () => (await listCharacters(page)).length).toBe(2);
    await expect(page.getByRole('button', { name: 'Actions for Ivo Penn' })).toHaveCount(2);
  });
});
