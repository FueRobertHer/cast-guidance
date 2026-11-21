// Homebrew files are anyone's JSON, and a file stored before import checks
// tightened is merged on every registry rebuild as it stands. An entry with no
// name has no row the Library can show (it listed as "?") and no identity a
// character can keep, so the merge leaves it out with one warning per file and
// type, whatever the import step checked.
import { describe, expect, it } from 'vitest';
import { type Entity, uidOf } from './copyMod';
import { mergeHomebrew, normalizeDataset } from './normalize';

const OFFICIAL = new Map<string, unknown>([
  ['spells/spells-tst.json', { spell: [{ name: 'Light', source: 'TST', level: 0 }] }],
]);

function merged(files: Record<string, Record<string, unknown>>) {
  const reg = normalizeDataset(OFFICIAL);
  mergeHomebrew(reg, new Map(Object.entries(files)));
  return reg;
}

const names = (list: readonly Entity[]) => list.map((e) => e.name);

describe('homebrew entries with no name', () => {
  it('leaves out an entry whose name is missing, not text, or blank', () => {
    const reg = merged({
      file: {
        spell: [
          { name: 'Spark', source: 'HB', level: 0 },
          { source: 'HB', level: 1 },
          { name: 5, source: 'HB', level: 1 },
          { name: { toString: 1 }, source: 'HB', level: 1 },
          { name: '', source: 'HB', level: 1 },
          { name: '  ', source: 'HB', level: 1 },
          { name: ['Spark'], source: 'HB', level: 1 },
        ],
      },
    });
    expect(names(reg.byType('spell'))).toEqual(['Light', 'Spark']);
    // Every row the Library lists has a name to show.
    expect(reg.byType('spell').every((e) => !uidOf(e).startsWith('?'))).toBe(true);
    expect(reg.warnings).toEqual([
      { entity: 'file', message: 'homebrew spell: 6 entries with no name left out' },
    ]);
  });

  it('keeps a nameless copy, which takes the name of what it copies', () => {
    const reg = merged({
      file: { spell: [{ source: 'HB', _copy: { name: 'Light', source: 'TST' } }] },
    });
    expect(reg.byType('spell').map(uidOf)).toEqual(['light|tst', 'light|hb']);
    expect(reg.warnings).toEqual([]);
  });

  it('leaves out a copy whose _mod sets a name that is not text, or that finds nothing', () => {
    const reg = merged({
      file: {
        spell: [
          { name: 'Glow', source: 'HB', _copy: { name: 'Light', source: 'TST' } },
          {
            name: 'Dim',
            source: 'HB',
            _copy: { name: 'Light', source: 'TST', _mod: { name: { bad: 1 } } },
          },
        ],
        feat: [{ source: 'HB', _copy: { name: 'Nowhere', source: 'HB' } }],
      },
    });
    expect(names(reg.byType('spell'))).toEqual(['Light', 'Glow']);
    expect(reg.byType('feat')).toEqual([]);
    expect(reg.warnings.map((w) => w.message)).toEqual([
      'homebrew feat: unresolved _copy target Nowhere|HB',
      'homebrew feat: 1 entry with no name left out',
      'homebrew spell: 1 entry with no name left out',
    ]);
  });

  it('leaves out a race version whose name is not text', () => {
    const reg = merged({
      file: {
        race: [
          {
            name: 'Kin',
            source: 'HB',
            _versions: [
              { name: 'Kin (Red)', source: 'HB' },
              { name: { red: true }, source: 'HB' },
            ],
          },
        ],
      },
    });
    expect(names(reg.byType('race'))).toEqual(['Kin', 'Kin (Red)']);
    expect(reg.warnings).toEqual([
      { entity: 'file', message: 'homebrew race: 1 entry with no name left out' },
    ]);
  });

  it('leaves out the versions of a nameless race with it', () => {
    // Each would point at a race the registry does not hold.
    const reg = merged({
      file: { race: [{ source: 'HB', _versions: [{ name: 'Kin (Red)', source: 'HB' }] }] },
    });
    expect(reg.byType('race')).toEqual([]);
    expect(reg.warnings).toEqual([
      { entity: 'file', message: 'homebrew race: 1 entry with no name left out' },
    ]);
  });

  it("keeps a nameless subrace, as the books write a race's base lineage", () => {
    const reg = merged({
      file: {
        race: [{ name: 'Kin', source: 'HB' }],
        subrace: [{ source: 'HB', raceName: 'Kin', raceSource: 'HB' }],
      },
    });
    expect(reg.byType('subrace')).toHaveLength(1);
    expect(reg.warnings).toEqual([]);
  });

  it('counts each file apart', () => {
    const reg = merged({
      one: { feat: [{ source: 'HB' }] },
      two: { feat: [{ source: 'HB' }, { source: 'HB' }, { name: 'Tough', source: 'HB' }] },
    });
    expect(names(reg.byType('feat'))).toEqual(['Tough']);
    expect(reg.warnings).toEqual([
      { entity: 'one', message: 'homebrew feat: 1 entry with no name left out' },
      { entity: 'two', message: 'homebrew feat: 2 entries with no name left out' },
    ]);
  });
});
