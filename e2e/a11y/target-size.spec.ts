import type { Locator, Page } from '@playwright/test';
import { casterFile } from '../fixtures/caster.ts';
import {
  animationsSettled,
  answerImportPreview,
  createBlankCharacter,
  gotoRoster,
  gotoRosterSettled,
  gotoSheetTab,
  importCharacterFile,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { getCharacter } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * Touch target sizes, measured (A11Y-002, #113). The unit guard
 * (`src/features/sheet/tabs/targetSize.test.tsx`) only checks that the sheet's
 * small controls carry a sizing class; this measures the boxes the browser
 * lays out, on the project's phone:
 *
 * - the inventoried controls (HP, exhaustion and pool steppers, death saves,
 *   Build's and the creator's steppers, the back links, Homebrew's row
 *   actions) are at least 44 by 44, and pips at least 32 wide by 44 tall (an
 *   owner decision, recorded in docs/a11y-audit.md);
 * - every other visible control is at least 24 by 24 (WCAG 2.5.8), except
 *   a roll chip in a sentence, which 2.5.8 exempts.
 *
 * The box measured is the element's own, as axe's `target-size` rule measures
 * it: a padded hit area drawn by a pseudo-element would not count.
 */

/** Inventoried controls. */
const LARGE = { width: 44, height: 44 };
/** Pips: full height, narrower so a 12-use row still fits two lines at 320px. */
const PIP = { width: 32, height: 44 };
/** WCAG 2.5.8's floor. */
const FLOOR = { width: 24, height: 24 };

/** Sub-pixel layout: a 44px box can measure 43.99. */
const EPSILON = 0.01;

interface Box {
  name: string;
  width: number;
  height: number;
}

function tooSmall(boxes: Box[], min: { width: number; height: number }): Box[] {
  return boxes.filter((b) => b.width < min.width - EPSILON || b.height < min.height - EPSILON);
}

/** Each element's accessible name (near enough) and its box. */
function boxesOf(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ');
      return { name: name.trim(), width: r.width, height: r.height };
    }),
  );
}

/**
 * Every inventoried control `locator` matches is at least `min`, and there are
 * `count` of them, so a renamed control cannot drop out of the check unseen.
 */
async function expectTargets(
  locator: Locator,
  count: number,
  min: { width: number; height: number } = LARGE,
): Promise<void> {
  await expect(locator).toHaveCount(count);
  const boxes = await boxesOf(locator);
  expect(tooSmall(boxes, min), `under ${min.width} by ${min.height}`).toEqual([]);
}

/**
 * Every visible control on the page (buttons, links, `summary` and
 * `role="button"`) is at least 24 by 24. Skipped: what is not shown (no box,
 * `sr-only`'s 1px clip, hidden, or inside a closed <details>). The one
 * exemption is a roll chip marked `data-inline-target` (`RollChip`'s `inline`)
 * with words of a sentence beside it: WCAG 2.5.8 exempts a target in a
 * sentence. A marked chip with no sentence around it fails, so the mark
 * cannot hide a stray control.
 */
