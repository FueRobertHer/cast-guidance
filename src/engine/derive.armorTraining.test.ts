// Armor worn without training, by the `armorTraining` table rule: as written,
// Disadvantage on Strength and Dexterity rolls and no spellcasting, and in 2024
// no AC from a shield; off, none of it, and the sheet as it was before.
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import type { D20Test } from './conditions';
import { ARMOR_PENALTY_CUE, deriveSheet } from './derive';
import { rollEffects } from './playRules';
import { type CharacterDoc, newCharacterDoc } from './types';

function hero(
  className: 'Mage' | 'Warrior',
  edition: '2014' | '2024',
  worn: string[],
  build?: (doc: CharacterDoc) => void,
): CharacterDoc {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.rulesVersion = edition;
  doc.classes = [{ ref: { name: className, source: 'TST' }, levels: 1, hp: ['avg'] }];
  doc.equipment = worn.map((name, i) => ({
    id: `e${i}`,
    ref: { name, source: 'TST' },
    qty: 1,
    equipped: true,
    attuned: false,
  }));
  build?.(doc);
  return doc;
}

const sheetOf = (doc: CharacterDoc, ctx = makeTestContext()) => deriveSheet(doc, ctx);
const disadvantage = (doc: CharacterDoc, test: D20Test) =>
  rollEffects(sheetOf(doc), test).disadvantage;

describe('untrained armor, as written', () => {
  const mage = hero('Mage', '2024', ['Chain Mail']);
  const origin = 'Untrained armor (Chain Mail)';

  it('says what is worn untrained and what it costs', () => {
    const sheet = sheetOf(mage);
    expect(sheet.untrainedArmor).toEqual([{ id: 'e0', name: 'Chain Mail', category: 'heavy' }]);
    expect(sheet.armorPenalty).toEqual({ origin });
    expect(sheet.cues).toContainEqual({ tone: 'warn', text: ARMOR_PENALTY_CUE, origin });
  });

  it('gives Disadvantage on every Strength and Dexterity roll', () => {
    for (const test of [
      { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' },
      { kind: 'attack', attack: 'weapon', range: 'ranged', ability: 'dex' },
      { kind: 'save', ability: 'str' },
      { kind: 'save', ability: 'dex' },
      { kind: 'check', ability: 'str', skill: 'athletics' },
      { kind: 'check', ability: 'dex' },
      { kind: 'initiative' },
    ] as const) {
      expect(disadvantage(mage, test), JSON.stringify(test)).toContain(origin);
    }
  });

  it('leaves other rolls alone: a spell attack, other saves and checks, a death save', () => {
    for (const test of [
      { kind: 'attack', attack: 'spell', ability: 'int' },
      { kind: 'save', ability: 'wis' },
      { kind: 'check', ability: 'int', skill: 'arcana' },
      { kind: 'save', purpose: 'death' },
    ] as const) {
      expect(disadvantage(mage, test), JSON.stringify(test)).not.toContain(origin);
    }
  });

  it('takes a 2024 shield’s AC away, and says why, without the roll penalty', () => {
    const sheet = sheetOf(hero('Mage', '2024', ['Shield']));
    const bare = sheetOf(hero('Mage', '2024', []));
    expect(sheet.ac.value).toBe(bare.ac.value);
    expect(sheet.acNotCounted).toContainEqual({ label: 'Shield', value: 2, why: 'untrained' });
    expect(sheet.armorPenalty).toBeUndefined();
    expect(sheet.rollRiders).toEqual(bare.rollRiders);
  });

  it('keeps a 2014 shield’s AC, at the cost armor has: shields are armor there', () => {
    const sheet = sheetOf(hero('Mage', '2014', ['Shield']));
    expect(sheet.ac.value).toBe(sheetOf(hero('Mage', '2014', [])).ac.value + 2);
    expect(sheet.armorPenalty).toEqual({ origin: 'Untrained armor (Shield)' });
  });

  it('costs nothing for armor the character is trained in', () => {
    const sheet = sheetOf(hero('Warrior', '2024', ['Chain Mail', 'Shield']));
    expect(sheet.untrainedArmor).toEqual([]);
    expect(sheet.armorPenalty).toBeUndefined();
    expect(sheet.ac.value).toBe(18);
  });
});

describe('untrained armor with the rule off', () => {
  const worn = ['Chain Mail', 'Shield'];

  it('changes nothing the sheet did before: AC, rolls and cues', () => {
    for (const edition of ['2014', '2024'] as const) {
      const sheet = sheetOf(
        hero('Mage', edition, worn, (d) => {
          d.tableRules = { armorTraining: 'off' };
        }),
      );
      const bare = sheetOf(
        hero('Mage', edition, [], (d) => {
          d.tableRules = { armorTraining: 'off' };
        }),
      );
      expect(sheet.ac.value).toBe(18);
      expect(sheet.acNotCounted).toEqual([]);
      expect(sheet.armorPenalty).toBeUndefined();
      expect(sheet.rollRiders).toEqual(bare.rollRiders);
      expect(sheet.cues).toEqual(bare.cues);
      // Still listed, so Items can say it.
      expect(sheet.untrainedArmor.map((u) => u.category)).toEqual(['heavy', 'shield']);
    }
  });

  it('follows the table’s choice in Settings too', () => {
    const ctx = { ...makeTestContext(), rules: { armorTraining: 'off' as const } };
    const sheet = sheetOf(hero('Mage', '2024', worn), ctx);
    expect(sheet.ac.value).toBe(18);
    expect(sheet.armorPenalty).toBeUndefined();
  });
});
