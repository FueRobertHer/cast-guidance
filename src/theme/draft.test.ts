// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { THEMES_CSS_PATH } from '../../tests-fixtures/themeCss';
import {
  commit,
  DRAFT_KEY,
  type Draft,
  draftFile,
  draftFromBuiltIn,
  draftFromTheme,
  draftTokens,
  dropKeptDraft,
  keepDraft,
  readKeptDraft,
  resetToken,
  sameDraft,
  setBase,
  setToken,
  shown,
  startHistory,
  tablesFrom,
  undo,
} from './draft';
import { parseThemeFile } from './file';

const tables = tablesFrom(readFileSync(THEMES_CSS_PATH, 'utf8'));

function edit(draft: Draft, name: string, raw: unknown): Draft {
  const result = setToken(draft, tables, name, raw);
  if ('error' in result) throw new Error(result.error);
  return result.draft;
}

beforeEach(() => localStorage.clear());

describe('a theme being made', () => {
  it('starts from a built-in as a copy, with nothing set', () => {
    const d = draftFromBuiltIn('parchment');
    expect(d).toEqual({ name: 'Parchment copy', author: '', base: 'parchment', own: {} });
    expect(draftTokens(d, tables)).toEqual({});
    expect(shown(d, tables, 'bg')).toEqual({ value: '#e9dfc6', how: 'base' });
  });

  it('shows a token set by hand, one that follows, and an alias', () => {
    const d = edit(draftFromBuiltIn('dark'), 'brand', '#5EE0C8');
    expect(shown(d, tables, 'brand')).toEqual({ value: '#5ee0c8', how: 'own' });
    expect(shown(d, tables, 'brand-hover')).toMatchObject({ how: 'follows', follows: 'brand' });
    // `roll` is `brand` in every built-in: it follows at runtime, never written.
    expect(shown(d, tables, 'roll')).toEqual({
      value: '#5ee0c8',
      how: 'follows',
      follows: 'brand',
    });
    expect(draftTokens(d, tables)).not.toHaveProperty('roll');
  });

  it('writes a valid file, with the following values plain in it', () => {
    let d = edit(draftFromBuiltIn('dark'), 'bg', '#f4f0e8');
    d = edit(d, 'font-display', 'alegreya');
    d = { ...d, name: '  Dawn\u0000 ', author: 'Vela' };
    const file = draftFile(d, tables);
    expect(file).toMatchObject({
      castGuidanceTheme: 1,
      name: 'Dawn',
      author: 'Vela',
      base: 'dark',
    });
    expect(file.tokens['ink-muted']).toMatch(/^#[0-9a-f]{6}$/);
    const back = parseThemeFile(JSON.parse(JSON.stringify(file)));
    expect(back.ok && back.theme.dropped).toEqual([]);
  });

  it('refuses an entry a file would refuse, and says why', () => {
    const d = draftFromBuiltIn('dark');
    expect(setToken(d, tables, 'bg', '#12345')).toEqual({ error: 'not #rrggbb' });
    expect(setToken(d, tables, 'bg', '#00000080')).toEqual({ error: 'must be opaque' });
    expect(setToken(d, tables, 'radius-card', '60px')).toEqual({ error: 'outside 0 to 48px' });
  });

  it('keeps the selected edge wider than the resting one, against the base too', () => {
    const d = draftFromBuiltIn('dark');
    expect(setToken(d, tables, 'border', '2px')).toEqual({
      error: 'The selected edge must be wider than the resting one.',
    });
    const wider = edit(edit(d, 'border-strong', '3px'), 'border', '2px');
    expect(wider.own).toEqual({ 'border-strong': '3px', border: '2px' });
  });

  it('hands a token back, and keeps what was set by hand across a new base', () => {
    let d = edit(draftFromBuiltIn('dark'), 'brand', '#5ee0c8');
    d = setBase(d, 'contrast');
    expect(d.own).toEqual({ brand: '#5ee0c8' });
    expect(shown(d, tables, 'bg')).toEqual({ value: '#000000', how: 'base' });
    d = resetToken(d, 'brand');
    expect(d.own).toEqual({});
    expect(shown(d, tables, 'brand-hover').how).toBe('base');
  });

  it('opens a saved theme with its hand-set list, or works the list out', () => {
    const made = edit(draftFromBuiltIn('dark'), 'brand', '#5ee0c8');
    const file = draftFile(made, tables);
    expect(draftFromTheme(file, tables, ['brand']).own).toEqual({ brand: '#5ee0c8' });
    // An imported file: what is not what following gives was set by hand.
    expect(Object.keys(draftFromTheme(file, tables).own)).toEqual(['brand']);
    // And following goes on from there: a new brand moves its hover again.
    const reopened = edit(draftFromTheme(file, tables), 'brand', '#ff00aa');
    expect(shown(reopened, tables, 'brand-hover').how).toBe('follows');
  });

  it('takes back changes one at a time', () => {
    const start = draftFromBuiltIn('dark');
    let h = startHistory(start);
    h = commit(h, edit(h.present, 'bg', '#000000'));
    h = commit(h, edit(h.present, 'ink', '#ffffff'));
    // A change that changes nothing is not one to take back.
    h = commit(h, h.present);
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.own).toEqual({ bg: '#000000' });
    h = undo(undo(h));
    expect(sameDraft(h.present, start)).toBe(true);
  });

  it('is kept on the device for the theme it edits, and read back checked', () => {
    const d = edit(draftFromBuiltIn('modern'), 'brand', '#5ee0c8');
    keepDraft('abc', d);
    expect(readKeptDraft('abc')).toEqual(d);
    expect(readKeptDraft(null)).toBeNull();
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        v: 1,
        target: null,
        draft: { ...d, own: { bg: 'url(x)', glow: '#fff', ink: '#abc' } },
      }),
    );
    expect(readKeptDraft(null)?.own).toEqual({ ink: '#aabbcc' });
    dropKeptDraft();
    expect(readKeptDraft(null)).toBeNull();
  });
});