async function expectFloor(page: Page): Promise<void> {
  const { boxes, unexplained } = await page.evaluate(() => {
    const boxes: Array<{ name: string; width: number; height: number }> = [];
    const unexplained: string[] = [];
    const controls = 'button, a[href], summary, [role="button"]';
    for (const el of document.querySelectorAll<HTMLElement>(controls)) {
      const r = el.getBoundingClientRect();
      // `checkVisibility` also rules out the inside of a closed <details>,
      // which Chromium still lays out (hidden by `content-visibility`).
      if (r.width <= 1 || r.height <= 1 || !el.checkVisibility({ visibilityProperty: true })) {
        continue;
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ');
      if (el.hasAttribute('data-inline-target')) {
        const parent = el.parentElement;
        const inSentence =
          parent !== null &&
          [...parent.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
          );
        if (!inSentence) unexplained.push(name.trim());
        continue;
      }
      boxes.push({ name: name.trim(), width: r.width, height: r.height });
    }
    return { boxes, unexplained };
  });
  // A page of controls, so an empty query cannot pass for a clean one.
  expect(boxes.length).toBeGreaterThan(5);
  expect(unexplained, 'inline targets with no sentence around them').toEqual([]);
  expect(tooSmall(boxes, FLOOR), 'controls under 24 by 24').toEqual([]);
}

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

test.describe('touch target sizes', () => {
  test.beforeEach(async ({ page }) => {
    await skipOfflineReadyNotice(page);
  });

  test("a caster's Play tab, its death saves, and Build", async ({ page }) => {
    await gotoRosterSettled(page);
    // The caster is a stored blank character with classes from homebrew
    // (see fixtures/caster.ts), imported under an id of its own.
    const blankId = await createBlankCharacter(page);
    const blank = await getCharacter(page, blankId);
    if (blank === undefined) throw new Error('The blank character was not stored');
    const id = 'e2e-caster';
    const { file, previewTitle } = casterFile(blank, id, 'Vela Quill');
    await gotoRoster(page);
    await importCharacterFile(page, file);
    await answerImportPreview(page, previewTitle);

    await gotoSheetTab(page, id, 'Play');
    await expect(button(page, 'Level 1 slot 1')).toBeVisible();
    await animationsSettled(page);
    await expectTargets(page.getByRole('link', { name: 'Back to characters', exact: true }), 1);
    await expectTargets(button(page, /^(Damage|Heal) [15] hit points?$/), 4);
    await expectTargets(button(page, /^(Decrease|Increase) exhaustion$/), 2);
    await expectTargets(button(page, /^(Spend|Restore) [15] Sorcery Points$/), 4);
    // 15 caster levels: 4, 3, 3, 3, 2, 1, 1 and 1 slots.
    await expectTargets(button(page, /^Level \d slot \d$/), 18, PIP);
    await expectTargets(button(page, /^Channel Divinity use \d$/), 1, PIP);
    await expectFloor(page);

    // At 0 HP the death saves appear under the HP card.
    await page
      .getByRole('button', { name: /hit points$/ })
      .filter({ hasText: '/' })
      .click();
    const setHp = page.getByRole('dialog', { name: 'Set current HP' });
    await setHp.getByRole('textbox').fill('0');
    await setHp.getByRole('button', { name: 'OK' }).click();
    await expect(setHp).toBeHidden();
    await animationsSettled(page);
    await expectTargets(button(page, /^Death save (success|fail) [123]$/), 6);
    await expectFloor(page);

    await gotoSheetTab(page, id, 'Build');
    // Every section open, and every picker in them, so all of Build is measured.
    // Opening one can reveal more, so this goes on until none is left (or
    // gives up, and the check below fails).
    const closed = page.getByRole('main').locator('details:not([open]) > summary');
    for (let i = 0; i < 50 && (await closed.count()) > 0; i++) await closed.first().click();
    await expect(closed).toHaveCount(0);
    await animationsSettled(page);
    await expectTargets(button(page, /^Remove a (Sorcerer|Cleric) level$/), 2);
    await expectTargets(button(page, /^(Decrease|Increase) [A-Z]{3}$/), 12);
    await expectFloor(page);
  });

  test('Homebrew with one file', async ({ page }) => {
    await gotoRosterSettled(page);
    // A collection of your own, so the row has every action, Edit included.
    await page.goto('/homebrew');
    await page.getByRole('button', { name: 'Create your own homebrew' }).click();
    const named = page.getByRole('dialog', { name: 'Homebrew collection name' });
    await named.getByRole('textbox').fill('Target Table');
    await named.getByRole('button', { name: 'OK' }).click();
    const abbrev = page.getByRole('dialog', { name: 'Short source id (shown on badges)' });
    await abbrev.getByRole('button', { name: 'OK' }).click();
    await page.waitForURL(/\/homebrew\/edit\/[^/]+$/);

    await page.goto('/homebrew');
    const toggle = page.getByRole('button', { name: /^Enable / });
    await expect(toggle).toHaveCount(1);
    const fileName = (await toggle.getAttribute('aria-label'))?.slice('Enable '.length) ?? '';
    await animationsSettled(page);
    await expectTargets(toggle, 1);
    await expectTargets(page.getByRole('link', { name: `Edit ${fileName} in the builder` }), 1);
    await expectTargets(button(page, `Download ${fileName}`), 1);
    await expectTargets(button(page, `Delete ${fileName}`), 1);
    await expectFloor(page);
  });

  test("the creator's abilities step, on point buy", async ({ page }) => {
    await gotoRosterSettled(page);
    await page.goto('/create?step=abilities');
    await expect(page.getByRole('heading', { level: 1, name: 'Abilities' })).toBeVisible();
    await button(page, 'Point buy').click();
    await expect(button(page, 'Point buy')).toHaveAttribute('aria-pressed', 'true');
    await animationsSettled(page);
    await expectTargets(
      page.getByRole('link', { name: 'Back to characters (your draft is kept)' }),
      1,
    );
    await expectTargets(button(page, /^(Decrease|Increase) [A-Z]{3}$/), 12);
    await expectFloor(page);
  });
});
