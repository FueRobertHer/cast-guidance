/// <reference lib="dom" />
/**
 * Renders the raster PWA icons in `public/icons/` from `public/favicon.svg`
 * (PWA-002, #107). Run it after changing the SVG and commit the output:
 *
 *   bun run icons:generate
 *
 * Chromium (the Playwright build the E2E suite already uses) rasterizes the
 * SVG on a canvas, and this script encodes the pixels itself with `node:zlib`,
 * so the bytes do not depend on the browser's PNG encoder. The SVG draws its
 * "20" as paths, not text, so no system font is involved, and two runs on one
 * machine give identical files. Other machines may differ in a few
 * anti-aliased pixels: Skia's rasterizer can vary by CPU, and
 * `PW_CHROMIUM_EXECUTABLE` swaps in another Chromium build. So the PNGs are
 * committed, and `scripts/icons-source.json` records the hash of the SVG they
 * came from (checked by `scripts/pwaManifest.test.ts`).
 *
 * Outputs:
 * - `icon-192.png`, `icon-512.png`: the SVG as it is, transparent outside its
 *   rounded square (manifest `purpose: any`).
 * - `maskable-192.png`, `maskable-512.png`: a full-bleed background with the
 *   glyph scaled to 70%, so its farthest point stays well inside the maskable
 *   safe zone (a centred circle of radius 40% of the size).
 * - `apple-touch-icon-180.png`: opaque, glyph at 85%. iOS applies its own
 *   rounded mask and shows transparency as black, so nothing here is see-through.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import {
  FONT_DEPENDENT_ELEMENT,
  hashIconSource,
  ICON_SOURCE,
  ICON_STAMP,
  type IconStamp,
} from './iconSource.ts';

const REPO = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO, 'public/icons');

/** The manifest's `background_color` and the SVG's own square. */
const BACKGROUND = '#18181b';

type Kind = 'any' | 'maskable' | 'apple';

interface IconSpec {
  file: string;
  size: number;
  kind: Kind;
}

const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'maskable-192.png', size: 192, kind: 'maskable' },
  { file: 'maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon-180.png', size: 180, kind: 'apple' },
];

/** How much of the canvas the 32-unit glyph spans, per kind. */
const GLYPH_SCALE: Record<Kind, number> = { any: 1, maskable: 0.7, apple: 0.85 };

/**
 * Wraps the favicon in an SVG of `size` pixels: an opaque background for the
 * maskable and Apple icons, and the favicon itself nested, scaled and centred.
 */
function composeSvg(favicon: string, spec: IconSpec): string {
  const { size, kind } = spec;
  const glyph = size * GLYPH_SCALE[kind];
  const offset = (size - glyph) / 2;
  const nested = favicon.replace(
    /<svg\b/,
    `<svg x="${offset}" y="${offset}" width="${glyph}" height="${glyph}"`,
  );
  const background =
    kind === 'any' ? '' : `<rect width="${size}" height="${size}" fill="${BACKGROUND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}${nested}</svg>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Encodes 8-bit RGBA pixels as a PNG: truecolour without alpha when every
 * pixel is opaque, with alpha otherwise. Each row gets the filter with the
 * smallest sum of absolute values, the usual heuristic.
 */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array(height * stride);
  for (let p = 0, q = 0; p < width * height; p++) {
    for (let k = 0; k < channels; k++) raw[q++] = rgba[p * 4 + k] ?? 0;
  }

  const out = new Uint8Array(height * (stride + 1));
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let bestFilter = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    let best = new Uint8Array(stride);
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? (row[x - channels] ?? 0) : 0;
        const b = prev[x] ?? 0;
        const c = x >= channels ? (prev[x - channels] ?? 0) : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? (a + b) >> 1
                  : paeth(a, b, c);
        const value = ((row[x] ?? 0) - predictor) & 0xff;
        candidate[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = candidate.slice();
      }
    }
    out[y * (stride + 1)] = bestFilter;
    out.set(best, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

async function main(): Promise<void> {
  const favicon = readFileSync(ICON_SOURCE, 'utf8');
  const fontDependent = FONT_DEPENDENT_ELEMENT.exec(favicon);
  if (fontDependent !== null) {
    throw new Error(
      `public/favicon.svg uses ${fontDependent[0]}>; draw glyphs as paths so no font is involved.`,
    );
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    for (const spec of ICONS) {
      const svg = composeSvg(favicon, spec);
      const base64 = await page.evaluate(
        async ({ svg, size }) => {
          const image = new Image(size, size);
          image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('no 2d context');
          context.drawImage(image, 0, 0, size, size);
          const { data } = context.getImageData(0, 0, size, size);
          let binary = '';
          for (let i = 0; i < data.length; i += 0x8000) {
            binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
          }
          return btoa(binary);
        },
        { svg, size: spec.size },
      );
      const rgba = new Uint8Array(Buffer.from(base64, 'base64'));
      if (rgba.length !== spec.size * spec.size * 4) {
        throw new Error(`${spec.file}: got ${rgba.length} bytes of pixels`);
      }
      const png = encodePng(spec.size, spec.size, rgba);
      if (spec.kind !== 'any' && png[25] !== 2) {
        throw new Error(`${spec.file} must be fully opaque`);
      }
      writeFileSync(path.join(OUT_DIR, spec.file), png);
      console.log(`${spec.file}  ${spec.size}x${spec.size}  ${png.length} B`);
    }
  } finally {
    await browser.close();
  }

  const stamp: IconStamp = {
    $comment: 'Written by scripts/generate-icons.ts: the public/favicon.svg the PNGs came from.',
    source: 'public/favicon.svg',
    sha256: hashIconSource(favicon),
  };
  writeFileSync(ICON_STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
}

await main();
