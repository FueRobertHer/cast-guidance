/**
 * A stored `spellListAdd` (ADR-002 D7): a feat, an item or a species adds
 * spells to every spellcasting class's list, or with `className` to one
 * class's, as the spell picker reads it (`expandedListMatcher`). The feat is
 * invented; Mage and Pactcaster are the fixture's casters.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { expandedListMatcher } from '../../features/sheet/expandedSpells';
import { deriveSheet } from '../derive';
import { readMechanics } from '../effects/mechanics';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

const feat = (effect: Record<string, unknown>): DataEntity => ({
  name: 'Lamp Lore',
  source: 'HB',
  entries: ['You learn the lamps.'],
  castGuidance: { v: 1, effects: [effect] },
});

function sheetWith(effect: Record<string, unknown>) {
  const base = makeTestContext();
  const entry = feat(effect);
  const ctx: EngineContext = {
    byType: (t) => (t === 'feat' ? [...base.byType(t), entry] : base.byType(t)),
    get: (t, n, s) => (t === 'feat' && n === 'Lamp Lore' ? entry : base.get(t, n, s)),
  };
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.classes = [
    { ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
    { ref: { name: 'Pactcaster', source: 'TST' }, levels: 2, hp: ['avg', 'avg'] },
  ];
  doc.feats = [{ ref: { name: 'Lamp Lore', source: 'HB' }, instanceId: 'one' }];
  return deriveSheet(doc, ctx);
}

/** What each block's picker says adds the spell, by the block's class. */
function addedBy(effect: Record<string, unknown>, spell: DataEntity) {
  const sheet = sheetWith(effect);
  return Object.fromEntries(
    sheet.spellcasting.map((b) => [
      b.className,
      expandedListMatcher(b.expanded, () => false)(spell),
    ]),
  );
}

const FIREBALL: DataEntity = { name: 'Fireball', source: 'XPHB', level: 3 };

describe('a stored spellListAdd', () => {
  it('reads spells by name, any printing, with no problem', () => {
    const read = readMechanics({
      v: 1,
      effects: [{ kind: 'spellListAdd', spells: ['Fireball', 'shield|xphb'], className: 'Mage' }],
    });
    expect(read.problems).toEqual([]);
    expect(read.effects.map((t) => t.effect)).toEqual([
      { kind: 'spellListAdd', spells: ['Fireball', 'shield'], filters: [], className: 'Mage' },
    ]);
  });

  it("adds to every spellcasting class's list when it names no class", () => {
    expect(addedBy({ kind: 'spellListAdd', spells: ['fireball'] }, FIREBALL)).toEqual({
      Mage: 'Lamp Lore',
      Pactcaster: 'Lamp Lore',
    });
  });

  it("adds to the named class's list alone, in any case", () => {
    expect(
      addedBy({ kind: 'spellListAdd', spells: ['Fireball'], className: 'pactcaster' }, FIREBALL),
    ).toEqual({
      Mage: undefined,
      Pactcaster: 'Lamp Lore',
    });
  });

  it("refuses the data's own spell filters, and a list with no spell", () => {
    const problems = (effect: Record<string, unknown>) =>
      readMechanics({ v: 1, effects: [effect] }).problems;
    expect(
      problems({ kind: 'spellListAdd', spells: ['Fireball'], filters: ['level=1|class=Wizard'] }),
    ).toEqual([expect.stringMatching(/"filters"/)]);
    expect(problems({ kind: 'spellListAdd', spells: [] })).toEqual([
      expect.stringMatching(/"spells" is a list/),
    ]);
  });
});
