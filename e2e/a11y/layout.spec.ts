import type { Locator, Page } from '@playwright/test';
import { manySpells } from '../fixtures/manySpells.ts';
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

/**
 * How far the page is wider than its viewport, in CSS px (0 when it is not),
 * and the innermost elements that stick out past its right edge, for the
 * failure message.
 */
function sidewaysOverflow(page: Page): Promise<{ by: number; culprits: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const out = [...document.body.querySelectorAll('*')].filter(
      (el) => el.getBoundingClientRect().right > root.clientWidth + 0.5,
    );
    const culprits = out
      .filter((el) => !out.some((o) => o !== el && el.contains(o)))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30) ?? ''}"`);
    return { by: Math.max(0, root.scrollWidth - root.clientWidth), culprits };
  });
}

/** Opens every fold (`<details>`), so what is collapsed by default is measured too. */
async function openFolds(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const fold of document.querySelectorAll('details')) fold.open = true;
  });
}

async function expectNoSidewaysScroll(page: Page, route: Route): Promise<void> {
  const { by, culprits } = await sidewaysOverflow(page);
  expect(by, `${route.name} scrolls sideways, past: ${culprits.join(', ')}`).toBe(0);
}

// In two tests each, so neither runs near the timeout under load.
const SHEET = ROUTES.filter((r) => r.name.startsWith('sheet '));
const PAGES = ROUTES.filter((r) => !SHEET.includes(r));
const GROUPS = [
  ['the main routes', PAGES],
  ['the sheet tabs', SHEET],
] as const;

/**
 * One font for the width checks, so every machine measures the same text.
 * The app asks for the system UI font, which a Linux runner without one
 * resolves to whatever sans serif it has: CI's DejaVu Sans is wider than
 * the fallback on some local machines, and a route that fit by a few px
 * locally scrolled sideways on CI. DejaVu Sans is installed on both, and is
 * the wider of the two, so it is the stricter check.
 */
const MEASURED_FONT = [
  'html { font-family: "DejaVu Sans" !important; }',
  // The few monospace runs (`font-mono`, and code by default) likewise.
  '.font-mono, code, kbd, samp, pre { font-family: "DejaVu Sans Mono" !important; }',
].join(' ');

/**
 * A missing font is silently replaced by the next one, so without this the
 * checks would quietly go back to measuring each machine's own fallback.
 * Each forced font must draw a string at a width its generic fallback does
 * not.
 */
async function expectMeasuredFontInstalled(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font: string) => {
      if (ctx === null) return 0;
      ctx.font = `40px ${font}`;
      return ctx.measureText('mmmmmmmmmmlllllliiiiWW').width;
    };
    return {
      sans: [width('"DejaVu Sans", monospace'), width('monospace')],
      mono: [width('"DejaVu Sans Mono", serif'), width('serif')],
    };
  });
  for (const [name, [forced, fallback]] of [
    ['DejaVu Sans', widths.sans],
    ['DejaVu Sans Mono', widths.mono],
  ] as const) {
    expect(
      forced,
      `${name} must be installed for the layout spec's width checks (fonts-dejavu-core on Debian and Ubuntu)`,
    ).not.toBe(fallback);
  }
}

/** Sets {@link MEASURED_FONT} on the page, once it is known to be there. */
async function applyMeasuredFont(page: Page, extra = ''): Promise<void> {
  await expectMeasuredFontInstalled(page);
  await page.addStyleTag({ content: `${extra} ${MEASURED_FONT}` });
}

test.describe('reflow at 320 CSS px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const [group, routes] of GROUPS) {
    test(`${group} do not scroll sideways, folds open`, async ({ page }) => {
      const id = await setUp(page);
      for (const route of routes) {
        await route.open(page, id);
        await applyMeasuredFont(page);
        await openFolds(page);
        await animationsSettled(page);
        await expectNoSidewaysScroll(page, route);
      }
    });
  }
});

test.describe('text at 200%', () => {
  for (const [group, routes] of GROUPS) {
    test(`${group} do not scroll sideways, folds open, and keep primary controls whole`, async ({
      page,
    }) => {
      const id = await setUp(page);
      for (const route of routes) {
        await route.open(page, id);
        // The browser's text-size setting, as a page sees it: a larger root
        // font, so everything sized in rem grows with it. In the one font
        // every machine measures with (see MEASURED_FONT).
        await applyMeasuredFont(page, 'html { font-size: 200% !important; }');
        await openFolds(page);
        await animationsSettled(page);
        await expectNoSidewaysScroll(page, route);
        for (const control of route.primary(page)) {
          await control.scrollIntoViewIfNeeded();
          await expect(control, `${route.name}: ${control}`).toBeInViewport({ ratio: 1 });
        }
      }
    });
  }
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
 * Fails if the walk took fewer than `minSteps` presses in all.
 */
async function hiddenWhileFocused(page: Page, region: Locator, minSteps = 1): Promise<string[]> {
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
  expect(steps, 'the walk moved through the region').toBeGreaterThanOrEqual(minSteps);
  return hidden;
}

/** Spells in the landscape walk of a long list, enough that most are not rendered at once. */
const LONG_LIST = 150;

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

  test('the roster and Settings: focus clears the app nav', async ({ page }) => {
    await setUp(page);
    for (const url of ['/', '/settings']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await animationsSettled(page);
      expect(await hiddenWhileFocused(page, page.getByRole('main')), url).toEqual([]);
    }
  });

  test('a long library list: focus clears the app nav, all the way down and back', async ({
    page,
    mirror,
  }) => {
    // About 310 presses, each with a check in the page.
    test.slow();
    // Rows the window has not reached yet are rendered as Tab arrives, and
    // drawn by transform: the html scroll padding must still keep the row
    // Tab scrolls to clear of the bottom nav.
    mirror.setBodies(() => manySpells(LONG_LIST));
    await setUp(page);
    await page.goto('/library/spell');
    const main = page.getByRole('main');
    await expect(main.getByText(String(LONG_LIST), { exact: true })).toBeVisible();
    await animationsSettled(page);
    // Every row down and every row back up, so the walk provably reached
    // the end of the list rather than stopping where the rendered rows did.
    expect(await hiddenWhileFocused(page, main, 2 * LONG_LIST)).toEqual([]);
  });
});
