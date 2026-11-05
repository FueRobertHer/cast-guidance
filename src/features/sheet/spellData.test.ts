import { describe, expect, it } from 'vitest';
import { distinctGrants } from './spellData';

const grant = (origin: string, usage: string | undefined, resourceKey?: string) => ({
  name: 'fake ward',
  source: 'HB',
  origin,
  usage,
  resourceKey,
});

describe('distinctGrants', () => {
  it('keeps the always-prepared row of a spell with a free-use row beside it', () => {
    expect(distinctGrants([grant('Sigil', 'prepared'), grant('Sigil', '1/day', 'k')])).toEqual([
      grant('Sigil', 'prepared'),
    ]);
  });

  it('keeps a row for each origin', () => {
    const rows = [grant('Sigil', '1/day', 'a'), grant('Wand', '1/day', 'b')];
    expect(distinctGrants(rows)).toEqual(rows);
  });
});
