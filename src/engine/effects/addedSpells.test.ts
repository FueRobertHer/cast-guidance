import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type AddedSpell, type CharacterDoc, newCharacterDoc } from '../types';
import { addedSpellPoolKey, addedSpellsOf } from './addedSpells';

const ctx = makeTestContext();

/** A level 5 non-caster with WIS 14. */
function fighter(added: AddedSpell[]): CharacterDoc {
  const doc = newCharacterDoc('f1', 'Brann', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 12, con: 14, int: 10, wis: 14, cha: 8 };
  doc.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: ['avg', 'avg', 'avg', 'avg', 'avg'] },
  ];
  doc.addedSpells = added;
  return doc;
}

describe('added spells', () => {
  it('grants a levelled spell once per long rest, with the ability chosen for it', () => {
    const sheet = deriveSheet(
      fighter([{ spell: { name: 'Searing Bolt', source: 'TST' }, ability: 'wis', uses: 'long' }]),
      ctx,
    );
    const key = addedSpellPoolKey('Searing Bolt');
    expect(sheet.grantedSpells).toEqual([
      {
        name: 'Searing Bolt',
        source: 'TST',
        ability: 'wis',
        usage: '1/day',
        resourceKey: key,
        origin: 'Added by you',
        className: undefined,
        added: true,
      },
    ]);
    expect(sheet.resources.find((r) => r.key === key)).toMatchObject({
      max: 1,
      resetOn: 'long',
      origin: 'Added by you',
    });
  });

  it('refills a short rest spell on a short rest', () => {
    const sheet = deriveSheet(
      fighter([{ spell: { name: 'Searing Bolt', source: 'TST' }, ability: 'int', uses: 'short' }]),
      ctx,
    );
    expect(sheet.grantedSpells[0]?.usage).toBe('1/rest');
    expect(sheet.resources.find((r) => r.key === addedSpellPoolKey('Searing Bolt'))?.resetOn).toBe(
      'short',
    );
  });

  it('casts an at will spell with no pool, and a cantrip at will whatever it was stored with', () => {
    const sheet = deriveSheet(
      fighter([
        { spell: { name: 'Aid', source: 'TST' }, ability: 'cha', uses: 'will' },
        { spell: { name: 'Guidance', source: 'TST' }, ability: 'wis', uses: 'long' },
      ]),
      ctx,
    );
    expect(sheet.grantedSpells.map((g) => [g.name, g.usage, g.resourceKey, g.added])).toEqual([
      ['Aid', undefined, undefined, true],
      ['Guidance', undefined, undefined, true],
    ]);
    expect(sheet.resources.some((r) => r.key.startsWith('spell:added:'))).toBe(false);
  });

  it('marks only added spells as added', () => {
    const doc = fighter([]);
    doc.race = { name: 'Testfolk', source: 'TST' };
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.grantedSpells.length).toBeGreaterThan(0);
    expect(sheet.grantedSpells.every((g) => g.added === undefined)).toBe(true);
  });

  it('keeps an added spell its own row when the build grants the same spell at will', () => {
    // Testfolk knows Guidance at will; one added on top must stay there to be taken off.
    const doc = fighter([
      { spell: { name: 'guidance', source: 'TST' }, ability: 'wis', uses: 'will' },
    ]);
    doc.race = { name: 'Testfolk', source: 'TST' };
    const rows = deriveSheet(doc, ctx).grantedSpells.filter((g) => g.name === 'guidance');
    expect(rows.map((g) => g.added)).toEqual([undefined, true]);
  });

  it('gives spells whose names slug alike pools of their own', () => {
    expect(addedSpellPoolKey('Fire-Bolt')).not.toBe(addedSpellPoolKey('Fire Bolt'));
    expect(addedSpellPoolKey('Огненный шар')).not.toBe(addedSpellPoolKey('Ледяной шар'));
  });

  it('reads a stored list leniently, skipping entries that are not whole', () => {
    const doc = fighter([]);
    (doc as { addedSpells: unknown }).addedSpells = [
      null,
      { spell: { name: '', source: 'TST' }, ability: 'wis', uses: 'long' },
      { spell: { name: 'Aid', source: 'TST' }, ability: 'luck', uses: 'long' },
      { spell: { name: 'Aid', source: 'TST' }, ability: 'wis', uses: 'daily' },
      { spell: { name: 'Aid', source: 'TST' }, ability: 'wis', uses: 'will' },
    ];
    expect(addedSpellsOf(doc)).toEqual([
      { spell: { name: 'Aid', source: 'TST' }, ability: 'wis', uses: 'will' },
    ]);
    expect(addedSpellsOf({})).toEqual([]);
    expect(deriveSheet(doc, ctx).grantedSpells.map((g) => g.name)).toEqual(['Aid']);
  });
});
