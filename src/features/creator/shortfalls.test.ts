import { describe, expect, it } from 'vitest';
import {
  type ChoicePrompt,
  type DerivedSheet,
  newCharacterDoc,
  type SpellcastingBlock,
} from '@/engine/types';
import { shortfallWords, spellShortfalls, subraceMissing } from './shortfalls';

const elf = { name: 'Elf', source: 'PHB' };
const high = { name: 'High', source: 'PHB', raceName: 'Elf', raceSource: 'PHB' };
const humanBase = { source: 'PHB', raceName: 'Human', raceSource: 'PHB' };
const variant = { name: 'Variant', source: 'PHB', raceName: 'Human', raceSource: 'PHB' };

describe('subraceMissing', () => {
  it('needs a subrace for a race whose every subrace has a name', () => {
    const doc = newCharacterDoc('a', 'A', 't');
    doc.race = elf;
    expect(subraceMissing(doc, [high], [high])).toBe(true);
    doc.subrace = { name: 'High', source: 'PHB' };
    expect(subraceMissing(doc, [high], [high])).toBe(false);
  });

  it('does not for a race with a nameless base entry, or none offered', () => {
    const doc = newCharacterDoc('a', 'A', 't');
    doc.race = { name: 'Human', source: 'PHB' };
    expect(subraceMissing(doc, [humanBase, variant], [variant])).toBe(false);
    doc.race = { name: 'Orc', source: 'PHB' };
    expect(subraceMissing(doc, [], [])).toBe(false);
  });

  it('does not for subraces that name the race alone, with no printing', () => {
    const doc = newCharacterDoc('a', 'A', 't');
    doc.race = elf;
    const homebrew = { name: 'Moon', source: 'HB', raceName: 'Elf' };
    expect(subraceMissing(doc, [homebrew], [homebrew])).toBe(false);
  });
});

const block = (b: Partial<SpellcastingBlock>): SpellcastingBlock =>
  ({ classUid: 'mage|tst', className: 'Mage', mode: 'prepared', ...b }) as SpellcastingBlock;

describe('spellShortfalls', () => {
  const levels: Record<string, number> = { spark: 0, bolt: 1 };
  const levelOf = (r: { name: string }) => levels[r.name];

  it('counts cantrips and prepared spells left, only for a class short of some', () => {
    const doc = newCharacterDoc('a', 'A', 't');
    doc.spellcasting = {
      'mage|tst': { known: [{ name: 'spark', source: 'TST' }], prepared: [] },
      'bard|tst': { known: [{ name: 'bolt', source: 'TST' }], prepared: [] },
    };
    const sheet = {
      spellcasting: [
        block({ cantripsKnown: 3, preparedMax: 2 }),
        block({ classUid: 'bard|tst', className: 'Bard', mode: 'known', spellsKnownMax: 1 }),
      ],
      pending: [],
    } as unknown as DerivedSheet;
    expect(spellShortfalls(doc, sheet, levelOf)).toEqual([
      { className: 'Mage', cantrips: 2, spells: 2 },
    ]);
  });

  it("leaves out a known caster's own spell picks, which the engine prompt asks for", () => {
    const doc = newCharacterDoc('a', 'A', 't');
    doc.spellcasting = { 'bard|tst': { known: [], prepared: [] } };
    const spellPick = (id: string, levels: number[], count: number): ChoicePrompt => ({
      id,
      origin: { label: 'Bard', uid: 'bard|tst', type: 'class' },
      kind: 'spell',
      label: id,
      count,
      options: [],
      spellQuery: { levels, classes: [], schools: [], ritual: false, attacks: [] },
    });
    // Two leveled picks, one of them made already; a cantrip pick takes no place.
    doc.choices = { 'class:bard|tst:known:10:0': ['bolt|tst'] };
    const sheet = {
      spellcasting: [
        block({ classUid: 'bard|tst', className: 'Bard', mode: 'known', spellsKnownMax: 4 }),
      ],
      pending: [
        spellPick('class:bard|tst:known:10:0', [1, 2, 3], 2),
        spellPick('class:bard|tst:known:10:1', [0], 1),
      ],
    } as unknown as DerivedSheet;
    expect(spellShortfalls(doc, sheet, levelOf)).toEqual([
      { className: 'Bard', cantrips: 0, spells: 3 },
    ]);
  });

  it('words a shortfall', () => {
    expect(shortfallWords({ className: 'Mage', cantrips: 2, spells: 1 })).toBe(
      '2 cantrips and 1 spell',
    );
    expect(shortfallWords({ className: 'Mage', cantrips: 0, spells: 3 })).toBe('3 spells');
  });
});
