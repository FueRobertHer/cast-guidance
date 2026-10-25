import type { Page } from '@playwright/test';
import { EXPORT_FORMAT, invalidImports, jsonFile } from '../fixtures/characterFile.ts';
import { MIRROR_PATHS, PINNED_TAG } from '../fixtures/mirror.ts';
import {
  answerImportPreview,
  characterLink,
  createBlankCharacter,
  deleteCharacter,
  exportCharacter,
  gotoRoster,
  importCharacterFile,
  renameCharacter,
} from '../support/app.ts';
import { countDataFiles, listCharacters } from '../support/idb.ts';
import { waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

const NAME = 'Brin Ashdown';

/** A roster with one renamed character; returns its id. */
async function rosterWithOneCharacter(page: Page): Promise<string> {
  await gotoRoster(page);
  const id = await createBlankCharacter(page);
  await gotoRoster(page);
  await renameCharacter(page, 'New hero', NAME);
  return id;
}

/** The status line under the roster that reports an import. */
const importStatus = (page: Page) => page.getByRole('main').getByText(/^Import(ed|\sfailed)/);

test.describe('import and export', () => {
  test('exports a character file and imports it back', async ({ page }) => {
    const id = await rosterWithOneCharacter(page);

    const { download, json } = await exportCharacter(page, NAME);
    expect(download.suggestedFilename()).toMatch(/^Brin_Ashdown.*\.json$/);
    expect(json.$format).toBe(EXPORT_FORMAT);
    const character = json.character as { id: string; name: string };
    expect(character.id).toBe(id);
    expect(character.name).toBe(NAME);
    expect(Array.isArray(json.homebrew)).toBe(true);

    await deleteCharacter(page, NAME);
    expect(await listCharacters(page)).toEqual([]);

    await importCharacterFile(page, jsonFile('brin.json', json));
    await answerImportPreview(page, `Import ${NAME}?`);
    await expect(importStatus(page)).toHaveText(`Imported ${NAME}`);
    await characterLink(page, NAME).click();
    await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  });

  test('importing a character that already exists adds a copy with a new id', async ({ page }) => {
    const id = await rosterWithOneCharacter(page);
    const { json } = await exportCharacter(page, NAME);

    await importCharacterFile(page, jsonFile('brin.json', json));
    await answerImportPreview(page, `Import ${NAME}?`);
    await expect(importStatus(page)).toHaveText(/^Imported .* as a copy/);
    await expect.poll(async () => (await listCharacters(page)).length).toBe(2);
    const ids = (await listCharacters(page)).map((c) => c.id);
    expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(2);
  });

  test('refuses files it cannot import and changes nothing', async ({ page }) => {
    await rosterWithOneCharacter(page);
    const { json } = await exportCharacter(page, NAME);
    const exported = json as unknown as Parameters<typeof invalidImports>[0];

    for (const { label, file, message } of invalidImports(exported)) {
      await importCharacterFile(page, file);
      await expect(importStatus(page), label).toHaveText(message);
      expect((await listCharacters(page)).length, label).toBe(1);
    }
  });

  test('export works offline', async ({ page, network }) => {
    await rosterWithOneCharacter(page);
    // Settle the data install first, so going offline cannot cut it short.
    await expect.poll(() => countDataFiles(page, PINNED_TAG)).toBe(MIRROR_PATHS.length);
    await waitForSwControl(page);

    await network.goOffline();
    await page.reload();
    const { json } = await exportCharacter(page, NAME);
    expect((json.character as { name: string }).name).toBe(NAME);
    network.assertNothingServedOffline();
  });
});
