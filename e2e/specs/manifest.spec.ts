import type { Page } from '@playwright/test';
import { waitForSwControl } from '../support/sw.ts';
import { expect, test } from '../support/test.ts';

// PWA-002 (#107). `scripts/pwaManifest.test.ts` is the gate for the icon files
// themselves; this checks what the built app actually serves, and what
// Chromium makes of it.

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

/** The manifest URL from the page's `<link rel="manifest">`, resolved. */
async function manifestUrl(page: Page): Promise<string> {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  if (href === null) throw new Error('index.html has no <link rel="manifest">');
  return new URL(href, page.url()).href;
}

test.describe('web app manifest', () => {
  test('is served as a manifest, and every icon it lists loads at its declared size', async ({
    page,
  }) => {
    await page.goto('/');
    const url = await manifestUrl(page);
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json\b/);

    const manifest = (await response.json()) as { icons: ManifestIcon[] };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const iconUrl = new URL(icon.src, url).href;
      const iconResponse = await page.request.get(iconUrl);
      expect(iconResponse.status(), icon.src).toBe(200);
      expect(iconResponse.headers()['content-type'], icon.src).toBe(icon.type);
      if (icon.sizes === 'any') continue;

      // Decoded by the browser, under the app's CSP, not just present.
      const [width, height] = icon.sizes.split('x').map(Number);
      const natural = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, iconUrl);
      expect(natural, icon.src).toEqual([width, height]);
    }

    // A maskable icon must reach its corners: launchers crop it to any shape.
    const maskable = manifest.icons.find(
      (icon) => icon.purpose === 'maskable' && icon.sizes === '512x512',
    );
    expect(maskable, 'a 512x512 maskable icon').toBeDefined();
    const cornerAlpha = await page.evaluate(
      async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(image, 0, 0);
        const last = canvas.width - 1;
        return [
          [0, 0],
          [last, 0],
          [0, last],
          [last, last],
        ].map(([x, y]) => context.getImageData(x ?? 0, y ?? 0, 1, 1).data[3]);
      },
      new URL(maskable?.src ?? '', url).href,
    );
    expect(cornerAlpha).toEqual([255, 255, 255, 255]);
  });

  test('the Apple touch icon is linked and served', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(href).toBe('/icons/apple-touch-icon-180.png');
    const response = await page.request.get(new URL(href ?? '', page.url()).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  });

  test('Chromium finds the app installable', async ({ launchProfile }, testInfo) => {
    // Full Chromium in new headless mode, with a persistent profile: the
    // headless shell reports no installability errors whatever the page.
    const context = await launchProfile(testInfo.outputPath('profile'), { newHeadless: true });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/');
    await waitForSwControl(page);

    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.url).toBe(await manifestUrl(page));
    expect(manifest.errors).toEqual([]);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);

    // The canary: a document with no manifest is reported, so the empty list
    // above is the browser's verdict and not a check that cannot fail.
    await page.goto('/favicon.svg');
    const canary = await cdp.send('Page.getInstallabilityErrors');
    expect(canary.installabilityErrors.map((e) => e.errorId)).toContain('no-manifest');
  });
});
