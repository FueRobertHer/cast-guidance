import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rawTokens, THEMES_CSS_PATH, themeRules } from '../../tests-fixtures/themeCss';
import { BUILT_IN_THEMES } from './builtins';
import {
  builtInFile,
  checkToken,
  cleanText,
  parseThemeFile,
  parseThemeText,
  type ThemeFile,
  themeKey,
  themePageColour,
  themeScheme,
  themeVars,
} from './file';
import { fontId } from './fonts';
import { MAX_THEME_BYTES } from './link';

const file = (tokens: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  castGuidanceTheme: 1,
  name: 'Test',
  base: 'dark',
  tokens,
  ...extra,
});

function parsed(input: unknown) {
  const result = parseThemeFile(input);
  if (!result.ok) throw new Error(result.reason);
  return result.theme;
}

const value = (name: string, raw: unknown) => {
  const r = checkToken(name, raw);
  return 'value' in r ? r.value : `error: ${r.error}`;
};

describe('reading a theme file', () => {
  it('takes a short file, filling the rest from its base', () => {
    const { file: f, dropped } = parsed(file({ bg: '#101418' }));
    expect(f).toEqual({
      castGuidanceTheme: 1,
      name: 'Test',
      base: 'dark',
      tokens: { bg: '#101418' },
    });
    expect(dropped).toEqual([]);
  });

  it('refuses what is not a theme, and a theme from a newer version', () => {
    for (const input of [null, [], 'x', {}, { castGuidanceTheme: '1' }, { castGuidanceTheme: 0 }]) {
      expect(parseThemeFile(input).ok, JSON.stringify(input)).toBe(false);
    }
    const newer = parseThemeFile({ ...file({}), castGuidanceTheme: 2 });
    expect(newer).toEqual({ ok: false, reason: expect.stringMatching(/newer version/) });
    expect(parseThemeText('{"castGuidanceTheme": 1,').ok).toBe(false);
    expect(parseThemeText(' '.repeat(MAX_THEME_BYTES + 1)).ok).toBe(false);
    expect(parseThemeText(JSON.stringify(file({}))).ok).toBe(true);
  });

  it('draws a theme on Dark when its base is not a built-in here, and says so', () => {
    const { file: f, dropped } = parsed(file({}, { base: 'sepia' }));
    expect(f.base).toBe('dark');
    expect(dropped).toEqual([expect.stringMatching(/^base sepia/)]);
  });

  it('drops what is not a token, and keeps the rest', () => {
    const { file: f, dropped } = parsed(file({ bg: '#000', glow: '#fff', 'ink-muted': 7 }));
    expect(f.tokens).toEqual({ bg: '#000000' });
    expect(dropped).toEqual(['glow (not a theme token)', 'ink-muted: 7 (not a colour)']);
    expect(parsed(file({}, { tokens: ['bg'] })).file.tokens).toEqual({});
  });

  it('writes colours out in lowercase, and keeps the page opaque', () => {
    expect(value('ink', '#ABC')).toBe('#aabbcc');
    expect(value('ink', '#AbCdEf80')).toBe('#abcdef80');
    expect(value('scrim', '#0008')).toBe('#00000088');
    expect(value('edge', 'transparent')).toBe('transparent');
    expect(value('bg', '#101418ff')).toBe('#101418');
    expect(value('bg', '#10141880')).toBe('error: must be opaque');
    expect(value('bg', 'transparent')).toBe('error: must be opaque');
    for (const bad of ['red', 'rgb(0,0,0)', '#12345', 'url(x)', 12]) {
      expect(value('ink', bad), String(bad)).toMatch(/^error/);
    }
  });

  it('takes fonts by id from the bundled list', () => {
    expect(value('font-sans', 'Inter')).toBe('inter');
    expect(value('font-display', 'alegreya')).toBe('alegreya');
    expect(value('font-sans', 'Comic Sans MS')).toBe('error: not a bundled font');
    // A capitals face reads as a title, not as a page.
    expect(value('font-display', 'Cinzel')).toBe('cinzel');
    expect(value('font-sans', 'cinzel')).toBe('error: a font for titles only');
    expect(value('font-sans', 'im-fell-english')).toBe('error: a font for titles only');
    expect(value('font-sans', 'lexend')).toBe('lexend');
    expect(value('font-sans', '"Inter", sans-serif')).toMatch(/^error/);
  });

  it('takes weights from 300 to 800 in hundreds', () => {
    expect(value('weight-bold', 800)).toBe(800);
    expect(value('weight-normal', '300')).toBe(300);
    for (const bad of [200, 900, 450, 'bold', 600.5]) {
      expect(value('weight-bold', bad), String(bad)).toMatch(/^error/);
    }
  });

  it('takes corners from 0 to 48px, in px or rem, or full', () => {
    expect(value('radius-card', '6px')).toBe('6px');
    expect(value('radius-card', '0.5rem')).toBe('8px');
    expect(value('radius-card', 12)).toBe('12px');
    expect(value('radius-pill', 'FULL')).toBe('full');
    expect(value('radius-card', '0')).toBe('0px');
    for (const bad of ['49px', '-1px', '3em', '50%']) {
      expect(value('radius-card', bad), bad).toMatch(/^error/);
    }
  });

  it('keeps the selected edge wider than the resting one', () => {
    expect(value('border', '3px')).toBe('3px');
    expect(value('border', '4px')).toMatch(/^error/);
    expect(value('border-strong', '0.5px')).toMatch(/^error/);
    // The selected edge goes first; the resting one too if it still is not narrower.
    const both = parsed(file({ border: '3px', 'border-strong': '2px' }));
    expect(both.file.tokens).toEqual({});
    expect(both.dropped).toEqual([
      expect.stringMatching(/^border-strong: 2px \(the selected edge/),
      expect.stringMatching(/^border: 3px \(the selected edge/),
    ]);
    expect(parsed(file({ border: '2px', 'border-strong': '2px' })).file.tokens).toEqual({});
    expect(parsed(file({ border: '1px', 'border-strong': '1px' })).file.tokens).toEqual({
      border: '1px',
    });
    // Against the base's own: Dark's selected edge is 2px, High contrast's resting 2px.
    expect(parsed(file({ border: '2px' })).file.tokens).toEqual({});
    expect(parsed(file({ 'border-strong': '2px' }, { base: 'contrast' })).file.tokens).toEqual({});
    expect(parsed(file({ border: '2px', 'border-strong': '3px' })).file.tokens).toEqual({
      border: '2px',
      'border-strong': '3px',
    });
  });

  it('takes an icon stroke from 1 to 3', () => {
    expect(value('icon-stroke', 1.5)).toBe(1.5);
    expect(value('icon-stroke', '2.25')).toBe(2.25);
    for (const bad of [0.5, 3.5, 'thick', '']) {
      expect(value('icon-stroke', bad), String(bad)).toMatch(/^error/);
    }
  });

  it('takes title tracking from -0.05 to 0.2em, written in em', () => {
    expect(value('tracking-display', '0.12em')).toBe('0.12em');
    expect(value('tracking-display', 0.1)).toBe('0.1em');
    expect(value('tracking-display', ' -0.05EM ')).toBe('-0.05em');
    expect(value('tracking-display', '0')).toBe('0em');
    for (const bad of [0.25, '-0.06em', '2px', 'wide', '', 'em']) {
      expect(value('tracking-display', bad), String(bad)).toMatch(/^error/);
    }
  });

  it('takes shadows as up to three bounded layers, written out the same way', () => {
    expect(value('shadow-card', 'none')).toBe('none');
    expect(value('shadow-float', '0 6px 16px #00000073, 0 2px 4px #0005')).toBe(
      '0px 6px 16px #00000073, 0px 2px 4px #00000055',
    );
    expect(value('shadow-float', '0 1px 0 0 #ffffff0f inset')).toBe(
      'inset 0px 1px 0px 0px #ffffff0f',
    );
    expect(value('shadow-float', '#000 0 0 0 2px')).toBe('0px 0px 0px 2px #000000');
    for (const bad of [
      '0 1px #000, 0 1px #000, 0 1px #000, 0 1px #000',
      '0 40px 4px #000',
      '0 1px 100px #000',
      '0 1px 2px 20px #000',
      '0 1px 2px',
      '0 #000',
      '0 1px url(x) #000',
      '0 1px 2px red',
    ]) {
      expect(value('shadow-float', bad), bad).toMatch(/^error/);
    }
  });

  it('names a list or an object in what it left out, however deep', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 50_000; i++) deep = [deep];
    const { dropped } = parsed(file({ bg: deep, ink: { a: 1 } }));
    expect(dropped).toEqual(['bg: a list (not a colour)', 'ink: an object (not a colour)']);
  });

  it('keeps names and authors to one plain line of 60 characters', () => {
    expect(cleanText('  Mid\u0000night\n  ✦ ')).toBe('Mid night ✦');
    expect(cleanText('evil‮eman')).toBe('evil eman');
    expect(cleanText('x'.repeat(80))).toHaveLength(60);
    expect(cleanText(42)).toBe('');
    const { file: f } = parsed(file({}, { name: '\u0007', author: '   ' }));
    expect(f.name).toBe('Untitled theme');
    expect(f).not.toHaveProperty('author');
  });
});

