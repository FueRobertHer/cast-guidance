import type { Locator, Page } from '@playwright/test';
import { CONDITIONS } from '../../src/features/sheet/conditionEffects.ts';
import { casterFile } from '../fixtures/caster.ts';
import { jsonFile } from '../fixtures/characterFile.ts';
import { manySpells } from '../fixtures/manySpells.ts';
import {
  animationsSettled,
  answerImportPreview,
  characterLink,
  createBlankCharacter,
  editLink,
  gettingStartedCard,
  gettingStartedDismiss,
  gotoRoster,
  gotoRosterSettled,
  gotoSheetTab,
  importButton,
  importCharacterFile,
  importHomebrewFile,
  keepGettingStarted,
  newCharacterButton,
  SHEET_PAGES,
  type SheetPage,
  sheetMenuButton,
  skipOfflineReadyNotice,
} from '../support/app.ts';
import { getCharacter } from '../support/idb.ts';
import { expect, test } from '../support/test.ts';

/**
 * Layout under the conditions WCAG asks a page to survive (A11Y-003), the
 * automated half of the zoom, text size and landscape checks in
 * docs/a11y-audit.md:
 * - reflow (1.4.10): at 320 by 640 CSS px no main route scrolls sideways;
 * - resize text (1.4.4): with the root font at 200%, the same, and each
 *   route's primary controls still whole on screen once scrolled to;
 * - landscape on a phone (851 by 393): the sheet header (not sticky at this
 *   height: it scrolls away) and the bottom tab bar leave its heading and
 *   content in sight, and a control that Tab or Shift+Tab moves to is never
 *   entirely hidden behind either (2.4.11).
 * Reduced motion has its own spec (`reduced-motion.spec.ts`).
 */

interface Route {
  name: string;
  /** Opens the route and waits for its main heading, or the sheet it opens. */
  open: (page: Page, id: string) => Promise<void>;
  /** The controls the page exists for, which must stay reachable. */
  primary: (page: Page) => Locator[];
  /**
   * Text that shares a row with controls and must keep room to be read at a
   * large text size: at least a quarter of the screen's width. A row that
   * only truncates can squeeze it to nothing and still scroll nowhere.
   */
  keepsRoom?: (page: Page) => Locator[];
  /**
   * A fixed panel the route opens (a sheet), whose content must stay inside
   * it: a fixed panel never widens the page, so the sideways check cannot
   * see past its edge.
   */
  panel?: (page: Page) => Locator;
}

async function gotoHeading(page: Page, url: string, heading: string | RegExp): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Character sheet' });

/** The Workshop home's shelves, each a button in its Shelf group. */
const WORKSHOP_SHELVES = ['Yours', 'Collections', 'Rules'] as const;
const shelfButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Shelf' }).getByRole('button', { name, exact: true });

const sheetTab = (tab: SheetPage): Route => ({
  name: `sheet ${tab}`,
  open: (page, id) => gotoSheetTab(page, id, tab),
  primary: (page) => [
    // Build is not in the tab bar: the header's Edit is its way in.
    ...(tab === 'Build' ? [] : [tabBar(page).getByRole('link', { name: tab, exact: true })]),
    page.getByRole('link', { name: 'Back to characters' }),
    editLink(page),
    sheetMenuButton(page),
    ...(tab === 'Play'
      ? [
          page.getByRole('button', { name: 'Dice tray' }),
          page.getByRole('button', { name: 'Long rest', exact: true }),
          // The effect strip's end, in the header's own row.
          stripEnd(page),
        ]
      : []),
  ],
  // The character's name, beside Back, Edit and the menu in the header.
  keepsRoom: (page) => [page.getByRole('heading', { level: 1 })],
});

