/**
 * An effect in play keeps the scope a bonus names (ADR-002 D7): `weaponsOnly`,
 * `weapons` and `className` on an attack bonus, `weaponsOnly` and `weapons` on
 * a damage bonus, `ability` on a spell save DC bonus. A homebrew condition or a
 * potion drunk holds its effects this way (`storedInPlay`), so a field it
 * dropped would reach every attack or caster block.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { readActiveEffects, storedInPlay } from './activeEffects';
import { deriveSheet } from './derive';
import { type ActiveEffect, type DerivedSheet, newCharacterDoc } from './types';

const SCOPED = [
  {
    kind: 'attackBonus',
    scope: 'all',
    amount: 1,
    weaponsOnly: true,
    weapons: ['shortbow'],
    className: 'Mage',
  },
  { kind: 'damageBonus', scope: 'all', amount: 2, weaponsOnly: true, weapons: ['shortbow'] },
  { kind: 'spellDcBonus', amount: 3, ability: 'cha' },
];

describe('storedInPlay keeps the scope a bonus names', () => {
  it('holds every field, with no problem', () => {
    const read = storedInPlay(SCOPED);
    expect(read.problems).toEqual([]);
    expect(read.parts).toEqual(SCOPED);
  });

  it('refuses a weapons list that names no weapon, stored or saved in play', () => {
    const bad = { kind: 'damageBonus', scope: 'all', amount: 2, weapons: [] };
    const read = storedInPlay([bad]);
    expect(read.parts).toEqual([]);
    expect(read.problems).toHaveLength(1);
    const saved = readActiveEffects([{ id: 'fx', name: 'Steady Aim', parts: [bad] }]);
    expect(saved.effects.flatMap((e) => e.parts)).toEqual([]);
    const kept = readActiveEffects([{ id: 'fx', name: 'Steady Aim', parts: SCOPED }]);
    expect(kept.effects.flatMap((e) => e.parts)).toEqual(SCOPED);
  });
});

describe('through the sheet, from play', () => {
  const ctx = makeTestContext();
  const sheet = (parts: ActiveEffect['parts'], classes = ['Warrior']): DerivedSheet => {
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    doc.classes = classes.map((name) => ({ ref: { name, source: 'TST' }, levels: 1, hp: ['avg'] }));
    doc.equipment = [
      { id: 'sword', ref: { name: 'Longsword', source: 'TST' } },
      { id: 'bow', ref: { name: 'Shortbow', source: 'TST' } },
    ].map((e) => ({ ...e, qty: 1, equipped: true, attuned: false })) as typeof doc.equipment;
    doc.play.activeEffects = [{ id: 'fx', name: 'Steady Aim', parts }];
    return deriveSheet(doc, ctx);
  };
  const from = (parts: ReadonlyArray<{ label: string; amount: number }> | undefined) =>
    (parts ?? []).filter((p) => p.label === 'Steady Aim').reduce((n, p) => n + p.amount, 0);
  const flat = (damage: string | undefined) => Number(/[+-]\d+$/.exec(damage ?? '')?.[0] ?? 0);

  it('gives a bonus for some weapons to those alone, never an unarmed strike', () => {
    const parts = storedInPlay(SCOPED.slice(1, 2)).parts;
    const plain = sheet([]);
    const aimed = sheet(parts);
    const gained = ['Longsword', 'Shortbow', 'Unarmed Strike'].map(
      (l) =>
        flat(aimed.attacks.find((a) => a.label === l)?.damage) -
        flat(plain.attacks.find((a) => a.label === l)?.damage),
    );
    expect(gained).toEqual([0, 2, 0]);
  });

  it("gives one class's spell attack and one ability's spell DC to those blocks alone", () => {
    const parts = storedInPlay([
      { kind: 'attackBonus', scope: 'all', amount: 1, attack: 'spell', className: 'Mage' },
      SCOPED[2],
    ]).parts;
    const s = sheet(parts, ['Mage', 'Pactcaster']);
    const block = (c: string) => s.spellcasting.find((b) => b.className === c);
    expect([
      from(block('Mage')?.attackMod.parts),
      from(block('Pactcaster')?.attackMod.parts),
    ]).toEqual([1, 0]);
    expect([from(block('Mage')?.saveDc.parts), from(block('Pactcaster')?.saveDc.parts)]).toEqual([
      0, 3,
    ]);
  });
});
