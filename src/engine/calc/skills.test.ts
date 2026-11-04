import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type DerivedAbility,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcChecks, calcPassivePerception, calcSaves, calcSkills } from './skills';

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

  it('honors a manual proficiency override and reports what it replaced', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Stealth.prof': { value: 2 } };
    const effects: EffectInput[] = [{ origin, kind: 'skillProf', skill: 'Stealth', level: 1 }];
    const skills = calcSkills(doc, effects, abilities({ dex: 3 }), 2);
    expect(skills.Stealth?.prof).toBe(2);
    expect(skills.Stealth?.profBase).toBe(1); // what clearing the override restores
    expect(skills.Stealth?.total.value).toBe(7); // dex 3 + expertise 4
  });

  it('can override a skill down to no proficiency', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Stealth.prof': { value: 0 } };
    const effects: EffectInput[] = [{ origin, kind: 'skillProf', skill: 'Stealth', level: 1 }];
    const skills = calcSkills(doc, effects, abilities({ dex: 3 }), 2);
    expect(skills.Stealth?.prof).toBe(0);
    expect(skills.Stealth?.profBase).toBe(1);
    expect(skills.Stealth?.total.value).toBe(3); // dex only
  });

  it('clamps an out-of-range proficiency override', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Arcana.prof': { value: 9 } };
    expect(calcSkills(doc, [], abilities({}), 2).Arcana?.prof).toBe(2);
  });

  it('names the granting feature in the breakdown, and says so when set by hand', () => {
    const effects: EffectInput[] = [{ origin, kind: 'skillProf', skill: 'Stealth', level: 1 }];
    const granted = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({}), 2);
    expect(granted.Stealth?.total.parts.map((p) => p.label)).toContain('Class');

    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Stealth.prof': { value: 1 } };
    const manual = calcSkills(doc, [], abilities({}), 2);
    expect(manual.Stealth?.total.parts.map((p) => p.label)).toContain('Set manually');
  });

  it('honors a flat skill-bonus override', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Insight.bonus': { value: 12 } };
    const skills = calcSkills(doc, [], abilities({ wis: 1 }), 2);
    expect(skills.Insight?.total.value).toBe(12);
    expect(skills.Insight?.total.overridden).toBe(true);
  });
});

const jack: EffectOrigin = { label: 'Jack of All Trades', uid: 'bard|phb', type: 'class' };
const athlete: EffectOrigin = {
  label: 'Remarkable Athlete',
  uid: 'champion|phb',
  type: 'subclass',
};

describe('calcSkills: half proficiency', () => {
  it('adds half the bonus, rounded down, to skills without proficiency only', () => {
    const effects: EffectInput[] = [
      { origin, kind: 'skillProf', skill: 'Stealth', level: 1 },
      { origin, kind: 'skillProf', skill: 'Perception', level: 2 },
      { origin: jack, kind: 'halfProf', round: 'down' },
    ];
    const skills = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({ int: 1 }), 3);
    expect(skills.Arcana?.total.value).toBe(2); // int 1 + half of 3
    expect(skills.Arcana?.halfProf).toBe(true);
    expect(skills.Arcana?.total.parts).toContainEqual({ label: 'Jack of All Trades', amount: 1 });
    expect(skills.Stealth?.total.value).toBe(3); // proficiency, no half on top
    expect(skills.Stealth?.halfProf).toBe(false);
    expect(skills.Perception?.total.value).toBe(6); // expertise, no half on top
  });

  it('reaches a skill set to no proficiency by hand', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { 'skill.Stealth.prof': { value: 0 } };
    const effects: EffectInput[] = [
      { origin, kind: 'skillProf', skill: 'Stealth', level: 1 },
      { origin: jack, kind: 'halfProf', round: 'down' },
    ];
    expect(calcSkills(doc, effects, abilities({}), 2).Stealth?.total.value).toBe(1);
  });

  it('keeps to the abilities it names, and the larger of two wins', () => {
    const effects: EffectInput[] = [
      { origin: jack, kind: 'halfProf', round: 'down' },
      { origin: athlete, kind: 'halfProf', round: 'up', abilities: ['str', 'dex', 'con'] },
    ];
    const skills = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({}), 3);
    expect(skills.Athletics?.total.parts.slice(1)).toEqual([
      { label: 'Remarkable Athlete', amount: 2 },
    ]);
    expect(skills.History?.total.parts.slice(1)).toEqual([
      { label: 'Jack of All Trades', amount: 1 },
    ]);
  });
});

