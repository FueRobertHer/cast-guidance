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

  test('takes a reskin, draws it from the first frame after, and keeps its fonts for offline', async ({
    page,
  }) => {
    await watchTheme(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    // The service worker keeps a theme's fonts as they are fetched, so it
    // has to be in charge before the theme asks for them.
    await waitForSwControl(page);

    await pick(page, 'Parchment');
    await expectTheme(page, 'parchment');
    // Picking it asked for every face it draws in, and the worker kept each.
    // (Settings' previews draw each theme's title font, so others come too.)
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open('theme-fonts');
          return (await cache.keys())
            .map((r) => new URL(r.url).pathname.replace(/^\/assets\/|-[\w-]{8}\.woff2$/g, ''))
            .sort();
        }),
      )
      .toEqual(
        expect.arrayContaining([
          'alegreya-latin-600-normal',
          'alegreya-latin-700-normal',
          'literata-latin-400-normal',
          'literata-latin-700-normal',
        ]),
      );

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expectTheme(page, 'parchment');
    await expect(page.getByRole('radio', { name: 'Parchment' })).toBeChecked();
    const seen = await themesSeen(page);
    expect(seen.find((s) => s.startsWith('frame:'))).toBe('frame:parchment');
    expect(seen.filter((s) => !s.endsWith(':parchment'))).toEqual([]);
    // Drawn in its own faces, not the default themes'.
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      title: getComputedStyle(document.querySelector('h1') as Element).fontFamily,
    }));
    expect(fonts.body).toMatch(/^"?Literata/);
    expect(fonts.title).toMatch(/^"?Alegreya/);
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
