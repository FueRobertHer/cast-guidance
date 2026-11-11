// Inspiration, which any character may hold: what spending it does under each
// edition's rules, as the derived sheet's roll riders say it, and the pool a
// foretelling feature keeps its numbers in.
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { deriveSheet } from './derive';
import { rollEffects } from './playRules';
import { newCharacterDoc } from './types';

const sheetFor = (rulesVersion: '2014' | '2024') => {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.rulesVersion = rulesVersion;
  return deriveSheet(doc, makeTestContext());
};
const D20_TESTS = { rolls: ['attack', 'check', 'save'] };

describe('Inspiration on the roll riders', () => {
  it('rerolls one die, the lowest, under the 2024 rules: Heroic Inspiration', () => {
    const riders = sheetFor('2024').rollRiders.filter((r) => /Inspiration/.test(r.origin));
    expect(riders).toEqual([
      {
        kind: 'reroll',
        on: D20_TESTS,
        origin: 'Heroic Inspiration',
        die: 'one',
        atMost: 20,
        inspiration: true,
      },
    ]);
    // Every d20 test the sheet rolls with a prompt, initiative too.
    for (const test of [
      { kind: 'attack' },
      { kind: 'check', ability: 'dex' },
      { kind: 'save', ability: 'wis' },
      { kind: 'initiative' },
    ] as const) {
      expect(rollEffects(sheetFor('2024'), test).rerolls).toEqual([
        { source: 'Heroic Inspiration', die: 'one', atMost: 20, inspiration: true },
      ]);
    }
  });

  it('gives advantage under the 2014 rules, claimed before the roll', () => {
    const riders = sheetFor('2014').rollRiders.filter((r) => /Inspiration/.test(r.origin));
    expect(riders).toEqual([
      { kind: 'paid', on: D20_TESTS, origin: 'Inspiration', advantage: true, inspiration: true },
    ]);
  });

  it('reaches no death save, which takes only what names it', () => {
    const death = { kind: 'save', purpose: 'death' } as const;
    expect(rollEffects(sheetFor('2014'), death).paid).toBeUndefined();
  });
});
