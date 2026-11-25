import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES_CSS_PATH } from '../../tests-fixtures/themeCss';
import { contrast, parseHex } from './colour';
import { derive, FOLLOWS, inferOwn, type Tokens } from './derive';
import { builtInFile } from './file';
import { CONDITION_HUES, TOKEN_NAMES } from './vocabulary';

const css = readFileSync(THEMES_CSS_PATH, 'utf8');
const tokens = (id: 'dark' | 'light' | 'parchment' | 'modern' | 'contrast') =>
  builtInFile(id, css).tokens;
const DARK = tokens('dark');
const LIGHT = tokens('light');
const input = (own: Tokens, base: Tokens = DARK) => ({ own, base, light: LIGHT, dark: DARK });

/** The largest channel difference between two colours. */
function apart(a: unknown, b: unknown): number {
  const x = parseHex(String(a));
  const y = parseHex(String(b));
  if (x === null || y === null) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
}

describe('tokens that follow others', () => {
  it('names only tokens of the vocabulary, following tokens of the vocabulary', () => {
    for (const [name, sources] of Object.entries(FOLLOWS)) {
      expect(TOKEN_NAMES.has(name), name).toBe(true);
      for (const s of sources) expect(TOKEN_NAMES.has(s), `${name} follows ${s}`).toBe(true);
    }
  });

  it('works nothing out until something they follow moves', () => {
    expect(derive(input({}))).toEqual({});
    expect(derive(input({ 'radius-card': '4px' }))).toEqual({});
  });

  it('moves the hover, the label and the tint with the action colour, and nothing else', () => {
    const out = derive(input({ brand: '#5ee0c8' }));
    expect(Object.keys(out).sort()).toEqual(['brand-hover', 'on-brand', 'roll-soft']);
    // The page keeping its lightness, the roles keep the base's tuning.
    expect(derive(input({ bg: '#000000' }))).not.toHaveProperty('danger');
    // A light action on a dark card takes the card's colour for its label.
    expect(out['on-brand']).toBe(DARK.surface);
  });

  it('never overrides a token set by hand', () => {
    const out = derive(input({ brand: '#5ee0c8', 'brand-hover': '#123456' }));
    expect(out).not.toHaveProperty('brand-hover');
    expect(out).toHaveProperty('on-brand');
  });

  it("reproduces Dark's and Light's own tuned grounds and text, to within 20 levels a channel", () => {
    for (const [name, base] of [
      ['dark', DARK],
      ['light', LIGHT],
    ] as const) {
      // Setting the page, the cards and the ink to their own values moves everything after them.
      const out = derive(
        input({ bg: base.bg, surface: base.surface, ink: base.ink } as Tokens, base),
      );
      for (const t of [
        'surface-raised',
        'surface-hover',
        'line',
        'track',
        'line-strong',
        'ink-muted',
        'ink-faint',
      ]) {
        expect(
          apart(out[t], base[t]),
          `${name} ${t}: ${out[t]} for ${base[t]}`,
        ).toBeLessThanOrEqual(20);
      }
    }
  });

  it('turns a dark base into a light page: grounds, text, edges, glint and condition hues follow', () => {
    const out = derive(input({ bg: '#f4f0e8', surface: '#ffffff', ink: '#101418' }));
    expect(apart(out['ink-muted'], '#101418')).toBeGreaterThan(60);
    expect(out.edge).toBe(out.line);
    expect(out['hp-sheen']).toBe(LIGHT['hp-sheen']);
    // The roles tuned for a dark page give way to Light's, and their tints follow.
    for (const role of ['brand', 'guide', 'danger', 'heal', 'ward', 'arcane', 'scrim']) {
      expect(out[role], role).toBe(LIGHT[role]);
    }
    expect(out['danger-soft']).toMatch(/^#[0-9a-f]{6}$/);
    expect(out['cx-edge-hover']).toBe(out['line-strong']);
    for (const c of CONDITION_HUES) {
      expect(out[`cx-${c}`], c).toBe(LIGHT[`cx-${c}`]);
      expect(out[`cx-${c}-soft`], c).toBe(LIGHT[`cx-${c}-soft`]);
    }
    // And back on a dark page, Dark's.
    const back = derive(input({ bg: '#0b1d2a' }, LIGHT));
    expect(back['cx-poisoned']).toBe(DARK['cx-poisoned']);
    expect(back.edge).toBe('transparent');
    expect(back.danger).toBe(DARK.danger);
    // A role set by hand stays as it was set.
    expect(derive(input({ bg: '#0b1d2a', danger: '#ff0000' }, LIGHT))).not.toHaveProperty('danger');
  });

  it('gives a condition hue set by hand its own tint, and keeps Invisible clear', () => {
    const out = derive(input({ 'cx-poisoned': '#ff00ff', 'cx-invisible': '#ffffff' }));
    expect(out['cx-poisoned-soft']).toMatch(/^#[0-9a-f]{6}$/);
    expect(out).not.toHaveProperty('cx-invisible-soft');
  });

  it('darkens the danger fill until white reads on it, and labels it to match', () => {
    const out = derive(input({ danger: '#ff9999' }));
    expect(contrast(String(out['danger-fill']), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(out['on-danger']).toBe('#ffffff');
    expect(apart(out['hp-trail'], '#ffcccc')).toBeLessThanOrEqual(1);
  });

  it('tells which tokens of a saved file were set by hand, from what following would give', () => {
    const brandOnly = derive(input({ brand: '#5ee0c8' }));
    const file = { brand: '#5ee0c8', ...brandOnly, 'radius-card': '4px' };
    expect(inferOwn(file, { base: DARK, light: LIGHT, dark: DARK }).sort()).toEqual([
      'brand',
      'radius-card',
    ]);
    // A following token changed by hand counts as set by hand.
    const edited = { ...file, 'brand-hover': '#000000' };
    expect(inferOwn(edited, { base: DARK, light: LIGHT, dark: DARK })).toContain('brand-hover');
  });
});
