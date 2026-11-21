import { describe, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type DerivedSheet, newCharacterDoc, type SpellcastingBlock } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
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

  it('words a shortfall', () => {
    expect(shortfallWords({ className: 'Mage', cantrips: 2, spells: 1 })).toBe(
      '2 cantrips and 1 spell',
    );
    expect(shortfallWords({ className: 'Mage', cantrips: 0, spells: 3 })).toBe('3 spells');
  });
});

// A class that learns spells of its own (a 2014 Bard's Magical Secrets): the
// engine asks for each pick, and once made it takes a place in spells known.
describe("spellShortfalls beside a class's own spell picks", () => {
  const ctx = makeTestContext();
  const filter = { choose: 'level=1;2;3' };
  const known = (picks: unknown[]) => {
    const world: typeof ctx = {
      ...ctx,
      get: (type, name, source) => {
        const found = ctx.get(type, name, source);
        if (found === undefined || type !== 'class' || name !== 'Warrior') return found;
        return {
          ...found,
          casterProgression: 'full',
          spellcastingAbility: 'wis',
          spellsKnownProgression: Array.from({ length: 20 }, (_, i) => i + 2),
          additionalSpells: [{ name: 'Fake Secrets', known: { 3: picks } }],
        };
      },
    };
    return world;
  };
  const doc = () => {
    const d = newCharacterDoc('w', 'W', 't');
    d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: Array(5).fill('avg') }];
    d.spellcasting = { 'warrior|tst': { known: [], prepared: [] } };
    return d;
  };
  const short = (d: ReturnType<typeof doc>, world = known([filter, filter])) => {
    const sheet = deriveSheet(d, world);
    return {
      max: sheet.spellcasting[0]?.spellsKnownMax,
      ids: sheet.pending.filter((p) => p.kind === 'spell').map((p) => p.id),
      spells: spellShortfalls(d, sheet, () => 1)[0]?.spells,
    };
  };

  it('leaves out the picks the engine already asks for, made or not', () => {
    const none = short(doc());
    expect(none.ids).toHaveLength(2);
    // Six known, two of them the prompts' own.
    expect(none).toMatchObject({ max: 6, spells: 4 });
    const one = doc();
    one.choices[none.ids[0] ?? ''] = ['Fake One|TST'];
    // A made pick takes its place, and its prompt is no longer pending.
    expect(short(one)).toMatchObject({ max: 5, spells: 4 });
  });

  it('still counts a pick the engine does not grant, as a repeat', () => {
    const pairs = known([{ ...filter, count: 2 }]);
    const none = short(doc(), pairs);
    expect(none).toMatchObject({ max: 6, spells: 4 });
    const twice = doc();
    twice.choices[none.ids[0] ?? ''] = ['Fake One|TST', 'Fake One|TST'];
    // One granted, and the prompt still asks for the other.
    expect(short(twice, pairs)).toMatchObject({ max: 5, spells: 4 });
  });
});
