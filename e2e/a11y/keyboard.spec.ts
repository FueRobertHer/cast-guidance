import { devices, type Locator, type Page } from '@playwright/test';
import { VALID_BODIES } from '../../tests-fixtures/dataMirror.ts';
import { jsonFile } from '../fixtures/characterFile.ts';
import {
  animationsSettled,
  characterLink,
  createBlankCharacter,
  exportCharacter,
  gotoRoster,
  gotoRosterSettled,
  gotoSheetTab,
  importPreview,
  renameCharacter,
  SHEET_TABS,
  type SheetTab,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { expect, test } from '../support/test.ts';

/**
 * Keyboard operation (A11Y-003), the automated half of the manual keyboard
 * and focus checks in docs/a11y-audit.md. Every dialog and drawer is opened
 * from its trigger with Enter, and must take focus, keep Tab and Shift+Tab
 * inside (each pressed two more times than it has controls, visiting every
 * one), close on Escape and hand focus back to the trigger. The roster, the
 * library and the sheet's tabs are driven by Tab and Enter alone, and the
 * library's virtualized list is tabbed through end to end.
 *
 * At a desktop size, where a keyboard is most likely: no touch, and the app
 * nav and the sheet's tabs in a side rail. `defaultBrowserType` is dropped
 * because a describe cannot switch browsers; it is Chromium anyway.
 */
const { defaultBrowserType: _, ...desktop } = devices['Desktop Chrome'];
test.use(desktop);

const NAME = 'Brin Ashdown';

/** What is focused, for failure messages. */
function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'nothing';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
    return `${el.tagName.toLowerCase()} "${name}"`;
  });
}

function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement);
}

/**
 * Presses Tab from where focus is until `target` has it, as a keyboard user
 * looking for a control would, and fails if it is not reached in `max` presses
 * or Tab runs off the end of the page first. So consecutive calls also check
 * that their targets come in that order.
 */
async function tabTo(page: Page, target: Locator, max = 120): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) return;
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement === document.body)) {
      throw new Error(`Tab ran off the end of the page before reaching ${target}`);
    }
  }
  expect(await isFocused(target), `Tab reached ${target} in ${max} presses`).toBe(true);
}

/**
 * Moves focus to the top of the page, as a fresh load leaves it. A plain
 * blur is not enough: the browser would carry on tabbing from where the
 * blurred element was.
 */
async function focusPageStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const body = document.body;
    body.tabIndex = -1;
    body.focus();
    body.removeAttribute('tabindex');
  });
}

/**
 * Where focus is relative to `dialog`: the index of the focused element among
 * the dialog's drawn tabbable elements, -1 for the dialog itself, or null when
 * focus is outside it. Also returns how many tabbable elements there are.
 */
function focusIn(dialog: Locator): Promise<{ at: number | null; count: number }> {
  return dialog.evaluate((root) => {
    const list = [
      ...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
    ].filter(
      (el) =>
        el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
    const active = document.activeElement;
    const at =
      active === null || !root.contains(active) ? null : list.indexOf(active as HTMLElement);
    return { at, count: list.length };
  });
}

/**
 * Focus is inside `dialog`, and Tab and Shift+Tab, each pressed two more
 * times than it has tabbable elements, keep it there and visit every one.
 */
async function expectTrapped(page: Page, dialog: Locator): Promise<void> {
  await expect
    .poll(async () => (await focusIn(dialog)).at, { message: 'focus moved into the dialog' })
    .not.toBeNull();
  const { count } = await focusIn(dialog);
  for (const key of ['Tab', 'Shift+Tab']) {
    const seen = new Set<number>();
    for (let i = 0; i < count + 2; i++) {
      await page.keyboard.press(key);
      const { at } = await focusIn(dialog);
      if (at === null) {
        throw new Error(`${key} x${i + 1} left the dialog for ${await describeFocus(page)}`);
      }
      if (at !== null && at >= 0) seen.add(at);
    }
    expect(seen.size, `${key} visits every control in the dialog`).toBe(count);
  }
}

/** Escape closes `dialog`, and focus lands back on `opener`. */
async function escapeReturnsTo(page: Page, dialog: Locator, opener: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => isFocused(opener), { message: `focus back on ${opener}` }).toBe(true);
}

/**
 * Opens `dialog` by pressing Enter on `opener`, checks the trap, closes it
 * with Escape and checks focus came back. `opener` is focused directly: how
 * Tab reaches it is the page tests' business.
 */
async function checkDialog(page: Page, opener: Locator, dialog: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await animationsSettled(page);
  await expectTrapped(page, dialog);
  await escapeReturnsTo(page, dialog, opener);
}