describe('calcSkills: check bonuses', () => {
  const thaumaturge: EffectOrigin = { label: 'Thaumaturge', uid: 'cleric|xphb', type: 'class' };
  const glamour: EffectOrigin = { label: 'Otherworldly Glamour', uid: 'fw|tce', type: 'subclass' };

  it('adds to the named skills, at least +1 where the feature says so', () => {
    const effects: EffectInput[] = [
      {
        origin: thaumaturge,
        kind: 'checkBonus',
        skills: ['Arcana', 'Religion'],
        amount: 'abilityModMin1:wis',
      },
    ];
    const low = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({ wis: -1 }), 2);
    expect(low.Religion?.total.value).toBe(1);
    const high = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({ wis: 3 }), 2);
    expect(high.Arcana?.total.parts).toContainEqual({ label: 'Thaumaturge', amount: 3 });
    expect(high.Nature?.total.value).toBe(0);
  });

  it('adds to every skill of the ability it names', () => {
    const effects: EffectInput[] = [
      { origin: glamour, kind: 'checkBonus', ability: 'cha', amount: 'abilityModMin1:wis' },
    ];
    const skills = calcSkills(newCharacterDoc('c', 'H', 't'), effects, abilities({ wis: 2 }), 2);
    expect(skills.Persuasion?.total.value).toBe(2);
    expect(skills.Deception?.total.value).toBe(2);
    expect(skills.Arcana?.total.value).toBe(0);
  });
});

describe('calcChecks', () => {
  it('is the modifier, plus half proficiency from the 2014 wording', () => {
    const effects: EffectInput[] = [{ origin: jack, kind: 'halfProf', round: 'down' }];
    const checks = calcChecks(effects, abilities({ str: 2 }), 4);
    expect(checks.str.total.value).toBe(4);
    expect(checks.str.halfProf).toBe(true);
    expect(calcChecks([], abilities({ str: 2 }), 4).str).toEqual({
      total: {
        value: 2,
        base: 2,
        overridden: false,
        parts: [{ label: 'STR modifier', amount: 2 }],
      },
      halfProf: false,
    });
  });

  it('leaves plain checks out of half proficiency meant only for skills', () => {
    const effects: EffectInput[] = [
      { origin: jack, kind: 'halfProf', round: 'down', skillsOnly: true },
    ];
    const checks = calcChecks(effects, abilities({}), 4);
    expect(checks.int.total.value).toBe(0);
    expect(checks.int.halfProf).toBe(false);
  });

  it('takes bonuses to every check of the ability, not those to one skill', () => {
    const glamour: EffectOrigin = { label: 'Glamour', uid: 'fw|tce', type: 'subclass' };
    const effects: EffectInput[] = [
      { origin: glamour, kind: 'checkBonus', ability: 'cha', amount: 'abilityMod:wis' },
      { origin: glamour, kind: 'checkBonus', skills: ['Persuasion'], amount: 5 },
    ];
    expect(calcChecks(effects, abilities({ wis: 3 }), 2).cha.total.value).toBe(3);
  });
});

describe('calcPassivePerception', () => {
  it('is 10 + the Perception total', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const skills = calcSkills(doc, [], abilities({ wis: 2 }), 2);
    expect(calcPassivePerception(doc, skills, []).value).toBe(12);
  });

  it('adds a bonus to the passive score alone (2014 Observant)', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const observant: EffectOrigin = { label: 'Observant', uid: 'observant|phb', type: 'feat' };
    const effects: EffectInput[] = [
      { origin: observant, kind: 'passivePerceptionBonus', amount: 5 },
    ];
    const skills = calcSkills(doc, effects, abilities({ wis: 2 }), 2);
    expect(skills.Perception?.total.value).toBe(2);
    expect(calcPassivePerception(doc, skills, effects).value).toBe(17);
  });
});
