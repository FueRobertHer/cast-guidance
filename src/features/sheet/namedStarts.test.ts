import { describe, expect, it } from 'vitest';
import type { D20Test } from '@/engine/conditions';
import { recklessAttackEffect } from '@/engine/curated/namedEffects';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { recklessStart } from './namedStarts';

/** A barbarian in the printing given, or a character with no Barbarian class. */
function character(source: 'PHB' | 'XPHB' | null, rulesVersion: '2014' | '2024' = '2014') {
  const doc: CharacterDoc = newCharacterDoc('c1', 'Hild', 'v0');
  doc.rulesVersion = rulesVersion;
  doc.classes =
    source === null
      ? [{ ref: { name: 'Fighter', source: 'PHB' }, levels: 5, hp: [] }]
      : [{ ref: { name: 'Barbarian', source }, levels: 5, hp: [] }];
  return doc;
}

const swing: D20Test = { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' };
const thrown: D20Test = { ...swing, range: 'ranged' };

describe('recklessStart', () => {
  it("offers 2014 Reckless Attack on a Strength melee attack, with that printing's cost and effect", () => {
    const start = recklessStart(character('PHB'), true, [], swing);
    expect(start).toMatchObject({
      name: 'Reckless Attack',
      mode: 'adv',
      cost: 'Attack rolls against you have advantage until your next turn',
    });
    expect(start?.build('r1')).toEqual(recklessAttackEffect('r1', '2014'));
    expect(recklessStart(character('PHB'), true, [], thrown)).toBeUndefined();
  });

  it('reads an XPHB barbarian as 2024: a thrown Strength attack too, until the start of the next turn', () => {
    const start = recklessStart(character('XPHB', '2024'), true, [], thrown);
    expect(start?.cost).toBe(
      'Attack rolls against you have advantage until the start of your next turn',
    );
    expect(start?.build('r1')).toEqual(recklessAttackEffect('r1', '2024'));
  });

  it("goes by the barbarian's printing, else the character's rules version", () => {
    // A PHB barbarian on a 2024 character keeps the 2014 rules: melee only.
    expect(recklessStart(character('PHB', '2024'), true, [], thrown)).toBeUndefined();
    // The feature with no Barbarian class (homebrew) follows the character.
    expect(recklessStart(character(null, '2024'), true, [], thrown)).toBeDefined();
    expect(recklessStart(character(null, '2014'), true, [], thrown)).toBeUndefined();
  });

  it('is offered only with the feature, before the action is spent, and not while it is in play', () => {
    expect(recklessStart(character('PHB'), false, [], swing)).toBeUndefined();
    const spent = character('PHB');
    spent.play.turn = { action: true, bonus: false, reaction: false };
    expect(recklessStart(spent, true, [], swing)).toBeUndefined();
    // In play with the action box cleared by hand: offering it again would add a second.
    const inPlay = [recklessAttackEffect('r1', '2014')];
    expect(recklessStart(character('PHB'), true, inPlay, swing)).toBeUndefined();
    // Switched off still counts as declared this turn.
    const off = [{ ...recklessAttackEffect('r1', '2014'), off: true }];
    expect(recklessStart(character('PHB'), true, off, swing)).toBeUndefined();
  });

  it('is not offered on a spell attack or a Dexterity attack', () => {
    const doc = character('XPHB', '2024');
    expect(recklessStart(doc, true, [], { kind: 'attack', attack: 'spell' })).toBeUndefined();
    expect(recklessStart(doc, true, [], { ...swing, ability: 'dex' })).toBeUndefined();
  });
});
