import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { deriveSheet } from './derive';
import { type CharacterDoc, newCharacterDoc } from './types';

const ctx = makeTestContext();

/** Level-5 warrior: Testfolk race, Scholar background, sword & board. */
function warriorDoc(): CharacterDoc {
  const doc = newCharacterDoc('w1', 'Grog', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.background = { name: 'Scholar', source: 'TST' };
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      subclass: { name: 'Path of Tests', source: 'TST' },
      levels: 5,
      hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
    },
  ];
  doc.choices = {
    'background:scholar|tst:skill:0': ['Arcana', 'History'],
    'race:testfolk|tst:lang:0': ['Elvish'],
    'class:warrior|tst:skill:0': ['Athletics', 'Intimidation'],
    'class:warrior|tst:optfeature:FS:T': ['defense|phb'],
    'class:warrior|tst:asi:4': 'feat',
    'class:warrior|tst:asi:4:feat': 'alert|phb',
  };
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: 'Chain Mail', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
    { id: 'e2', ref: { name: 'Shield', source: 'TST' }, qty: 1, equipped: true, attuned: false },
    { id: 'e3', ref: { name: 'Longsword', source: 'TST' }, qty: 1, equipped: true, attuned: false },
    { id: 'e4', ref: { name: 'Shortbow', source: 'TST' }, qty: 1, equipped: false, attuned: false },
  ];
  return doc;
}

describe('deriveSheet — level 5 warrior (hand-checked)', () => {
  const sheet = deriveSheet(warriorDoc(), ctx);

  it('applies racial ability bonuses', () => {
    // 16/14+2/14/10/12+1/8
    expect(sheet.abilities.str.value).toBe(16);
    expect(sheet.abilities.dex.value).toBe(16);
    expect(sheet.abilities.wis.value).toBe(13);
    expect(sheet.abilities.dex.mod).toBe(3);
    expect(sheet.abilities.str.mod).toBe(3);
  });

  it('computes proficiency bonus from total level', () => {
    expect(sheet.profBonus.value).toBe(3); // level 5
  });

  it('computes max HP: 10 + 4×6 + 2×5 CON', () => {
    expect(sheet.maxHp.value).toBe(44);
    expect(sheet.hitDice).toEqual({ d10: 5 });
  });

  it('computes saves with class proficiencies', () => {
    expect(sheet.saves.str.total.value).toBe(6); // 3 + 3
    expect(sheet.saves.con.total.value).toBe(5); // 2 + 3
    expect(sheet.saves.dex.total.value).toBe(3); // no prof
    expect(sheet.saves.str.prof).toBe(true);
    expect(sheet.saves.dex.prof).toBe(false);
  });

  it('computes skills from race + background + class choices', () => {
    expect(sheet.skills.Perception?.total.value).toBe(4); // wis 1 + pb 3 (race)
    expect(sheet.skills.Arcana?.total.value).toBe(3); // int 0 + 3 (background choice)
    expect(sheet.skills.Athletics?.total.value).toBe(6); // str 3 + 3 (class choice)
    expect(sheet.skills.Intimidation?.total.value).toBe(2); // cha -1 + 3
    expect(sheet.skills.Stealth?.total.value).toBe(3); // dex 3, no prof
    expect(sheet.passivePerception.value).toBe(14);
  });

  it('computes AC: chain mail 16 (no dex) + shield 2 + Defense 1', () => {
    expect(sheet.ac.value).toBe(19);
    expect(sheet.acFormulaLabel).toBe('Chain Mail');
  });

  it('computes initiative with the Alert feat (+5)', () => {
    expect(sheet.initiative.value).toBe(8); // dex 3 + alert 5
  });

  it('builds attack rows for equipped weapons only', () => {
    const sword = sheet.attacks.find((a) => a.label === 'Longsword');
    expect(sword).toBeDefined();
    expect(sword?.toHit.value).toBe(6); // str 3 + pb 3
    expect(sword?.damage).toBe('1d8+3');
    expect(sword?.versatileDamage).toBe('1d10+3');
    expect(sword?.damageType).toBe('slashing');
    expect(sheet.attacks.find((a) => a.label === 'Shortbow')).toBeUndefined(); // not equipped
    const unarmed = sheet.attacks.find((a) => a.label === 'Unarmed Strike');
    expect(unarmed?.toHit.value).toBe(6);
    expect(unarmed?.damage).toBe('4'); // 1 + str 3
  });

  it('grants darkvision and languages', () => {
    expect(sheet.senses).toContainEqual({ sense: 'darkvision', range: 60, origin: 'Testfolk' });
    expect(sheet.languages).toContain('Common');
    expect(sheet.languages).toContain('Elvish');
  });

  it('collects class + subclass features by level', () => {
    const names = sheet.features.map((f) => f.name);
    expect(names).toContain('Grit');
    expect(names).toContain('Extra Attack');
    expect(names).toContain('Path of Tests'); // subclass feature at 3
    expect(names).toContain('Alert'); // feat via ASI choice
  });

  it('has no pending choices when everything is chosen', () => {
    expect(sheet.pending).toEqual([]);
  });

  it('walk speed comes from the race', () => {
    expect(sheet.speedWalk.value).toBe(30);
  });
});

