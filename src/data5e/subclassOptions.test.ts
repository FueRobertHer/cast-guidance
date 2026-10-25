// GAME-009: a 2024 character's subclass picker listed each legacy subclass
// beside the printing that replaces it ("Champion" twice, "Life Domain" twice),
// with nothing to say which was which.
import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import { normalizeDataset } from './normalize';
import { subclassOptions } from './subclassOptions';

const fighterXphb = { name: 'Fighter', source: 'XPHB' };
const names = (list: Entity[]) => list.map((e) => `${String(e.name)}|${String(e.source)}`);

/**
 * The shape the pinned data has: the legacy Champion, a copy of it onto the
 * 2024 Fighter that keeps its `reprintedAs` through `_preserve`, the 2024
 * Champion, and a legacy subclass with no 2024 printing.
 */
function fighterRegistry() {
  const subclass = [
    {
      name: 'Champion',
      shortName: 'Champion',
      source: 'PHB',
      className: 'Fighter',
      classSource: 'PHB',
      edition: 'classic',
      reprintedAs: ['Champion|Fighter|XPHB|XPHB'],
    },
    {
      name: 'Arcane Archer',
      shortName: 'Arcane Archer',
      source: 'XGE',
      className: 'Fighter',
      classSource: 'PHB',
    },
    {
      name: 'Champion',
      source: 'PHB',
      className: 'Fighter',
      classSource: 'XPHB',
      _copy: {
        name: 'Champion',
        source: 'PHB',
        className: 'Fighter',
        classSource: 'PHB',
        _preserve: { reprintedAs: true },
      },
    },
    {
      name: 'Arcane Archer',
      source: 'XGE',
      className: 'Fighter',
      classSource: 'XPHB',
      _copy: { name: 'Arcane Archer', source: 'XGE', className: 'Fighter', classSource: 'PHB' },
    },
    {
      name: 'Champion',
      shortName: 'Champion',
      source: 'XPHB',
      className: 'Fighter',
      classSource: 'XPHB',
      edition: 'one',
    },
  ];
  return normalizeDataset(new Map([['class/class-fighter.json', { subclass }]]));
}

describe('subclassOptions', () => {
  it('lists one printing per subclass for a 2024 character, through the copies the data makes', () => {
    const reg = fighterRegistry();
    expect(names(subclassOptions(reg.byType('subclass'), fighterXphb, '2024'))).toEqual([
      // A legacy subclass with no 2024 printing is a valid carry-over.
      'Arcane Archer|XGE',
      'Champion|XPHB',
    ]);
  });

  it('keeps the legacy printing a character already holds', () => {
    const reg = fighterRegistry();
    const held = { name: 'Champion', source: 'PHB' };
    expect(names(subclassOptions(reg.byType('subclass'), fighterXphb, '2024', held))).toEqual([
      'Champion|PHB',
      'Arcane Archer|XGE',
      'Champion|XPHB',
    ]);
  });

  it('lists only the class it was asked about, matching names case-insensitively', () => {
    const reg = fighterRegistry();
    const fighterPhb = { name: 'fighter', source: 'phb' };
    expect(names(subclassOptions(reg.byType('subclass'), fighterPhb, '2014'))).toEqual([
      'Champion|PHB',
      'Arcane Archer|XGE',
    ]);
  });

  it('lists 2014 printings for a 2014 character, and a held 2024 pick', () => {
    const reg = fighterRegistry();
    expect(names(subclassOptions(reg.byType('subclass'), fighterXphb, '2014'))).toEqual([
      'Champion|PHB',
      'Arcane Archer|XGE',
    ]);
    const held = { name: 'Champion', source: 'XPHB' };
    expect(names(subclassOptions(reg.byType('subclass'), fighterXphb, '2014', held))).toEqual([
      'Champion|PHB',
      'Arcane Archer|XGE',
      'Champion|XPHB',
    ]);
  });

  it('does not throw on rows whose fields are not text', () => {
    const odd: Entity[] = [
      { name: 'Odd', source: 'HB', className: 42, classSource: null, reprintedAs: 'x' },
      { name: 'Ok', source: 'HB', className: 'Fighter', classSource: 'XPHB', shortName: 7 },
    ];
    expect(names(subclassOptions(odd, fighterXphb, '2024'))).toEqual(['Ok|HB']);
  });
});
