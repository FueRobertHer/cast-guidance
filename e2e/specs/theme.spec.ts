import type { Page } from '@playwright/test';
import { THEME_FONTS } from '../../src/theme/fonts.ts';
import { createBlankCharacter, gotoRoster, gotoSheetTab, SHEET_TABS } from '../support/app.ts';
import { waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

// DS-001. `src/lib/theme.test.ts` holds the boot script and the theme module
// to the same answers; this checks the built app: a choice made in Settings is
// drawn at once, kept on this device, and drawn before the first frame of the
// next load, with the browser's bars in the theme's page colour.

const BAR = {
  dark: '#121110',
  light: '#eee6d5',
  parchment: '#e9dfc6',
  modern: '#f2f4f7',
  contrast: '#000000',
} as const;

/** Records the root's `data-theme` at each change, and at the first frame. */
async function watchTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { themes: string[] }).themes = seen;
    const note = (when: string) =>
      seen.push(`${when}:${document.documentElement?.getAttribute('data-theme')}`);
    // Chromium runs an init script before the parser has made <html>, so this
    // watches the document and keeps only the root's changes. The previews in
    // Settings carry `data-theme` too.
    new MutationObserver((records) => {
      if (records.some((r) => r.target === document.documentElement)) note('set');
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
    // The first frame's callbacks run before that frame is painted.
    requestAnimationFrame(() => note('frame'));
  });
}

const themesSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { themes: string[] }).themes);

async function expectTheme(page: Page, theme: keyof typeof BAR): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', BAR[theme]);
}

/** Picks a theme the way a person does, by its card. */
async function pick(
  page: Page,
  label: 'System' | 'Light' | 'Dark' | 'Parchment' | 'Modern' | 'High contrast',
): Promise<void> {
  await page.getByRole('group', { name: 'Theme' }).locator('label', { hasText: label }).click();
  await expect(page.getByRole('radio', { name: label })).toBeChecked();
}

test.describe('colour theme', () => {
  test('starts dark, takes Light from Settings, and draws it from the first frame after', async ({
    page,
  }) => {
    await watchTheme(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expectTheme(page, 'dark');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

    await pick(page, 'Light');
    await expectTheme(page, 'light');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expectTheme(page, 'light');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    // Light before the first frame, and never anything else on the way.
    const seen = await themesSeen(page);
    expect(seen.find((s) => s.startsWith('frame:'))).toBe('frame:light');
    expect(seen.filter((s) => !s.endsWith(':light'))).toEqual([]);
  });

  test('takes a reskin, draws it from the first frame after, and in its own fonts offline', async ({
    page,
    network,
  }) => {
    await watchTheme(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await pick(page, 'Parchment');
    await expectTheme(page, 'parchment');

    // Every built-in theme's faces are precached, so a reskin is whole at
    // the table without a connection, Settings' previews included.
    await waitForSwControl(page);
    await network.goOffline();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expectTheme(page, 'parchment');
    await expect(page.getByRole('radio', { name: 'Parchment' })).toBeChecked();
    const seen = await themesSeen(page);
    expect(seen.find((s) => s.startsWith('frame:'))).toBe('frame:parchment');
    expect(seen.filter((s) => !s.endsWith(':parchment'))).toEqual([]);

    await page.evaluate(() => document.fonts.ready);
    const drawn = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      title: getComputedStyle(document.querySelector('h1') as Element).fontFamily,
      loaded: ['400 1em "Literata"', '600 1em "Alegreya"', '400 1em "Inter Variable"'].filter(
        (face) => document.fonts.check(face),
      ),
    }));
    expect(drawn.body).toMatch(/^"?Literata/);
    expect(drawn.title).toMatch(/^"?Alegreya/);
    // Modern's preview draws Inter: from the precache too.
    expect(drawn.loaded).toEqual([
      '400 1em "Literata"',
      '600 1em "Alegreya"',
      '400 1em "Inter Variable"',
    ]);
    network.assertNothingServedOffline();
  });

  test('System follows the device as it changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await pick(page, 'System');
    await expectTheme(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');

    // A fixed choice stays put whatever the device says.
    await pick(page, 'Light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');
  });
});

// Phase 3 (docs/theme-format.md): themes of one's own, from a file or a link.

const MIDNIGHT = {
  castGuidanceTheme: 1,
  name: 'Midnight',
  author: 'Vela',
  base: 'light',
  tokens: { bg: '#101418', surface: '#1a2028', ink: '#f4f0e8', 'radius-card': '4px' },
};

/** The page's inline `--cg-bg` and colour scheme, at the first frame of each load. */
async function watchFirstFrame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      const root = document.documentElement;
      (window as unknown as { firstFrame: unknown }).firstFrame = {
        theme: root.getAttribute('data-theme'),
        bg: root.style.getPropertyValue('--cg-bg'),
        scheme: root.style.getPropertyValue('color-scheme'),
      };
    });
  });
}