describe('drawing a theme file', () => {
  const midnight: ThemeFile = {
    castGuidanceTheme: 1,
    name: 'Midnight',
    base: 'dark',
    tokens: {
      bg: '#f4f0e8',
      'font-display': 'alegreya',
      'radius-pill': 'full',
      'shadow-card': 'none',
      'weight-bold': 800,
    },
  };

  it('sets each token as its custom property, fonts as stacks', () => {
    expect(themeVars(midnight)).toEqual({
      '--cg-bg': '#f4f0e8',
      '--cg-font-display': '"Alegreya", "Literata", Georgia, serif',
      '--cg-radius-pill': 'calc(infinity * 1px)',
      '--cg-shadow-card': '0 0 #0000',
      '--cg-weight-bold': '800',
    });
  });

  it('takes its ground and bar colour from its own page, not its base', () => {
    expect(themeScheme(midnight)).toBe('light');
    expect(themePageColour(midnight)).toBe('#f4f0e8');
    const plain: ThemeFile = { ...midnight, tokens: {} };
    expect(themeScheme(plain)).toBe('dark');
    expect(themePageColour(plain)).toBe('#121110');
    expect(themeScheme({ ...midnight, base: 'light', tokens: { bg: '#202020' } })).toBe('dark');
  });

  it('knows a theme by its content, not its name or the order it was written in', () => {
    const reordered = {
      ...midnight,
      name: 'Other',
      tokens: Object.fromEntries(Object.entries(midnight.tokens).reverse()),
    };
    expect(themeKey(reordered)).toBe(themeKey(midnight));
    expect(themeKey({ ...midnight, base: 'light' })).not.toBe(themeKey(midnight));
  });
});

