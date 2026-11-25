import { describe, expect, it } from 'vitest';
import { themeIds, themeTokens } from '../../tests-fixtures/themeCss';
import { BUILT_IN_THEMES } from './builtins';
import { fontFamily, fontId, fontStack, LIBRARY_FONT_GLOBS, THEME_FONTS, themeFont } from './fonts';
import { LIBRARY_FACES } from './libraryFaces';

describe('the fonts a theme may name', () => {
  it('names each once', () => {
    expect(new Set(THEME_FONTS.map((f) => f.id)).size).toBe(THEME_FONTS.length);
  });

  it.each(themeIds())('knows every stack %s draws in, so it exports as ids', (id) => {
    const tokens = themeTokens(id);
    expect(fontId(tokens['font-sans'] ?? '')).toBeDefined();
    expect(fontId(tokens['font-display'] ?? '')).toBeDefined();
  });

  it('offers only weights in hundreds a file accepts', () => {
    for (const f of THEME_FONTS) {
      expect(f.weights.length, f.id).toBeGreaterThan(0);
      for (const w of f.weights)
        expect(w >= 300 && w <= 800 && w % 100 === 0, `${f.id} ${w}`).toBe(true);
    }
  });

  it('reads a stack back to its id whatever its quotes and spacing', () => {
    expect(fontId("'Alegreya','Literata' , Georgia,serif")).toBe('alegreya');
    expect(fontId('"Comic Sans MS", cursive')).toBeUndefined();
    expect(fontStack('inter')).toContain('"Inter Variable"');
    expect(fontStack('papyrus')).toBeUndefined();
  });
});

describe('the font library (fonts the app fetches on first use)', () => {
  const library = THEME_FONTS.filter((f) => f.source === 'library');

  it('lists faces for every library font and no other', () => {
    expect(Object.keys(LIBRARY_FACES).sort()).toEqual(library.map((f) => f.id).sort());
  });

  it.each(library)('has $label’s faces at the weights it offers', (font) => {
    const faces = LIBRARY_FACES[font.id] ?? [];
    if (font.weights.length === 1) {
      // One face drawn at every weight, never thickened by the browser.
      expect(faces.map((f) => f.weight)).toEqual(['300 800']);
    } else {
      expect(faces.map((f) => Number(f.weight))).toEqual(font.weights);
    }
  });

  it.each(library)('keeps $label’s faces out of the precache', (font) => {
    // Vite names an asset by its file, so the glob vite.config.ts leaves out matches it.
    expect(LIBRARY_FONT_GLOBS).toContain(`assets/${font.id}-latin-*`);
    for (const face of LIBRARY_FACES[font.id] ?? []) {
      const file = face.url.split('/').at(-1) ?? '';
      expect(file.startsWith(`${font.id}-latin-`), file).toBe(true);
    }
  });

  it('leaves the app’s own faces in the precache', () => {
    const own = ['atkinson-hyperlegible-next', 'literata', 'alegreya', 'inter'];
    const prefixes = LIBRARY_FONT_GLOBS.map((g) => g.replace(/^assets\//, '').replace(/\*$/, ''));
    expect(own.filter((o) => prefixes.some((p) => `${o}-latin-400-normal`.startsWith(p)))).toEqual(
      [],
    );
  });

  it('keeps capitals and display faces to titles, and every built-in’s text in a text face', () => {
    expect(THEME_FONTS.filter((f) => f.titlesOnly).map((f) => f.id)).toEqual([
      'cinzel',
      'im-fell-english',
    ]);
    for (const theme of BUILT_IN_THEMES) {
      const sans = fontId(themeTokens(theme.id)['font-sans'] ?? '');
      expect(themeFont(sans ?? '')?.titlesOnly, theme.id).toBeFalsy();
    }
  });

  it('names each font’s faces by the first family in its stack', () => {
    const family = (id: string) => {
      const font = themeFont(id);
      return font === undefined ? undefined : fontFamily(font);
    };
    expect(family('eb-garamond')).toBe('EB Garamond');
    expect(family('im-fell-english')).toBe('IM Fell English');
    expect(family('inter')).toBe('Inter Variable');
    expect(family('system')).toBe('system-ui');
  });
});