const firstFrame = (page: Page) =>
  page.evaluate(() => (window as unknown as { firstFrame: unknown }).firstFrame);

async function openSettings(page: Page, hash = ''): Promise<void> {
  await page.goto(`/settings${hash}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

async function importTheme(page: Page, theme: unknown): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a theme' }).click();
  await (await choosing).setFiles({
    name: 'midnight.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(theme)),
  });
}

test.describe("themes of one's own", () => {
  test('imports a file, tries it, keeps it, and draws it from the first frame after a reload', async ({
    page,
  }) => {
    await watchFirstFrame(page);
    await openSettings(page);
    await importTheme(page, MIDNIGHT);
    const sheet = page.getByRole('dialog', { name: 'Try “Midnight”?' });
    await expect(sheet).toContainText('By Vela');
    await sheet.getByRole('button', { name: 'Try this theme' }).click();
    await expect(sheet).toBeHidden();

    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() => root.evaluate((r) => r.style.getPropertyValue('--cg-bg')))
      .toBe('#101418');
    // A dark page on a light base: native controls follow the page.
    expect(await root.evaluate((r) => getComputedStyle(r).colorScheme)).toBe('dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#101418');

    const banner = page.locator('[data-theme-keep]');
    await expect(banner).toContainText('Keep the theme Midnight?');
    await banner.getByRole('button', { name: 'Keep' }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('radio', { name: 'Midnight' })).toBeChecked();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await firstFrame(page)).toEqual({ theme: 'light', bg: '#101418', scheme: 'dark' });
    // Settings' Appearance section stays in the built-in base, the way back.
    const appearance = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Appearance' }),
    });
    await expect(appearance).toHaveAttribute('data-theme', 'light');
  });

  test('goes back by itself if nobody keeps it, and a reload meanwhile goes back too', async ({
    page,
  }) => {
    await page.clock.install();
    await openSettings(page);
    await importTheme(page, MIDNIGHT);
    await page.getByRole('button', { name: 'Try this theme' }).click();
    const root = page.locator('html');
    await expect
      .poll(() => root.evaluate((r) => r.style.getPropertyValue('--cg-bg')))
      .toBe('#101418');
    await page.clock.fastForward(31_000);
    await expect(page.locator('[data-theme-keep]')).toBeHidden();
    expect(await root.evaluate((r) => r.style.getPropertyValue('--cg-bg'))).toBe('');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    // Kept in Your themes, though, to pick again.
    await expect(page.getByRole('radio', { name: 'Midnight' })).not.toBeChecked();

    await page.getByRole('radio', { name: 'Midnight' }).click();
    await expect(root).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: 'Dark' }).click();
    // Trying it again and reloading instead of keeping it: back to Dark.
    await importTheme(page, MIDNIGHT);
    await page.getByRole('button', { name: 'Try this theme' }).click();
    await expect(page.locator('[data-theme-keep]')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    expect(await root.evaluate((r) => r.style.getPropertyValue('--cg-bg'))).toBe('');
  });

  test('shares a theme as a link that another page opens, and takes off the address', async ({
    page,
    context,
  }) => {
    await openSettings(page);
    await importTheme(page, MIDNIGHT);
    await page.getByRole('button', { name: 'Try this theme' }).click();
    await page.locator('[data-theme-keep]').getByRole('button', { name: 'Keep' }).click();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // No share sheet here, so the link goes to the clipboard.
    await page.evaluate(() => {
      (navigator as { share?: unknown }).share = undefined;
    });
    await page.getByRole('button', { name: 'Share this theme' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/settings#theme=1\.[\w-]+$/);

    const other = await context.newPage();
    await other.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    const sheet = other.getByRole('dialog', { name: 'Try “Midnight”?' });
    await expect(sheet).toBeVisible();
    await expect.poll(() => other.evaluate(() => location.hash)).toBe('');
  });

  test('?theme=reset goes back to Dark from any address, and comes off it', async ({ page }) => {
    await openSettings(page);
    await importTheme(page, MIDNIGHT);
    await page.getByRole('button', { name: 'Try this theme' }).click();
    await page.locator('[data-theme-keep]').getByRole('button', { name: 'Keep' }).click();
    await watchFirstFrame(page);
    await page.goto('/library?theme=reset');
    expect(await firstFrame(page)).toEqual({ theme: 'dark', bg: '', scheme: '' });
    await expect.poll(() => page.evaluate(() => location.search)).toBe('');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

// Phase 4 (docs/theming-plan.md): the theme editor.

async function setHex(page: Page, token: string, hex: string): Promise<void> {
  const field = page
    .locator(`[data-token-row="${token}"]`)
    .getByRole('textbox', { name: /hex code/ });
  await field.fill(hex);
  await field.press('Enter');
}

test.describe('the theme editor', () => {
  test('makes a theme from Parchment, saves it, and draws it from the first frame after a reload', async ({
    page,
  }) => {
    await watchFirstFrame(page);
    await openSettings(page);
    await page.getByRole('radio', { name: 'Parchment' }).click();
    await page.getByRole('button', { name: 'Make a theme' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Make a theme' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Parchment copy');

    await setHex(page, 'bg', '#1d2b3a');
    await setHex(page, 'surface', '#24364a');
    await page.locator('[data-token-row="font-sans"] select').selectOption('inter');
    const sample = page.locator('[data-theme-sample]');
    await expect(sample).toHaveAttribute('data-theme', 'parchment');
    expect(await sample.evaluate((s) => s.style.getPropertyValue('--cg-bg'))).toBe('#1d2b3a');
    // The page itself stays in Parchment while the draft is made.
    expect(await page.locator('html').evaluate((r) => r.style.getPropertyValue('--cg-bg'))).toBe(
      '',
    );
    // A dark page on a light base: the roles turned with it.
    await expect(page.locator('[data-token-row="danger"]')).toContainText('Follows the page');

    await page.getByRole('textbox', { name: 'Name' }).fill('Night Tide');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Night Tide' })).toBeChecked();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await firstFrame(page)).toEqual({ theme: 'parchment', bg: '#1d2b3a', scheme: 'dark' });
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(
      /^"?Inter/,
    );

    // Edited again, in place: what followed the page still follows it.
    await page.getByRole('button', { name: 'Edit this theme' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit theme' })).toBeVisible();
    await expect(page.locator('[data-token-row="danger"]')).toContainText('Follows the page');
    await setHex(page, 'brand', '#f0b44c');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Night Tide' })).toBeChecked();
    expect(await page.locator('html').evaluate((r) => r.style.getPropertyValue('--cg-brand'))).toBe(
      '#f0b44c',
    );
    await expect(page.getByRole('radio')).toHaveCount(7);
  });

  test('fits a 320 px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/settings/theme');
    await expect(page.getByRole('heading', { level: 1, name: 'Make a theme' })).toBeVisible();
    for (const group of ['Page and surfaces', 'Conditions', 'Shape', 'Shadows']) {
      await page.locator('summary').getByText(group, { exact: true }).click();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// Phase 5 (docs/theming-plan.md): decor, title tracking and the font library.

const LIBRARY = THEME_FONTS.filter((f) => f.source === 'library').map((f) => f.id);

/** Takes a theme from a file and keeps it, the way a person does. */
async function keepTheme(
  page: Page,
  theme: { name: string; [key: string]: unknown },
): Promise<void> {
  await openSettings(page);
  await importTheme(page, theme);
  await page.getByRole('dialog').getByRole('button', { name: 'Try this theme' }).click();
  await page.locator('[data-theme-keep]').getByRole('button', { name: 'Keep' }).click();
  await expect(page.getByRole('radio', { name: theme.name })).toBeChecked();
}

/** Whether every face named is loaded, once the fonts have settled. */
const facesLoaded = (page: Page, faces: string[]) =>
  page.evaluate(async (all) => {
    await document.fonts.ready;
    return all.filter((face) => !document.fonts.check(face));
  }, faces);

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('decor and the font library', () => {
  test('keeps the font library out of the precache', async ({ page }) => {
    await page.goto('/');
    const sw = await page.evaluate(() => fetch('/sw.js').then((r) => r.text()));
    // The app's own faces are in it, so the check reads the right list.
    expect(sw).toContain('literata-latin-400-normal');
    expect(LIBRARY.filter((id) => sw.includes(`${id}-latin-`))).toEqual([]);
  });

  test('draws a theme in library fonts, spaced titles and its decor from the first frame, online and off', async ({
    page,
    network,
  }) => {
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        const root = document.documentElement;
        (window as unknown as { decor: unknown }).decor = {
          texture: root.getAttribute('data-cg-texture'),
          frame: root.getAttribute('data-cg-frame'),
        };
      });
    });
    await keepTheme(page, {
      castGuidanceTheme: 1,
      name: 'Old Map',
      base: 'dark',
      tokens: {
        'font-sans': 'eb-garamond',
        'font-display': 'cinzel',
        'tracking-display': '0.12em',
        texture: 'grain',
        frame: 'stitched',
      },
    });
    const faces = ['400 1em "EB Garamond"', '700 1em "EB Garamond"', '600 1em "Cinzel"'];
    await expect.poll(() => facesLoaded(page, faces)).toEqual([]);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { decor: unknown }).decor)).toEqual({
      texture: 'grain',
      frame: 'stitched',
    });
    expect(await facesLoaded(page, faces)).toEqual([]);
    const h1 = page.getByRole('heading', { level: 1 });
    // 28px titles at the theme's 0.12em, over their own -0.01em.
    expect(await h1.evaluate((e) => getComputedStyle(e).letterSpacing)).toBe('3.08px');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toMatch(
      /^url\("data:image\/svg\+xml/,
    );

    // Its faces were kept the first time, so it is whole offline.
    await waitForSwControl(page);
    await network.goOffline();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect.poll(() => facesLoaded(page, faces)).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(
      /^"?EB Garamond/,
    );
    await expect(page.getByRole('radio', { name: 'Old Map' })).not.toHaveAccessibleDescription(
      /download/,
    );
    network.assertNothingServedOffline();
  });

  test('fits a 320 px phone in the widest fonts with the widest titles', async ({ page }) => {
    await page.goto('/');
    const id = await createBlankCharacter(page);
    await keepTheme(page, {
      castGuidanceTheme: 1,
      name: 'Wide',
      base: 'light',
      tokens: { 'font-sans': 'opendyslexic', 'font-display': 'cinzel', 'tracking-display': 0.2 },
    });
    await expect
      .poll(() => facesLoaded(page, ['400 1em "OpenDyslexic"', '600 1em "Cinzel"']))
      .toEqual([]);
    await page.setViewportSize({ width: 320, height: 640 });
    const wide: string[] = [];
    const check = async (where: string) => {
      await page.evaluate(() => document.fonts.ready);
      if ((await sidewaysScroll(page)) > 0) wide.push(where);
    };
    await gotoRoster(page);
    await check('roster');
    for (const tab of Object.keys(SHEET_TABS) as (keyof typeof SHEET_TABS)[]) {
      await gotoSheetTab(page, id, tab);
      await check(tab);
    }
    await openSettings(page);
    await check('settings');
    expect(wide).toEqual([]);
  });

  test('frames Parchment’s cards on paper, and a focused card shows the focus ring instead', async ({
    page,
  }) => {
    await page.goto('/');
    await createBlankCharacter(page);
    await openSettings(page);
    await pick(page, 'Parchment');
    await gotoRoster(page);
    const card = page.locator('a.cg-card').first();
    const look = () =>
      card.evaluate((c) => {
        const s = getComputedStyle(c);
        return { style: s.outlineStyle, offset: Number.parseFloat(s.outlineOffset) };
      });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toMatch(
      /^url\("data:image\/svg\+xml/,
    );
    expect(await look()).toEqual({ style: 'solid', offset: -4 });

    // By keyboard, as focus rings are for.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await card.evaluate((c) => c === document.activeElement)) break;
    }
    await expect(card).toBeFocused();
    const focused = await look();
    expect(focused.style).toBe('solid');
    expect(focused.offset).toBeGreaterThanOrEqual(0);
  });

  test('offers title faces for titles only, and says when a font is not on this device yet', async ({
    page,
    network,
    consoleGuard,
  }) => {
    await page.goto('/settings/theme');
    await expect(page.getByRole('heading', { level: 1, name: 'Make a theme' })).toBeVisible();
    const text = page.locator('[data-token-row="font-sans"] select');
    const titles = page.locator('[data-token-row="font-display"] select');
    await expect(text.locator('option[value="cinzel"]')).toHaveCount(0);
    await expect(titles.locator('option[value="cinzel"]')).toHaveCount(1);

    // A face fetched for the first time, offline: the fetch fails, as it should.
    consoleGuard.allowResource((url) => /\/assets\/lexend-latin-/.test(url));
    await waitForSwControl(page);
    await network.goOffline();
    await text.selectOption('lexend');
    const note = page.locator('[data-token-row="font-sans"]').getByText('Not on this device yet');
    await expect(note).toBeVisible();
    await expect(text).toHaveAccessibleDescription(/Not on this device yet/);

    await network.goOnline();
    await expect(note).toBeHidden();
    await expect.poll(() => facesLoaded(page, ['400 1em "Lexend"'])).toEqual([]);
  });
});
