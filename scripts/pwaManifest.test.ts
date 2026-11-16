import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLE_TOUCH_ICON, pwaManifest } from '../pwa.manifest.ts';
import {
  FONT_DEPENDENT_ELEMENT,
  hashIconSource,
  ICON_SOURCE,
  ICON_STAMP,
  type IconStamp,
} from './iconSource.ts';

// PWA-002 (#107): the manifest's icons are what Android installs and masks, so
// every declared size must be the real size of the file it names. A wrong
// `sizes` makes Chrome skip the icon (or pick a blurry one), and a missing
// maskable icon gets the app a white plate around its icon on Android.

const PUBLIC = path.resolve(import.meta.dirname, '../public');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngHeader {
  width: number;
  height: number;
  /** 2 is RGB (no alpha channel, so every pixel is opaque); 6 is RGBA. */
  colorType: number;
}

/** Reads the IHDR chunk, which the PNG format requires to come first. */
function readPngHeader(file: string): PngHeader {
  const bytes = readFileSync(file);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${file}: not a PNG`);
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${file}: no leading IHDR`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25] ?? -1,
  };
}

const icons = pwaManifest.icons ?? [];
const purposes = (icon: (typeof icons)[number]) =>
  (Array.isArray(icon.purpose) ? icon.purpose.join(' ') : (icon.purpose ?? 'any')).split(/\s+/);
const pngs = icons.filter((icon) => icon.type === 'image/png');
const has = (size: number, purpose: string) =>
  pngs.some((icon) => icon.sizes === `${size}x${size}` && purposes(icon).includes(purpose));

describe('pwa manifest icons', () => {
  it('lists 192 and 512 PNGs for any use and a maskable 512', () => {
    expect(has(192, 'any'), '192x192 png, purpose any').toBe(true);
    expect(has(512, 'any'), '512x512 png, purpose any').toBe(true);
    expect(has(512, 'maskable'), '512x512 png, purpose maskable').toBe(true);
  });

  it('gives each purpose its own entries and marks no SVG maskable', () => {
    for (const icon of icons) {
      expect(purposes(icon), icon.src).toHaveLength(1);
      if (icon.type === 'image/svg+xml') expect(purposes(icon), icon.src).not.toContain('maskable');
    }
  });

  it.each(
    icons.map((icon) => [icon.src, icon] as const),
  )('%s exists under public/', (src, icon) => {
    expect(existsSync(path.join(PUBLIC, src)), `public/${src}`).toBe(true);
    const ext = path.extname(src);
    expect(icon.type).toBe(ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : '?');
  });

  it.each(
    pngs.map((icon) => [icon.src, icon] as const),
  )('%s is the size its entry declares', (src, icon) => {
    const header = readPngHeader(path.join(PUBLIC, src));
    expect(`${header.width}x${header.height}`).toBe(icon.sizes);
  });

  it('fills maskable icons edge to edge (no alpha channel)', () => {
    const maskable = pngs.filter((icon) => purposes(icon).includes('maskable'));
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) {
      expect(readPngHeader(path.join(PUBLIC, icon.src)).colorType, icon.src).toBe(2);
    }
  });
});

describe('apple touch icon', () => {
  const file = path.join(PUBLIC, APPLE_TOUCH_ICON.src);

  it('is an opaque 180x180 PNG', () => {
    expect(existsSync(file)).toBe(true);
    const header = readPngHeader(file);
    expect([header.width, header.height]).toEqual([APPLE_TOUCH_ICON.size, APPLE_TOUCH_ICON.size]);
    // iOS shows transparency as black, so the icon carries no alpha channel.
    expect(header.colorType).toBe(2);
  });

  it('is linked from index.html', () => {
    const html = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8');
    expect(html).toContain(`<link rel="apple-touch-icon" href="/${APPLE_TOUCH_ICON.src}" />`);
  });
});

describe('icon source', () => {
  it('the PNGs were generated from the current favicon.svg', () => {
    const stamp = JSON.parse(readFileSync(ICON_STAMP, 'utf8')) as IconStamp;
    expect(
      hashIconSource(readFileSync(ICON_SOURCE, 'utf8')),
      'public/favicon.svg changed: run `bun run icons:generate` and commit public/icons/',
    ).toBe(stamp.sha256);
  });

  it('draws no text, so rendering needs no font', () => {
    expect(readFileSync(ICON_SOURCE, 'utf8')).not.toMatch(FONT_DEPENDENT_ELEMENT);
  });

  it.each([
    '<text x="1">20</text>',
    '<svg:text>20</svg:text>',
    '<tspan>2</tspan>',
    '<textPath href="#p">0</textPath>',
    '<foreignObject width="1" height="1"></foreignObject>',
  ])('treats %s as font-dependent', (markup) => {
    expect(markup).toMatch(FONT_DEPENDENT_ELEMENT);
  });

  it('normalizes line endings before hashing', () => {
    expect(hashIconSource('<svg>\r\n</svg>')).toBe(hashIconSource('<svg>\n</svg>'));
  });
});
