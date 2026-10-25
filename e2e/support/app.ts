import { readFile } from 'node:fs/promises';
import { type Download, expect, type Locator, type Page } from '@playwright/test';
import type { FilePayload } from '../fixtures/characterFile.ts';

/**
 * UI flows shared by the specs. Locators are roles and accessible names only,
 * kept here so a copy change touches one file.
 */

/**
 * The roster's getting-started card (#116) is not an overlay, but it sits
 * above the roster and pushes it down. Registered as a locator handler, it is
 * hidden whenever it is on screen before an action, so specs work with or
 * without it and never race its asynchronous first render.
 */
export async function dismissGettingStartedWhenShown(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Got it, hide this' }),
    async (button) => {
      await button.click();
    },
  );
}

/** Opens the roster and waits for it. */
export async function gotoRoster(page: Page): Promise<void> {
  await page.goto('/');
  await expect(rosterHeading(page)).toBeVisible();
}

export function rosterHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 1, name: 'Characters' });
}

/** The link a roster row opens its character with. */
export function characterLink(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .getByRole('link', { name: new RegExp(`^${escapeRegExp(name)}\\b`) });
}

/** Creates a character from a blank sheet on the roster and returns its id. */
export async function createBlankCharacter(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New character from a blank sheet' }).click();
  await page.waitForURL(/\/c\/[^/]+\/build$/);
  const id = /\/c\/([^/]+)\/build$/.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error(`No character id in ${page.url()}`);
  return id;
}

/** Opens a roster row's actions sheet and returns it. */
export async function openCharacterActions(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function renameCharacter(page: Page, from: string, to: string): Promise<void> {
  const actions = await openCharacterActions(page, from);
  await actions.getByRole('button', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename hero' });
  await dialog.getByRole('textbox', { name: 'Rename hero' }).fill(to);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: `Actions for ${to}` })).toBeVisible();
}

export async function deleteCharacter(page: Page, name: string): Promise<void> {
  const actions = await openCharacterActions(page, name);
  await actions.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: `Delete ${name}?` });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: `Actions for ${name}` })).toHaveCount(0);
}

/** Exports a character from the roster and returns the download and its parsed JSON. */
export async function exportCharacter(
  page: Page,
  name: string,
): Promise<{ download: Download; json: Record<string, unknown> }> {
  const actions = await openCharacterActions(page, name);
  const downloading = page.waitForEvent('download');
  await actions.getByRole('button', { name: /^Export/ }).click();
  const download = await downloading;
  const file = await download.path();
  const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  return { download, json };
}

/** Imports a file through the roster's "Import from a file" button. */
export async function importCharacterFile(page: Page, file: FilePayload | string): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import from a file' }).click();
  const chooser = await choosing;
  await chooser.setFiles(file);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