const ROUTES: Route[] = [
  {
    name: 'roster',
    open: (page) => gotoHeading(page, '/', 'Characters'),
    primary: (page) => [
      characterLink(page, 'New hero'),
      page.getByRole('button', { name: 'Actions for New hero' }),
      newCharacterButton(page),
      importButton(page),
    ],
    // The name, beside the actions button laid over its card.
    keepsRoom: (page) => [characterLink(page, 'New hero').getByText('New hero', { exact: true })],
  },
  {
    name: 'roster checklist',
    open: async (page) => {
      await keepGettingStarted(page);
      await gotoHeading(page, '/', 'Characters');
      await expect(gettingStartedCard(page)).toBeVisible();
    },
    primary: (page) => [
      gettingStartedDismiss(page),
      gettingStartedCard(page).getByRole('link', { name: 'Storage details' }),
    ],
    keepsRoom: (page) => [gettingStartedCard(page).getByRole('heading', { name: 'Works offline' })],
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
    name: 'workshop import',
    // The sheet is modal, so the page's heading under it is hidden from
    // role queries: the sheet itself says the route is open.
    open: async (page) => {
      await page.goto('/workshop?shelf=collections&import=');
      await expect(page.getByRole('dialog', { name: 'Import', exact: true })).toBeVisible();
    },
    primary: (page) => {
      const sheet = page.getByRole('dialog', { name: 'Import', exact: true });
      return [
        ...['A file', 'A link', 'Text'].map((name) =>
          sheet.getByRole('group', { name: 'Bring in' }).getByRole('button', { name, exact: true }),
        ),
        sheet.getByRole('button', { name: 'Choose a file', exact: true }),
        sheet.getByRole('button', { name: 'Read it', exact: true }),
      ];
    },
    panel: (page) => page.getByRole('dialog', { name: 'Import', exact: true }),
  },
  {
    name: 'workshop',
    open: async (page) => {
      await gotoHeading(page, '/workshop', 'Workshop');
      await expect(page.getByRole('heading', { level: 2, name: 'Make it yours' })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('link', { name: 'Make your own', exact: true }),
      page.getByRole('searchbox', { name: /^Search your content/ }),
      ...WORKSHOP_SHELVES.map((name) => shelfButton(page, name)),
      page.getByRole('link', { name: 'Import a file or a link', exact: true }),
    ],
  },
  {
    name: 'workshop collections',
    open: async (page) => {
      await gotoHeading(page, '/workshop?shelf=collections', 'Workshop');
      await expect(page.getByRole('link', { name: /^The books\s*,/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('link', { name: 'Import a file or a link', exact: true }),
      page.getByRole('link', { name: /^The books\s*,/ }),
    ],
  },
  {
    name: 'workshop rules',
    open: async (page) => {
      await gotoHeading(page, '/workshop?shelf=rules', 'Workshop');
      await expect(page.getByRole('link', { name: /^Critical hits/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('link', { name: /^Critical hits/ }),
      page.getByRole('link', { name: /^Guidance and Bardic Inspiration/ }),
    ],
  },
  {
    name: 'workshop rules page',
    open: (page) => gotoHeading(page, '/workshop/rules', 'Rules'),
    primary: (page) => [
      page.getByRole('button', { name: /^Critical hits/ }),
      page.getByRole('button', { name: 'Write a rule pack', exact: true }),
    ],
  },
  {
    name: 'workshop make your own',
    open: (page) => gotoHeading(page, '/workshop/new', 'Make your own'),
    primary: (page) => [page.getByRole('link', { name: 'Optional features', exact: true })],
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
  ...(Object.keys(SHEET_PAGES) as SheetPage[]).map(sheetTab),
  {
    ...sheetTab('Spells'),
    name: 'sheet Spells, Choose',
    open: async (page, id) => {
      await gotoSheetTab(page, id, 'Spells');
      await page.getByRole('button', { name: 'Choose spells' }).click();
      await expect(
        page.getByRole('textbox', { name: /^Search .* spell list$/ }).first(),
      ).toBeVisible();
    },
  },
];

/** A character to open the sheet with, on a settled install. Returns its id. */
async function setUp(page: Page): Promise<string> {
  await skipOfflineReadyNotice(page);
  await gotoRosterSettled(page);
  return createBlankCharacter(page);
}

/**
 * A played character to open the sheet with: the caster (fixtures/caster.ts),
 * filled out with a long spell and its rolls, a prepared tag, a versatile
 * weapon and a choice to make. A blank character's tabs fit where a played
 * one's rows ran off the screen. Returns its id.
 */
async function setUpFilled(page: Page): Promise<string> {
  const blank = await getCharacter(page, await setUp(page));
  if (blank === undefined) throw new Error('The blank character was not stored');
  const id = 'layout-caster';
  const { file, previewTitle } = casterFile(blank, id, 'Vela Quill', { filled: true });
  await gotoRoster(page);
  await importCharacterFile(page, file);
  await answerImportPreview(page, previewTitle);
  return id;
}

/**
 * The effect strip's end: "Add an effect", or how many chips are out of sight
 * while some are.
 */
const stripEnd = (page: Page) =>
  page.getByRole('button', { name: /^(Add an effect|Effects, \d+ more not shown)$/ });

/**
 * Turns on `names` (and `exhaustion` levels of exhaustion) from the picker
 * behind Play's add chip, so the condition strip is drawn on every tab.
 */
async function addConditions(page: Page, id: string, names: string[], exhaustion = 0) {
  await gotoSheetTab(page, id, 'Play');
  await stripEnd(page).click();
  const picker = page.getByRole('dialog', { name: 'Effects' });
  await expect(picker).toBeVisible();
  for (const name of names) {
    const toggle = picker.getByRole('button', { name, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  for (let i = 0; i < exhaustion; i++) {
    await picker.getByRole('button', { name: 'Increase exhaustion' }).click();
  }
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
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
  const panel = route.panel?.(page);
  if (panel !== undefined) {
    expect(await pastRightEdge(panel), `${route.name}: past its panel`).toEqual([]);
  }
}

// In two tests each, so neither runs near the timeout under load.
const SHEET = ROUTES.filter((r) => r.name.startsWith('sheet '));
const PAGES = ROUTES.filter((r) => !SHEET.includes(r));
const GROUPS = [
  ['the main routes', PAGES, setUp],
  ['the sheet tabs', SHEET, setUpFilled],
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

  for (const [group, routes, open] of GROUPS) {
    test(`${group} do not scroll sideways, folds open`, async ({ page }) => {
      const id = await open(page);
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
  for (const [group, routes, open] of GROUPS) {
    test(`${group} do not scroll sideways, folds open, and keep primary controls whole`, async ({
      page,
    }) => {
      const id = await open(page);
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
        const viewport = page.viewportSize();
        if (viewport === null) throw new Error('No viewport');
        for (const text of route.keepsRoom?.(page) ?? []) {
          const { width } = await box(text);
          expect(width, `${route.name}: ${text} keeps room to be read`).toBeGreaterThanOrEqual(
            viewport.width / 4,
          );
        }
      }
    });
  }
});

/**
 * The sheets the routes open, on the smallest screen with text at 200% as
 * well: the reflow check runs at this size with plain text, and the text check
 * on a taller phone, so neither puts this much text in this little height. A
 * sheet is pinned to the bottom of the screen, so one that grows taller than
 * the screen runs off the top, where nothing scrolls to it. Its top must stay
 * on screen, and each primary control must scroll into view inside it.
 */
test.describe('sheets at 320 by 640 with text at 200%', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const [group, routes, open] of GROUPS) {
    const sheets = routes.filter((r) => r.panel !== undefined);
    if (sheets.length === 0) continue;
    test(`those ${group} open stay on screen and keep primary controls in reach`, async ({
      page,
    }) => {
      const id = await open(page);
      for (const route of sheets) {
        await route.open(page, id);
        await applyMeasuredFont(page, 'html { font-size: 200% !important; }');
        await animationsSettled(page);
        await expectNoSidewaysScroll(page, route);
        const panel = route.panel?.(page);
        if (panel === undefined) throw new Error(`${route.name} has no panel`);
        expect((await box(panel)).y, `${route.name}: the sheet's top`).toBeGreaterThanOrEqual(0);
        for (const control of route.primary(page)) {
          await control.scrollIntoViewIfNeeded();
          await expect(control, `${route.name}: ${control}`).toBeInViewport({ ratio: 1 });
        }
      }
    });
  }
});

/** A feat whose name runs long, to measure the room a Yours row leaves it. */
const LONG_FEAT = 'Gift of the Unending Lantern-Lit Harbour Night';

/** A collection goes by its book's title, so the title is the long name to fit. */
const LONG_BREW_TITLE = 'A Very Long Homebrew Book Shared by a Friend of the Table';

/** A collection with a long file name and title, as one shared from a friend might have. */
const LONG_BREW = jsonFile('a-very-long-homebrew-file-name-shared-by-a-friend.json', {
  _meta: { sources: [{ json: 'LONGBREW', full: LONG_BREW_TITLE }] },
  feat: [{ name: 'Lanternbearer of the Western Coast', source: 'LONGBREW', entries: ['Glow.'] }],
});

/**
 * The Workshop with something in each shelf: two feats of the player's (a
 * long name among them) and an imported file with a long name, so every row,
 * chip and card has words to fit.
 */
async function setUpWorkshop(page: Page): Promise<void> {
  await skipOfflineReadyNotice(page);
  await gotoRosterSettled(page);
  for (const name of ['Fire Gift', LONG_FEAT]) {
    await page.goto('/workshop/new/feat');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/workshop\/edit\/feat\//);
  }
  await page.goto('/workshop/new/spell');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Fire Spark');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/workshop\/edit\/spell\//);
  await importHomebrewFile(page, LONG_BREW);
  await answerImportPreview(page, `Import "${LONG_BREW.name}"?`);
}

/** The Workshop's states with content, each opened from the home. */
const WORKSHOP: readonly Route[] = [
  {
    name: 'workshop yours',
    open: async (page) => {
      await gotoHeading(page, '/workshop', 'Workshop');
      await expect(page.getByRole('link', { name: /^Gift of the Unending/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('link', { name: 'Make your own', exact: true }),
      ...WORKSHOP_SHELVES.map((name) => shelfButton(page, name)),
      page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Spells, 1' }),
      page.getByRole('link', { name: /^Gift of the Unending/ }),
    ],
    // The name itself, not its row: the row is always as wide as the list.
    keepsRoom: (page) => [
      page
        .getByRole('link', { name: /^Gift of the Unending/ })
        .getByText(LONG_FEAT, { exact: true }),
    ],
  },
  {
    name: 'workshop collections',
    open: async (page) => {
      await gotoHeading(page, '/workshop?shelf=collections', 'Workshop');
      await expect(page.getByRole('link', { name: /^A Very Long Homebrew/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('link', { name: 'Import a file or a link', exact: true }),
      page.getByRole('link', { name: /^The books\s*,/ }),
    ],
    // With text at 200% the long name's card is taller than the screen, so it
    // cannot be whole in view; what matters is that the name itself keeps room.
    keepsRoom: (page) => [
      page
        .getByRole('link', { name: /^A Very Long Homebrew/ })
        .getByText(LONG_BREW_TITLE, { exact: true }),
    ],
  },
  {
    name: 'workshop collection',
    open: async (page) => {
      await gotoHeading(page, '/workshop?shelf=collections', 'Workshop');
      await page.getByRole('link', { name: /^A Very Long Homebrew/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: LONG_BREW_TITLE })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('button', { name: 'Back', exact: true }),
      page.getByRole('button', { name: `Use ${LONG_BREW_TITLE}`, exact: true }),
      page.getByRole('button', { name: 'Export a file', exact: true }),
      page.getByRole('button', { name: 'Delete this collection', exact: true }),
    ],
  },
  {
    name: 'workshop search',
    open: async (page) => {
      await gotoHeading(page, '/workshop', 'Workshop');
      await page.getByRole('searchbox', { name: /^Search your content/ }).fill('fire');
      await expect(page.getByRole('region', { name: 'In the books' })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('region', { name: 'Yours' }).getByRole('link', { name: /^Fire Gift/ }),
      page.getByRole('region', { name: 'In the books' }).getByRole('link', { name: /^Fireball/ }),
    ],
  },
  {
    // The longest of the Workshop's sheets: with text at 200% here it ran
    // hundreds of px off the top of the screen, its choices out of reach.
    name: 'workshop move',
    open: async (page) => {
      await gotoHeading(page, '/workshop', 'Workshop');
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      await page.getByRole('checkbox', { name: /^Fire Gift\s*,/ }).check();
      await page.getByRole('button', { name: 'Move', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Move 1 entry', exact: true })).toBeVisible();
    },
    primary: (page) => {
      const sheet = page.getByRole('dialog', { name: 'Move 1 entry', exact: true });
      return [
        sheet.getByRole('radio').first(),
        sheet.getByRole('button', { name: 'Cancel', exact: true }),
        sheet.getByRole('button', { name: /^(Move here|Make and move)$/ }),
      ];
    },
    panel: (page) => page.getByRole('dialog', { name: 'Move 1 entry', exact: true }),
  },
];

test.describe('the Workshop with content, in both themes', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  // One test per theme, so neither runs near the timeout under load: each is
  // a setup and ten route states, where both themes in one came to 20.
  for (const theme of ['dark', 'light']) {
    test(`in the ${theme} theme, does not scroll sideways at 320 px, and keeps its controls whole with text at 200%`, async ({
      page,
    }) => {
      await setUpWorkshop(page);
      for (const extra of ['', 'html { font-size: 200% !important; }']) {
        for (const route of WORKSHOP) {
          await route.open(page, '');
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await applyMeasuredFont(page, extra);
          await animationsSettled(page);
          const at = { ...route, name: `${route.name} (${theme}${extra === '' ? '' : ', 200%'})` };
          await expectNoSidewaysScroll(page, at);
          for (const control of route.primary(page)) {
            await control.scrollIntoViewIfNeeded();
            await expect(control, `${at.name}: ${control}`).toBeInViewport({ ratio: 1 });
          }
          for (const text of route.keepsRoom?.(page) ?? []) {
            const { width } = await box(text);
            expect(width, `${at.name}: ${text} keeps room to be read`).toBeGreaterThanOrEqual(80);
          }
        }
      }
    });
  }
});

/**
 * The Workshop's editors, each filled in as far as a card, so a card's boxes
 * and toggles have to fit beside the editor's own fields.
 */
const EDITORS: readonly Route[] = [
  {
    name: 'workshop feat editor',
    open: async (page) => {
      await page.goto('/workshop/new/feat');
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(LONG_FEAT);
      await page.getByRole('button', { name: 'Speed', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: LONG_FEAT, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Remove .* to your Speed$/ })).toBeVisible();
      // Try it on works the change out after the card is drawn: its row is
      // part of what has to fit.
      await expect(page.getByText('was 30 ft.', { exact: true })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('button', { name: 'Back', exact: true }),
      page.getByRole('textbox', { name: 'Name', exact: true }),
      page.getByRole('button', { name: 'Add a benefit', exact: true }),
      page.getByRole('button', { name: /^Remove .* to your Speed$/ }),
      page.getByLabel('Speed: Amount', { exact: true }),
      page.getByRole('button', { name: 'Grows with level', exact: true }),
      page.getByRole('button', { name: 'Speed', exact: true }),
      page.getByRole('button', { name: 'Save', exact: true }),
    ],
    // The name, beside Back and the file view in the header.
    keepsRoom: (page) => [page.getByRole('heading', { level: 1, name: LONG_FEAT, exact: true })],
  },
  {
    name: 'workshop spell editor',
    open: async (page) => {
      await page.goto('/workshop/new/spell');
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Fire Spark');
      await page.getByRole('button', { name: 'Material', exact: true }).click();
      await page.getByRole('button', { name: 'Damage', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Fire Spark', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Remove .* damage$/ })).toBeVisible();
    },
    primary: (page) => [
      page.getByRole('combobox', { name: 'Level', exact: true }),
      page.getByRole('combobox', { name: 'School', exact: true }),
      page.getByRole('button', { name: 'Material', exact: true }),
      page.getByLabel('Cost in gold pieces', { exact: true }),
      page.getByRole('button', { name: /^Remove .* damage$/ }),
      page.getByRole('button', { name: 'More at higher levels', exact: true }),
      page.getByRole('heading', { level: 2, name: 'On the Spells tab', exact: true }),
      page.getByRole('button', { name: 'Save', exact: true }),
    ],
  },
];

/*
 * One test per editor, so neither runs near the timeout under load. One
 * theme, since the theme changes colours, not the layout.
 */
test.describe('the Workshop editors, with a card each', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const route of EDITORS) {
    test(`${route.name}: does not scroll sideways at 320 px, folds open, and keeps its controls whole with text at 200%`, async ({
      page,
    }) => {
      await skipOfflineReadyNotice(page);
      await gotoRosterSettled(page);
      for (const extra of ['', 'html { font-size: 200% !important; }']) {
        await route.open(page, '');
        await applyMeasuredFont(page, extra);
        await openFolds(page);
        await animationsSettled(page);
        const at = { ...route, name: `${route.name}${extra === '' ? '' : ' (200%)'}` };
        await expectNoSidewaysScroll(page, at);
        for (const control of route.primary(page)) {
          await control.scrollIntoViewIfNeeded();
          await expect(control, `${at.name}: ${control}`).toBeInViewport({ ratio: 1 });
        }
        for (const text of route.keepsRoom?.(page) ?? []) {
          const { width } = await box(text);
          expect(width, `${at.name}: ${text} keeps room to be read`).toBeGreaterThanOrEqual(80);
        }
      }
    });
  }
});

test.describe('the condition strip, every condition on', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('scrolls sideways inside itself, never the page, at 320 px and with text at 200%', async ({
    page,
  }) => {
    const id = await setUp(page);
    await addConditions(page, id, [...CONDITIONS], 2);
    const strip = page.getByRole('list', { name: 'Active effects' });
    const route = { name: 'the condition strip', open: async () => {}, primary: () => [] };

    for (const extra of ['', 'html { font-size: 200% !important; }']) {
      await gotoSheetTab(page, id, 'Stats');
      await applyMeasuredFont(page, extra);
      await animationsSettled(page);
      await expectNoSidewaysScroll(page, route);
      // Its row runs past the screen and scrolls, so this measured the case.
      const row = strip.locator('..');
      const { scrollWidth, clientWidth } = await row.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollWidth).toBeGreaterThan(clientWidth);
      // One line, however many chips, so the header grows by no more than a
      // row: the first chip and the strip's end share it.
      const add = stripEnd(page);
      await add.scrollIntoViewIfNeeded();
      await expect(add).toBeInViewport({ ratio: 1 });
      const first = await box(strip.getByRole('listitem').first());
      const end = await box(add);
      expect(
        Math.abs(end.y + end.height / 2 - (first.y + first.height / 2)),
        'the chips share a line',
      ).toBeLessThan(1);
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

/**
 * The elements of a fixed panel that stick out past its right edge. A fixed
 * panel never widens the page, so `expectNoSidewaysScroll` cannot see them.
 */
function pastRightEdge(panel: Locator): Promise<string[]> {
  return panel.evaluate((el) => {
    const edge = el.getBoundingClientRect().right;
    return [...el.querySelectorAll('*')]
      .filter((child) => child.getBoundingClientRect().right > edge + 0.5)
      .slice(0, 5)
      .map((child) => `${child.tagName.toLowerCase()} "${child.textContent?.trim().slice(0, 30)}"`);
  });
}

test.describe('the dice tray and the roll toast', () => {
  for (const [when, viewport, extra] of [
    ['at 320 CSS px', { width: 320, height: 640 }, ''],
    ['with text at 200%', undefined, 'html { font-size: 200% !important; }'],
  ] as const) {
    test(`keep both views and the toast whole ${when}`, async ({ page }) => {
      if (viewport !== undefined) await page.setViewportSize(viewport);
      const id = await setUp(page);
      await gotoSheetTab(page, id, 'Play');
      await applyMeasuredFont(page, extra);
      await page.getByRole('button', { name: 'Dice tray' }).click();
      const dice = page.getByRole('dialog', { name: 'Dice' });
      await expect(dice).toBeVisible();
      await animationsSettled(page);

      await dice.getByRole('button', { name: 'd20', exact: true }).click();
      await dice.getByRole('button', { name: 'd8', exact: true }).click();
      expect(await pastRightEdge(dice), 'Roll: past the sheet').toEqual([]);
      for (const control of [
        dice.getByRole('button', { name: 'History' }),
        dice.getByRole('button', { name: 'Advantage', exact: true }),
        dice.getByRole('button', { name: 'd100', exact: true }),
        dice.getByRole('button', { name: 'Custom dice' }),
        dice.getByRole('textbox', { name: 'Dice expression' }),
        dice.getByRole('button', { name: 'Roll', exact: true }).last(),
      ]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control, `Roll: ${control}`).toBeInViewport({ ratio: 1 });
      }

      await dice.getByRole('button', { name: 'History' }).click();
      expect(await pastRightEdge(dice), 'History: past the sheet').toEqual([]);
      for (const control of [
        dice.getByRole('button', { name: 'Clear all' }),
        dice.getByRole('button', { name: /^Remove d8 roll/ }),
      ]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control, `History: ${control}`).toBeInViewport({ ratio: 1 });
      }

      // A roll, closed straight after, so its toast is up to measure.
      await dice.getByRole('button', { name: 'Roll', exact: true }).first().click();
      await dice.getByRole('button', { name: 'd6', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(dice).toBeHidden();
      const toast = page.getByRole('button', { name: /^d6: \d+\. .*Open roll history$/ });
      await expect(toast).toBeInViewport({ ratio: 1 });
      expect(await pastRightEdge(toast), 'the toast: past its edge').toEqual([]);
    });
  }
});

test.describe('the Effects picker', () => {
  for (const [when, viewport, extra] of [
    ['at 320 CSS px', { width: 320, height: 640 }, ''],
    ['at 375 CSS px', { width: 375, height: 812 }, ''],
    ['with text at 200%', undefined, 'html { font-size: 200% !important; }'],
  ] as const) {
    test(`scrolls only up and down, its chips focused at the edge ${when}`, async ({ page }) => {
      if (viewport !== undefined) await page.setViewportSize(viewport);
      const id = await setUp(page);
      await gotoSheetTab(page, id, 'Play');
      await applyMeasuredFont(page, extra);
      await stripEnd(page).click();
      const picker = page.getByRole('dialog', { name: 'Effects' });
      await expect(picker).toBeVisible();
      await animationsSettled(page);

      const scroll = picker.getByRole('heading', { name: 'Helping you' }).locator('..');
      const width = () =>
        scroll.evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollLeft: el.scrollLeft,
        }));
      const before = await width();
      expect(before.scrollWidth, 'the picker scrolls sideways').toBe(before.clientWidth);
      expect(await pastRightEdge(scroll), 'past the picker').toEqual([]);

      // Every chip focused in turn, as a keyboard or a tap would: none may
      // scroll the picker sideways to bring its clear border in.
      for (const chip of await scroll.getByRole('button').all()) {
        await chip.focus();
        expect((await width()).scrollLeft, `focusing ${chip}`).toBe(0);
      }

      // Each row's first chip still lines its face up with the headings:
      // only its clear border sits outside the column.
      const heading = await box(picker.getByRole('heading', { name: 'Helping you' }));
      // Helping you and Conditions.
      const rows = scroll.locator('h3 + div');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const face = await row
          .getByRole('button')
          .first()
          .evaluate(
            (el) =>
              el.getBoundingClientRect().x +
              Number.parseFloat(getComputedStyle(el).borderLeftWidth),
          );
        expect(Math.abs(face - heading.x), 'a chip face off the headings').toBeLessThan(0.5);
      }
    });
  }
});

test.describe('the HP sheet', () => {
  for (const [when, viewport, extra] of [
    ['at 320 CSS px', { width: 320, height: 640 }, ''],
    ['with text at 200%', undefined, 'html { font-size: 200% !important; }'],
    [
      'at 320 CSS px with text at 200%',
      { width: 320, height: 640 },
      'html { font-size: 200% !important; }',
    ],
    ['on a phone on its side', { width: 851, height: 393 }, ''],
  ] as const) {
    test(`keeps every mode and key whole ${when}`, async ({ page }) => {
      if (viewport !== undefined) await page.setViewportSize(viewport);
      // A played character holding temp HP: the longest line under the keypad
      // and the longest context beside the title.
      const id = await setUpFilled(page);
      await gotoSheetTab(page, id, 'Play');
      await applyMeasuredFont(page, extra);
      await page.getByRole('button', { name: 'Temp HP' }).click();
      const sheet = page.getByRole('dialog', { name: 'Hit points' });
      await expect(sheet).toBeVisible();
      const quick = sheet.getByRole('group', { name: 'Add to the amount' });
      const keypad = sheet.getByRole('group', { name: 'Keypad' });
      await animationsSettled(page);
      await keypad.getByRole('button', { name: '5' }).click();
      await sheet.getByRole('button', { name: 'Set temp HP to 5' }).click();
      await expect(sheet).toBeHidden();

      // The card's two buttons, whole, however their row wrapped.
      const route = { name: 'the HP card', open: async () => {}, primary: () => [] };
      await animationsSettled(page);
      await expectNoSidewaysScroll(page, route);
      for (const name of ['Damage', 'Heal']) {
        const action = page.getByRole('button', { name, exact: true });
        await action.scrollIntoViewIfNeeded();
        await expect(action, name).toBeInViewport({ ratio: 1 });
        expect(await pastRightEdge(action), `${name}: past its edge`).toEqual([]);
      }

      await page.getByRole('button', { name: 'Damage', exact: true }).click();
      await expect(sheet).toBeVisible();
      await animationsSettled(page);
      for (const [mode, confirm] of [
        ['Damage', 'Take 150 damage'],
        ['Heal', /^Heal \d+ HP$|^Already at full HP$/],
        ['Temp HP', 'Set temp HP to 150'],
      ] as const) {
        await sheet.getByRole('button', { name: mode, exact: true }).click();
        // 14, +1 is 15, and a 0 typed on its end is 150.
        if (mode === 'Damage') {
          for (const digit of ['1', '4'])
            await keypad.getByRole('button', { name: digit, exact: true }).click();
          await quick.getByRole('button', { name: '+1', exact: true }).click();
          await keypad.getByRole('button', { name: '0', exact: true }).click();
        }
        expect(await pastRightEdge(sheet), `${mode}: past the sheet`).toEqual([]);
        for (const control of [
          sheet.getByRole('button', { name: mode, exact: true }),
          quick.getByRole('button', { name: '+10', exact: true }),
          keypad.getByRole('button', { name: '1', exact: true }),
          keypad.getByRole('button', { name: 'Clear' }),
          keypad.getByRole('button', { name: 'Undo' }),
          sheet.getByRole('button', { name: confirm }),
        ]) {
          await control.scrollIntoViewIfNeeded();
          await expect(control, `${mode}: ${control}`).toBeInViewport({ ratio: 1 });
          expect(await pastRightEdge(control), `${mode}: ${control} past its edge`).toEqual([]);
        }
        // The confirm never scrolls away with the keys.
        await keypad.getByRole('button', { name: '1', exact: true }).scrollIntoViewIfNeeded();
        await expect(sheet.getByRole('button', { name: confirm })).toBeInViewport({ ratio: 1 });
      }
    });
  }
});

/** Spells in the landscape walk of a long list, enough that most are not rendered at once. */
const LONG_LIST = 150;

test.describe('landscape on a phone', () => {
  test.use({ viewport: { width: 851, height: 393 } });

  for (const tab of Object.keys(SHEET_PAGES) as SheetPage[]) {
    test(`sheet ${tab}: the header and tab bar leave the page in sight`, async ({ page }) => {
      const id = await setUp(page);
      // A condition on, so the header carries the condition strip's row on
      // every tab: its tallest.
      await addConditions(page, id, ['Poisoned']);
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

  test('sheet Play, scrolled: the header goes with the page, only the tab bar stays', async ({
    page,
  }) => {
    const id = await setUp(page);
    await addConditions(page, id, ['Poisoned']);
    await gotoSheetTab(page, id, 'Play');
    await animationsSettled(page);
    // Sticky, the header and the tab bar held 41% of a 400px screen (a laptop
    // at 200% zoom) for as long as the page was scrolled.
    await page.mouse.wheel(0, 600);
    const header = page.getByRole('banner');
    await expect(header).not.toBeInViewport();
    const nav = await box(tabBar(page));
    expect(nav.height / 393, 'the tab bar alone').toBeLessThan(0.25);
    // What sticks under the header (Build's and Items' bars) and the scroll
    // padding read its height as nothing while it does not stick.
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--sheet-header-h').trim(),
      ),
    ).toBe('0px');
  });

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
