import { readFile } from 'node:fs/promises';
import { type Download, expect, type Locator, type Page } from '@playwright/test';
import type { FilePayload } from '../fixtures/characterFile.ts';

/**
 * UI flows shared by the specs. Locators are roles and accessible names only,
 * kept here so a copy change touches one file.
 */

/** The getting-started card's dismiss button, on the roster until it is used. */
export function gettingStartedDismiss(page: Page): Locator {
  return page.getByRole('button', { name: 'Got it, hide this' });
}

/**
 * The one-time "Ready to use offline" notice: a toast near the bottom of the
 * screen that hides itself after a few seconds.
 */
export function offlineReadyNotice(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: 'Ready to use offline' });
}

/**
 * Keeps the app's unbidden UI out of the specs' way. Playwright runs a locator
 * handler whenever its locator is visible before an action or an assertion,
 * so neither depends on when these first render:
 * - the roster's getting-started card is dismissed (the dismissal persists in
 *   that profile, as it would for a person);
 * - the "Ready to use offline" notice is waited out (Playwright waits for it
 *   to hide after the empty handler), since it can cover controls near the
 *   bottom of the screen.
 * A spec that asserts on either removes its handler first.
 */
export async function handleOverlays(page: Page): Promise<void> {
  await page.addLocatorHandler(gettingStartedDismiss(page), async (button) => {
    await button.click();
  });
  await page.addLocatorHandler(offlineReadyNotice(page), async () => undefined);
}

/** A value in Settings' storage and data list, by its label. */
export function settingsValue(page: Page, label: string): Locator {
  return page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');
}

/**
 * Opens Settings and waits until the data layer has settled: the download
 * queue is done and every file is cached. A check that something did not
 * happen (no download, no notice) is only meaningful after this.
 */
export async function expectDataSettled(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(settingsValue(page, 'Download queue')).toHaveText('done');
  await expect(settingsValue(page, 'Offline compendium')).toHaveText('ready ✓');
}

/** The empty roster's line, drawn in the same render as the getting-started card. */
export function emptyRosterLine(page: Page): Locator {
  return page.getByRole('main').getByText(/^No characters yet/);
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