describe('deriveSheet — pending choices and prompts', () => {
  it('surfaces prompts for unmade choices', () => {
    const doc = warriorDoc();
    doc.choices = {}; // wipe all choices
    const sheet = deriveSheet(doc, ctx);
    const ids = sheet.pending.map((p) => p.id);
    expect(ids).toContain('background:scholar|tst:skill:0');
    expect(ids).toContain('class:warrior|tst:skill:0');
    expect(ids).toContain('class:warrior|tst:asi:4');
    expect(ids).toContain('class:warrior|tst:optfeature:FS:T');
  });

  it('asi choice of +1/+1 abilities applies bonuses', () => {
    const doc = warriorDoc();
    doc.choices['class:warrior|tst:asi:4'] = 'asi';
    delete doc.choices['class:warrior|tst:asi:4:feat'];
    doc.choices['class:warrior|tst:asi:4:abilities'] = ['str', 'str'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.abilities.str.value).toBe(18);
    expect(sheet.initiative.value).toBe(3); // no Alert anymore
  });

  it('emits a subclass prompt when the level is reached without one', () => {
    const doc = warriorDoc();
    const entry = doc.classes[0];
    if (entry === undefined) throw new Error('fixture has a class');
    entry.subclass = undefined;
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.pending.some((p) => p.id === 'class:warrior|tst:subclass')).toBe(true);
  });
});

describe('deriveSheet — full caster (Mage 3)', () => {
  function mageDoc(): CharacterDoc {
    const doc = newCharacterDoc('m1', 'Wizzo', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
    doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
    doc.choices = { 'class:mage|tst:skill:0': ['Arcana'] };
    return doc;
  }

  const sheet = deriveSheet(mageDoc(), ctx);

  it('computes full-caster slots at level 3', () => {
    expect(sheet.spellcasting).toHaveLength(1);
    expect(sheet.spellcasting[0]?.slots).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('computes spell DC and attack', () => {
    expect(sheet.spellcasting[0]?.saveDc.value).toBe(13); // 8 + 2 + 3
    expect(sheet.spellcasting[0]?.attackMod.value).toBe(5); // 2 + 3
  });

  it('computes prepared count from the 2014 formula style', () => {
    expect(sheet.spellcasting[0]?.preparedMax).toBe(6); // level 3 + int 3
  });

  it('computes cantrips known from progression', () => {
    expect(sheet.spellcasting[0]?.cantripsKnown).toBe(3);
  });

  it('mage HP: 6 + 2×4 + 2×3', () => {
    expect(sheet.maxHp.value).toBe(20);
  });
});

describe('deriveSheet — overrides', () => {
  it('overrides AC and marks it, keeping the breakdown', () => {
    const doc = warriorDoc();
    doc.overrides.ac = { value: 22, note: 'magic buff' };
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.ac.value).toBe(22);
    expect(sheet.ac.overridden).toBe(true);
    expect(sheet.ac.base).toBe(19);
    expect(sheet.ac.parts.length).toBeGreaterThan(0);
  });

  it('overrides a skill proficiency level', () => {
    const doc = warriorDoc();
    doc.overrides['skill.Stealth.prof'] = { value: 2 };
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.skills.Stealth?.total.value).toBe(9); // dex 3 + 2×3 expertise
  });
});

describe('deriveSheet — 2024-style background', () => {
  it('applies weighted ability bonuses and the origin feat', () => {
    const doc = warriorDoc();
    doc.background = { name: 'Modern Scholar', source: 'TS2' };
    doc.choices = {
      ...doc.choices,
      'background:modern scholar|ts2:ability:w0': ['int', 'wis'],
    };
    // remove now-invalid 2014 background choice; alert comes from origin feat AND asi —
    // drop the asi feat to keep initiative assertion clean
    delete doc.choices['background:scholar|tst:skill:0'];
    doc.choices['class:warrior|tst:asi:4'] = 'asi';
    doc.choices['class:warrior|tst:asi:4:abilities'] = ['con', 'con'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.abilities.int.value).toBe(12); // 10 + 2 weighted
    expect(sheet.abilities.wis.value).toBe(14); // 12 + 1 race + 1 weighted
    expect(sheet.initiative.value).toBe(8); // Alert origin feat: dex 3 + 5
    expect(sheet.skills.History?.prof).toBe(1); // fixed grant
    expect(sheet.abilities.con.value).toBe(16); // 14 + 2 ASI
    expect(sheet.maxHp.value).toBe(49); // 10+24 + 3×5 CON
  });
});
