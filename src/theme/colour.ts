/**
 * The little colour arithmetic themes need: reading and writing `#rrggbb[aa]`,
 * mixing two colours in sRGB, and WCAG luminance and contrast. Not a colour
 * library: the theme editor's derived values (derive.ts) and a theme's light
 * or dark ground (file.ts) are all it serves.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, else null. */
export function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().toLowerCase();
  const short = /^#([0-9a-f]{3,4})$/.exec(raw)?.[1];
  const full = short
    ? [...short].map((c) => c + c).join('')
    : /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(raw)?.[1];
  if (full === undefined) return null;
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}

const two = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function toHex({ r, g, b, a }: Rgb): string {
  const alpha = Math.round(a * 255);
  return `#${two(r)}${two(g)}${two(b)}${alpha >= 255 ? '' : two(alpha)}`;
}

/** `from` moved `t` of the way to `to` (0 is `from`, 1 is `to`), opaque. */
export function mix(from: string, to: string, t: number): string | null {
  const a = parseHex(from);
  const b = parseHex(to);
  if (a === null || b === null) return null;
  const at = (x: number, y: number) => x + (y - x) * t;
  return toHex({ r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: 1 });
}

/** WCAG 2 relative luminance of a colour's own channels (alpha aside). */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (c === null) return 0;
  const [r, g, b] = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether black text reads better on it than white: a light ground. */
export function isLight(hex: string): boolean {
  return contrast(hex, '#000000') > contrast(hex, '#ffffff');
}
