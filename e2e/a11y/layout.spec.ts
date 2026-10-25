import type { Locator, Page } from '@playwright/test';
import {
  animationsSettled,
  characterLink,
  createBlankCharacter,
  gotoRosterSettled,
  gotoSheetTab,
  SHEET_TABS,
  type SheetTab,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { expect, test } from '../support/test.ts';

/**
 * Layout under the conditions WCAG asks a page to survive (A11Y-003), the
 * automated half of the zoom, text size and landscape checks in
 * docs/a11y-audit.md:
 * - reflow (1.4.10): at 320 by 640 CSS px no main route scrolls sideways;
 * - resize text (1.4.4): with the root font at 200%, the same, and each
 *   route's primary controls still whole on screen once scrolled to;
 * - landscape on a phone (851 by 393): the sheet's sticky header and bottom
 *   tab bar leave its heading and content in sight, and a control that Tab or
 *   Shift+Tab moves to is never entirely hidden behind either (2.4.11).
 * Reduced motion has its own spec (`reduced-motion.spec.ts`).
 */

interface Route {
  name: string;
  /** Opens the route and waits for its main heading. */
  open: (page: Page, id: string) => Promise<void>;
  /** The controls the page exists for, which must stay reachable. */
  primary: (page: Page) => Locator[];
}

async function gotoHeading(page: Page, url: string, heading: string | RegExp): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Character sheet' });

const sheetTab = (tab: SheetTab): Route => ({
  name: `sheet ${tab}`,
  open: (page, id) => gotoSheetTab(page, id, tab),
  primary: (page) => [
    tabBar(page).getByRole('link', { name: tab, exact: true }),
    page.getByRole('link', { name: 'Back to characters' }),
    ...(tab === 'Play'
      ? [
          page.getByRole('button', { name: 'Dice tray' }),
          page.getByRole('button', { name: 'Long rest' }),
        ]
      : []),
  ],
});

const ROUTES: Route[] = [
  {
    name: 'roster',
    open: (page) => gotoHeading(page, '/', 'Characters'),
    primary: (page) => [
      characterLink(page, 'New hero'),
      page.getByRole('button', { name: 'Actions for New hero' }),
      page.getByRole('button', { name: 'New character from a blank sheet' }),
      page.getByRole('button', { name: 'Import from a file' }),
    ],
  },
  {
    name: 'library',
    open: (page) => gotoHeading(page, '/library', 'Library'),
    primary: (page) => [
      page.getByLabel('Search everything'),
      page.getByRole('link', { name: /^Spells/ }),
    ],
  },
  {
    name: 'library list',
    open: async (page) => {
      await gotoHeading(page, '/library/spell', 'Spells');
      await expect(page.getByRole('main').getByRole('link', { name: /Fireball/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByLabel('Filter spells'),
      page.getByRole('main').getByRole('link', { name: /Fireball/ }),
    ],
  },
  {
    name: 'library detail',
    open: async (page) => {
      await gotoHeading(page, '/library/spell', 'Spells');
      await page
        .getByRole('main')
        .getByRole('link', { name: /Fireball/ })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: 'Fireball' })).toBeVisible();
    },
    primary: (page) => [page.getByRole('button', { name: 'Back' })],
  },
  {
    name: 'homebrew',
    open: (page) => gotoHeading(page, '/homebrew', 'Homebrew'),
    primary: (page) => [
      page.getByRole('button', { name: 'Import file', exact: true }),
      page.getByRole('button', { name: 'Create your own homebrew' }),
    ],
  },
  {
    name: 'settings',
    open: (page) => gotoHeading(page, '/settings', 'Settings'),
    primary: (page) => [page.getByRole('button', { name: 'Check for data updates' })],
  },
  {
    name: 'creator',
    open: (page) => gotoHeading(page, '/create', /.+/),
    primary: (page) => [page.getByRole('button', { name: /^Next/ })],
  },
  {
    name: 'not found',
    open: (page) => gotoHeading(page, '/no-such-page', 'Page not found'),
    primary: () => [],
  },
  ...(Object.keys(SHEET_TABS) as SheetTab[]).map(sheetTab),
];

/** A character to open the sheet with, on a settled install. Returns its id. */
async function setUp(page: Page): Promise<string> {
  await skipOfflineReadyNotice(page);
  await gotoRosterSettled(page);
  return createBlankCharacter(page);
}

/** How far the page is wider than its viewport, in CSS px (0 when it is not). */
function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

test.describe('reflow at 320 CSS px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('no main route scrolls sideways', async ({ page }) => {
    const id = await setUp(page);
    for (const route of ROUTES) {
      await route.open(page, id);
      await animationsSettled(page);
      expect(await sidewaysOverflow(page), `${route.name} scrolls sideways`).toBe(0);
    }
  });
});