describe('a built-in theme as a file', () => {
  const css = readFileSync(THEMES_CSS_PATH, 'utf8');
  const rules = themeRules(css);

  it.each(BUILT_IN_THEMES)('exports $label whole, and reads back with nothing dropped', (theme) => {
    const out = builtInFile(theme.id, css);
    expect(out.name).toBe(theme.label);
    expect(out.base).toBe(theme.id);
    const back = parsed(JSON.parse(JSON.stringify(out)));
    expect(back.dropped).toEqual([]);
    expect(back.file.tokens).toEqual(out.tokens);
    // The aliases stay aliases: they follow the role they name.
    for (const alias of ['roll', 'focus', 'meter-mid'])
      expect(out.tokens).not.toHaveProperty(alias);
  });

  it.each(BUILT_IN_THEMES)('draws $label from its file just as themes.css does', (theme) => {
    const raw = rawTokens(theme.id, rules);
    const vars = themeVars(builtInFile(theme.id, css));
    // Each value, read back as a file would hold it, is the theme's own.
    const asFile = (name: string, cssValue: string) =>
      value(
        name,
        name.startsWith('font-')
          ? fontId(cssValue)
          : cssValue === '0 0 #0000'
            ? 'none'
            : /infinity/.test(cssValue)
              ? 'full'
              : cssValue,
      );
    for (const [name, cssValue] of Object.entries(vars)) {
      const token = name.slice('--cg-'.length);
      expect(asFile(token, cssValue), `${theme.id} ${token}`).toEqual(
        asFile(token, raw[token] ?? ''),
      );
    }
    expect(Object.keys(vars).length).toBe(
      Object.values(raw).filter((v) => !v.startsWith('var(')).length,
    );
  });
});
