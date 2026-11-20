/**
 * A collection's page and The books at phone width (ADR-002, U6; bug 11 of
 * the One Workshop canvas: the homebrew file row cut its name and status off
 * at 375 px). At 320 px, with text at 100% and at 200%, nothing on either page
 * is cut off (no ellipsis, no clipped line) and the page never scrolls
 * sideways.
 */
import type { Page } from '@playwright/test';
import { jsonFile } from '../fixtures/characterFile.ts';
import {
  animationsSettled,
  answerImportPreview,
  createBlankCharacter,
  gotoRosterSettled,
  importHomebrewFile,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { expect, test } from '../support/test.ts';

const LONG_NAME = 'a-very-long-homebrew-file-name-shared-by-a-friend.json';
const LONG_ENTRY = 'Lanternbearer of the Western Coast and Every Harbour Beyond';

const LONG_BREW = jsonFile(LONG_NAME, {
  _meta: { sources: [{ json: 'LONGBREW', full: 'Long Brew of the Lantern Coast' }] },
  feat: [{ name: LONG_ENTRY, source: 'LONGBREW', entries: ['Glow.'] }],
  spell: [{ name: 'Harbourlight', source: 'LONGBREW', level: 1, entries: ['Shine.'] }],
});

/**
 * A wide font on every machine, so the check measures what a wide font
 * wraps: DejaVu Sans on CI's Linux runner, Verdana (about as wide) elsewhere.
 */
const WIDE_FONT = 'html { font-family: "DejaVu Sans", Verdana, sans-serif !important; }';

/**
 * Text cut off in the main content: a run of text drawn past the edge of a
 * box that clips it (its own box with an ellipsis, or any box around it with
 * its overflow hidden, as a list's rounded frame is).
 */
function cutOff(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const clips = (el: Element) => {
      const style = getComputedStyle(el);
      return (
        ['hidden', 'clip'].includes(style.overflowX) ||
        ['hidden', 'clip'].includes(style.overflowY) ||
        style.textOverflow === 'ellipsis'
      );
    };
    const root = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if ((n.textContent ?? '').trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const text = range.getBoundingClientRect();
      if (text.width === 0 && text.height === 0) continue;
      for (let el = n.parentElement; el !== null && el !== document.body; el = el.parentElement) {
        const box = el.getBoundingClientRect();
        // Text for screen readers alone (`sr-only`) is clipped to nothing by design.
        if (box.width <= 1 && box.height <= 1) break;
        if (!clips(el)) continue;
        const past =
          text.left < box.left - 1 ||
          text.right > box.right + 1 ||
          text.top < box.top - 1 ||
          text.bottom > box.bottom + 1;
        if (past) {
          out.push(`"${(n.textContent ?? '').trim().slice(0, 40)}" in ${el.tagName.toLowerCase()}`);
          break;
        }
      }
    }
    return out;
  });
}

/** How far the page is wider than its viewport, and the innermost elements past its right edge. */
function sideways(page: Page): Promise<{ by: number; past: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const out = [...document.body.querySelectorAll('*')].filter(
      (el) => el.getBoundingClientRect().right > root.clientWidth + 0.5,
    );
    const past = out
      .filter((el) => !out.some((o) => o !== el && el.contains(o)))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30) ?? ''}"`);
    return { by: Math.max(0, root.scrollWidth - root.clientWidth), past };
  });
}

test.describe('the collection page at phone width', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('cuts nothing off and never scrolls sideways, at 100% and 200% text', async ({ page }) => {
    await skipOfflineReadyNotice(page);
    await gotoRosterSettled(page);
    // A character, so the page has a switch for it to fit too.
    await createBlankCharacter(page);
    await page.goto('/homebrew');
    await expect(page.getByRole('heading', { level: 1, name: 'Homebrew' })).toBeVisible();
    await importHomebrewFile(page, LONG_BREW);
    await answerImportPreview(page, `Import "${LONG_NAME}"?`);

    const pages = [
      {
        name: 'collection',
        open: async () => {
          await page.goto('/workshop?shelf=collections');
          await page.getByRole('link', { name: /^a-very-long-homebrew/ }).click();
          await expect(page.getByRole('heading', { level: 1, name: LONG_NAME })).toBeVisible();
          await expect(page.getByRole('list', { name: `In ${LONG_NAME}` })).toContainText(
            LONG_ENTRY,
          );
          await expect(page.getByRole('group', { name: 'For each character' })).toBeVisible();
          // Its address (the file's key) holds through a reload of the built app.
          await page.reload();
          await expect(page.getByRole('heading', { level: 1, name: LONG_NAME })).toBeVisible();
        },
      },
      {
        name: 'the books',
        open: async () => {
          await page.goto('/workshop/collection/books');
          await expect(page.getByRole('heading', { level: 1, name: 'The books' })).toBeVisible();
          const books = page.getByRole('region', { name: 'Which books show' });
          await expect(books.getByRole('checkbox').first()).toBeVisible();
          // Every group of books open, so each book's row is measured.
          await page.evaluate(() => {
            for (const fold of document.querySelectorAll('details')) fold.open = true;
          });
        },
      },
    ];
    for (const size of ['', 'html { font-size: 200% !important; }']) {
      for (const at of pages) {
        await at.open();
        await page.addStyleTag({ content: `${size} ${WIDE_FONT}` });
        await animationsSettled(page);
        const label = `${at.name}${size === '' ? '' : ' at 200%'}`;
        expect(await cutOff(page), `${label}: text cut off`).toEqual([]);
        const { by, past } = await sideways(page);
        expect(by, `${label}: scrolls sideways, past: ${past.join(', ')}`).toBe(0);
      }
    }
  });
});
