import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type DerivedAbility,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcPassivePerception, calcSaves, calcSkills } from './skills';

const origin: EffectOrigin = { label: 'Class', uid: 'class|x', type: 'class' };

function abilities(mods: Partial<Record<Ability, number>>): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) {
    const mod = mods[a] ?? 0;
    out[a] = { value: 10 + mod * 2, base: 10, overridden: false, parts: [], mod };
  }
  return out;
}

describe('calcSaves', () => {
  it('adds proficiency only to proficient saves', () => {
    const effects: EffectInput[] = [{ origin, kind: 'saveProf', ability: 'con' }];
    const saves = calcSaves(newCharacterDoc('c', 'H', 't'), effects, abilities({ con: 3 }), 2);
    expect(saves.con.prof).toBe(true);
    expect(saves.con.total.value).toBe(5); // +3 mod + 2 prof
    expect(saves.str.prof).toBe(false);
    expect(saves.str.total.value).toBe(0);
  });

  it('honors a save-proficiency override', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'save.wis.prof': { value: 1 } };
    const saves = calcSaves(doc, [], abilities({ wis: 1 }), 3);
    expect(saves.wis.prof).toBe(true);
    expect(saves.wis.total.value).toBe(4);
  });
});

describe('calcSkills', () => {
  it('applies proficiency and expertise', () => {
    const effects: EffectInput[] = [
      { origin, kind: 'skillProf', skill: 'Stealth', level: 1 },
      { origin, kind: 'skillProf', skill: 'Perception', level: 2 },
    ];
    const skills = calcSkills(
      newCharacterDoc('c', 'H', 't'),
      effects,
      abilities({ dex: 3, wis: 1 }),
      2,
    );
    expect(skills.Stealth?.prof).toBe(1);
    expect(skills.Stealth?.total.value).toBe(5); // dex 3 + prof 2
    expect(skills.Perception?.prof).toBe(2);
    expect(skills.Perception?.total.value).toBe(5); // wis 1 + expertise 4
    expect(skills.Arcana?.total.value).toBe(0); // untrained int 0
  });

  it('takes the highest proficiency level across sources', () => {
    const effects: EffectInput[] = [
      { origin, kind: 'skillProf', skill: 'Athletics', level: 1 },
      { origin, kind: 'skillProf', skill: 'Athletics', level: 2 },
    ];
    const skills = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({ str: 2 }), 3);
    expect(skills.Athletics?.prof).toBe(2);
    expect(skills.Athletics?.total.value).toBe(8); // str 2 + expertise 6
  });

  it('honors a flat skill-bonus override', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Insight.bonus': { value: 12 } };
    const skills = calcSkills(doc, [], abilities({ wis: 1 }), 2);
    expect(skills.Insight?.total.value).toBe(12);
    expect(skills.Insight?.total.overridden).toBe(true);
  });
});

describe('calcPassivePerception', () => {
  it('is 10 + the Perception total', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const skills = calcSkills(doc, [], abilities({ wis: 2 }), 2);
    expect(calcPassivePerception(doc, skills).value).toBe(12);
  });
});