test.describe('text at 200%', () => {
  test('no route scrolls sideways, and its primary controls stay whole', async ({ page }) => {
    const id = await setUp(page);
    for (const route of ROUTES) {
      await route.open(page, id);
      // The browser's text-size setting, as a page sees it: a larger root
      // font, so everything sized in rem grows with it.
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await animationsSettled(page);
      expect(await sidewaysOverflow(page), `${route.name} scrolls sideways`).toBe(0);
      for (const control of route.primary(page)) {
        await control.scrollIntoViewIfNeeded();
        await expect(control, `${route.name}: ${control}`).toBeInViewport({ ratio: 1 });
      }
    }
  });
});

/** Where `locator` is drawn; fails if it is not. */
async function box(locator: Locator): Promise<DOMRectLike> {
  const b = await locator.boundingBox();
  if (b === null) throw new Error(`${locator} is not drawn`);
  return b;
}

/** Two boxes overlap by more than a hairline. */
function overlaps(a: DOMRectLike, b: DOMRectLike): boolean {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}
interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tabs forward through every control in `region`, then back with Shift+Tab,
 * and returns each one that had focus while no part of it could be seen:
 * every point sampled across its box hits something else (a fixed bar).
 */
async function hiddenWhileFocused(page: Page, region: Locator): Promise<string[]> {
  const controls = region.locator(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea',
  );
  // A blank character's Spells tab has nothing to focus.
  if ((await controls.count()) === 0) return [];
  await controls.first().focus();
  const hidden: string[] = [];
  const check = () =>
    region.evaluate((root) => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || !root.contains(el)) return { inside: false, hidden: '' };
      const b = el.getBoundingClientRect();
      for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.1, 0.5, 0.9]) {
          const hit = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
          if (hit !== null && el.contains(hit)) return { inside: true, hidden: '' };
        }
      }
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
      return { inside: true, hidden: `${el.tagName.toLowerCase()} "${name}"` };
    });
  let steps = 0;
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 400; i++) {
      const at = await check();
      if (!at.inside) break;
      if (at.hidden !== '') hidden.push(`${key}: ${at.hidden}`);
      await page.keyboard.press(key);
      steps++;
    }
    if (key === 'Tab') await page.keyboard.press('Shift+Tab');
  }
  expect(steps, 'the walk moved through the region').toBeGreaterThan(0);
  return hidden;
}

test.describe('landscape on a phone', () => {
  test.use({ viewport: { width: 851, height: 393 } });

  for (const tab of Object.keys(SHEET_TABS) as SheetTab[]) {
    test(`sheet ${tab}: the header and tab bar leave the page in sight`, async ({ page }) => {
      const id = await setUp(page);
      await gotoSheetTab(page, id, tab);
      await animationsSettled(page);

      const header = page.getByRole('banner');
      const heading = page.getByRole('heading', { level: 1 });
      const main = page.getByRole('main');
      const h = await box(header);
      const nav = await box(tabBar(page));
      const h1 = await box(heading);
      // The name is whole on screen and clear of the tab bar, and the page's
      // own content starts below the header with room above the tab bar.
      await expect(heading).toBeInViewport({ ratio: 1 });
      expect(overlaps(h1, nav), 'the tab bar covers the heading').toBe(false);
      const content = await main.evaluate((el) => {
        const first = [...el.querySelectorAll('*')].find((c) => c.getClientRects().length > 0);
        return first?.getBoundingClientRect().top ?? el.getBoundingClientRect().top;
      });
      expect(content, 'the content starts below the header').toBeGreaterThanOrEqual(
        h.y + h.height - 1,
      );
      expect(nav.y - (h.y + h.height), 'room for content between the bars').toBeGreaterThan(
        393 / 2,
      );

      expect(await hiddenWhileFocused(page, main)).toEqual([]);
    });
  }

  test('the roster, a library list and Settings: focus clears the app nav', async ({ page }) => {
    await setUp(page);
    for (const url of ['/', '/library/spell', '/settings']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await animationsSettled(page);
      expect(await hiddenWhileFocused(page, page.getByRole('main')), url).toEqual([]);
    }
  });
});