/** One homebrew collection holding one spell, as a file to import. */
const HOMEBREW = jsonFile('key-brew.json', {
  _meta: {
    sources: [{ json: 'KEY', abbreviation: 'KEY', full: 'Keyboard Brew', version: '1.0.0' }],
  },
  spell: [{ name: 'Key Bolt', source: 'KEY', level: 1, school: 'V' }],
});

test.describe('keyboard: dialogs and drawers', () => {
  test.beforeEach(async ({ page }) => {
    await skipOfflineReadyNotice(page);
  });

  test('the roster: actions, rename, delete and the import preview', async ({ page }) => {
    await gotoRosterSettled(page);
    await createBlankCharacter(page);
    await gotoRoster(page);
    await renameCharacter(page, 'New hero', NAME);

    const opener = page.getByRole('button', { name: `Actions for ${NAME}` });
    const actions = page.getByRole('dialog', { name: NAME });
    await checkDialog(page, opener, actions);

    // Rename and Delete open from the actions sheet as it closes, and focus
    // goes back to the row's Actions button, where the chain started.
    for (const [choice, title] of [
      ['Rename', 'Rename hero'],
      ['Delete', `Delete ${NAME}?`],
    ] as const) {
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(actions).toBeVisible();
      await tabTo(page, actions.getByRole('button', { name: choice }), 10);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      await animationsSettled(page);
      await expectTrapped(page, dialog);
      await escapeReturnsTo(page, dialog, opener);
    }

    // A character file's preview (IMP-002), opened from the import button.
    const { json } = await exportCharacter(page, NAME);
    await expect(actions).toBeHidden();
    const importButton = page.getByRole('button', { name: 'Import from a file' });
    await importButton.focus();
    const choosing = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await choosing).setFiles(jsonFile('brin.json', json));
    const preview = importPreview(page, `Import ${NAME}?`);
    await expect(preview).toBeVisible();
    await animationsSettled(page);
    await expectTrapped(page, preview);
    await escapeReturnsTo(page, preview, importButton);
  });

  test('the sheet: dice tray, history, long rest and the info sheets', async ({ page }) => {
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);

    await gotoSheetTab(page, id, 'Play');
    await checkDialog(
      page,
      page.getByRole('button', { name: 'Dice tray' }),
      page.getByRole('dialog', { name: 'Dice' }),
    );
    await checkDialog(
      page,
      page.getByRole('button', { name: 'Character history' }),
      page.getByRole('dialog', { name: 'History' }),
    );
    await checkDialog(
      page,
      page.getByRole('button', { name: 'Long rest' }),
      page.getByRole('dialog', { name: 'Long rest' }),
    );

    await gotoSheetTab(page, id, 'Stats');
    await checkDialog(
      page,
      page.getByRole('button', { name: /^STR score \d+.*: breakdown$/ }),
      page.getByRole('dialog', { name: 'STR score' }),
    );

    // Deferred until first used (SheetStandIn): the press mounts the sheet
    // with a new trigger, which is where focus must come back to.
    await gotoSheetTab(page, id, 'Build');
    await checkDialog(
      page,
      page.getByRole('button', { name: 'Fighter details' }),
      page.getByRole('dialog', { name: 'Fighter' }),
    );
  });

  test('homebrew: the import preview', async ({ page }) => {
    await gotoRosterSettled(page);
    await page.goto('/homebrew');
    const importButton = page.getByRole('button', { name: 'Import file', exact: true });
    await importButton.focus();
    const choosing = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await choosing).setFiles(HOMEBREW);
    const preview = importPreview(page, 'Import "key-brew.json"?');
    await expect(preview).toBeVisible();
    await animationsSettled(page);
    await expectTrapped(page, preview);
    await escapeReturnsTo(page, preview, importButton);
  });
});

