import { describe, expect, it } from 'vitest';
import { sheetTab, tabRolls } from './SheetLayout';

const base = '/c/996e8de4';

describe('sheetTab', () => {
  it('reads the empty segment on the index route (Play)', () => {
    expect(sheetTab(base, base)).toBe('');
    expect(sheetTab(base, `${base}/`)).toBe('');
  });

  it('reads the child segment on every other tab', () => {
    for (const tab of ['stats', 'inventory', 'spells', 'features', 'build']) {
      expect(sheetTab(base, `${base}/${tab}`), tab).toBe(tab);
    }
  });
});

describe('tabRolls', () => {
  it('keeps the dice cluster on the two tabs that roll', () => {
    expect(tabRolls(sheetTab(base, base))).toBe(true);
    expect(tabRolls(sheetTab(base, `${base}/stats`))).toBe(true);
  });

  it('drops it everywhere else', () => {
    for (const tab of ['inventory', 'spells', 'features', 'build']) {
      expect(tabRolls(sheetTab(base, `${base}/${tab}`)), tab).toBe(false);
    }
  });
});
