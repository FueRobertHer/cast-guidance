import type { Page } from '@playwright/test';
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
