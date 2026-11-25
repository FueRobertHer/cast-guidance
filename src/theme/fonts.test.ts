import { describe, expect, it } from 'vitest';
import { themeIds, themeTokens } from '../../tests-fixtures/themeCss';
import { fontId, fontStack, THEME_FONTS } from './fonts';

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