test.describe('keyboard: pages', () => {
  test.beforeEach(async ({ page }) => {
    await skipOfflineReadyNotice(page);
  });

  test('the roster: Tab reaches its actions, and Enter uses them', async ({ page }) => {
    await gotoRosterSettled(page);
    await focusPageStart(page);
    await tabTo(page, page.getByRole('button', { name: 'New character from a blank sheet' }));
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/c\/[^/]+\/build$/);

    await gotoRoster(page);
    await focusPageStart(page);
    // In reading order: the character, its actions, then the ways to add one.
    await tabTo(page, characterLink(page, 'New hero'));
    await tabTo(page, page.getByRole('button', { name: 'Actions for New hero' }));
    await tabTo(page, page.getByRole('button', { name: 'New character from a blank sheet' }));
    await tabTo(page, page.getByRole('link', { name: 'New character with the guided wizard' }));
    await tabTo(page, page.getByRole('button', { name: 'Import from a file' }));

    await focusPageStart(page);
    await tabTo(page, characterLink(page, 'New hero'));
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/c\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'New hero' })).toBeVisible();
  });

  test('the library: search, a type list and a detail page', async ({ page }) => {
    await gotoRosterSettled(page);
    await page.goto('/library');
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await focusPageStart(page);
    await tabTo(page, page.getByLabel('Search everything'));
    await page.keyboard.type('fire');
    const hit = page.getByRole('main').getByRole('link', { name: /Fireball/ });
    await expect(hit).toBeVisible();
    await tabTo(page, hit, 10);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();

    await page.goto('/library');
    await focusPageStart(page);
    await tabTo(page, page.getByRole('link', { name: /^Spells/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Spells' })).toBeVisible();
    await tabTo(page, page.getByLabel('Filter spells'));
    await tabTo(page, page.getByRole('main').getByRole('link', { name: /Fireball/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();
  });

  test('the sheet: every tab, in order, by Tab and Enter', async ({ page }) => {
    await gotoRosterSettled(page);
    const id = await createBlankCharacter(page);
    await gotoSheetTab(page, id, 'Play');
    const bar = page.getByRole('navigation', { name: 'Character sheet' });
    const labels = Object.keys(SHEET_TABS) as SheetTab[];

    await focusPageStart(page);
    await tabTo(page, bar.getByRole('link', { name: labels[0], exact: true }));
    for (const label of labels.slice(1)) {
      // The next tab is the very next stop, and Enter opens it.
      await page.keyboard.press('Tab');
      const tab = bar.getByRole('link', { name: label, exact: true });
      if (!(await isFocused(tab))) {
        throw new Error(`Tab moved to ${await describeFocus(page)}, not the ${label} tab`);
      }
      await page.keyboard.press('Enter');
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveURL(new RegExp(`/c/${id}${SHEET_TABS[label]}$`));
    }
  });
});

/** Spells enough that, virtualized, most rows would not be rendered at once. */
const MANY = 150;

function manySpells(): Readonly<Record<string, unknown>> {
  const spell = Array.from({ length: MANY }, (_, i) => ({
    name: `Spell ${String(i + 1).padStart(3, '0')}`,
    source: 'PHB',
    level: i % 10,
  }));
  return { ...VALID_BODIES, 'spells/spells-phb.json': { spell } };
}

test.describe('keyboard: the virtualized list', () => {
  test('Tab walks a long list end to end, each row rendered and in view', async ({
    page,
    mirror,
  }) => {
    // VirtualList is meant to render only the rows near the scroll position
    // (with an overscan of 10), so a row Tab is about to reach may not exist
    // yet. Each press must land on the next row, drawn and on screen: inside
    // the list's own box and the window's. Today the list is not height
    // bounded and draws every row (a finding in docs/a11y-audit.md), which
    // this check does not depend on. The list has no arrow-key navigation,
    // also recorded there.
    mirror.setBodies(manySpells);
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    await page.goto('/library/spell');
    const main = page.getByRole('main');
    await expect(main.getByText(String(MANY), { exact: true })).toBeVisible();
    const rows = main.locator('a[href^="/library/spell/"]');

    await tabTo(page, rows.first());
    for (let i = 1; i <= MANY; i++) {
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const list = el.closest('.overflow-y-auto');
        const row = el.getBoundingClientRect();
        const box = list?.getBoundingClientRect() ?? row;
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, window.innerHeight);
        return {
          name: `${el.tagName.toLowerCase()} "${el.textContent ?? ''}"`,
          inList: list !== null,
          inView: row.top >= top - 1 && row.bottom <= bottom + 1,
        };
      });
      const want = `Spell ${String(i).padStart(3, '0')}`;
      expect(state.inList, `row ${want} has focus, not ${state.name}`).toBe(true);
      expect(state.name.startsWith(`a "${want}`), `row ${want} has focus, not ${state.name}`).toBe(
        true,
      );
      expect(state.inView, `${want} is scrolled into view`).toBe(true);
      if (i < MANY) await page.keyboard.press('Tab');
    }

    // And back up a screenful and more with Shift+Tab.
    for (let i = MANY - 1; i >= MANY - 30; i--) {
      await page.keyboard.press('Shift+Tab');
      const name = await page.evaluate(() => document.activeElement?.textContent ?? '');
      expect(name.startsWith(`Spell ${String(i).padStart(3, '0')}`), `Shift+Tab to row ${i}`).toBe(
        true,
      );
    }
  });
});
