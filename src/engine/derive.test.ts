import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { deriveSheet } from './derive';
import { type CharacterDoc, newCharacterDoc } from './types';

const ctx = makeTestContext();

it('deduplicates repeated builder notes', () => {
  const doc = newCharacterDoc('notes', 'Notes', 'test-tag');
  doc.classes = [
    { ref: { name: 'Missing', source: 'TST' }, levels: 1, hp: ['avg'] },
    { ref: { name: 'Missing', source: 'TST' }, levels: 1, hp: ['avg'] },
  ];
  expect(deriveSheet(doc, ctx).warnings).toEqual(['Class not found: missing|tst']);
});

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

  // FIX-004: a non-repeatable feat granted by a background AND chosen via an ASI
  // must apply once, not twice (the ticket's cited "Alert = +10 initiative" bug).
  it('applies a feat granted by both a background and an ASI only once', () => {
    const doc = newCharacterDoc('w2', 'Dup', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 };
    doc.race = { name: 'Testfolk', source: 'TST' }; // dex +2 -> 16 (mod +3)
    doc.background = { name: 'Modern Scholar', source: 'TS2' }; // grants alert|phb
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
    ];
    doc.choices = {
      'class:warrior|tst:asi:4': 'feat',
      'class:warrior|tst:asi:4:feat': 'alert|phb',
    };
    const sheet = deriveSheet(doc, ctx);
    // Alert (+5 initiative) applies once: dex mod 3 + 5 = 8, not 13.
    expect(sheet.initiative.value).toBe(8);
    expect(sheet.warnings).toContainEqual(expect.stringMatching(/not a repeatable feat/i));
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

  it('a prepared caster is not gated by a spells-known maximum', () => {
    expect(sheet.spellcasting[0]?.spellsKnownMax).toBeUndefined();
  });
});

describe('deriveSheet — spells-known max (GAME-007)', () => {
  it('reads a known/pact caster spells-known maximum from its progression', () => {
    const doc = newCharacterDoc('p1', 'Warlocke', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 };
    doc.classes = [
      { ref: { name: 'Pactcaster', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
    ];
    const sheet = deriveSheet(doc, ctx);
    // Pactcaster spellsKnownProgression[level 3 - 1] = 4.
    expect(sheet.spellcasting[0]?.spellsKnownMax).toBe(4);
    expect(sheet.spellcasting[0]?.mode).toBe('pact');
  });
});

describe('deriveSheet — HP gain methods', () => {
  // Warrior 5, d10, CON 14 (+2), no Tough: average = 10 + 4×6 + 10 = 44
  it('defaults to average (44)', () => {
    const sheet = deriveSheet(warriorDoc(), ctx);
    expect(sheet.maxHp.value).toBe(44);
  });

  it('max rule: full die every level (10 + 40 + 10 = 60)', () => {
    const doc = warriorDoc();
    doc.hpMethod = 'max';
    expect(deriveSheet(doc, ctx).maxHp.value).toBe(60);
  });

  it('rolled: uses per-level values, level 1 stays max (10 + 3+7+10+1 + 10 = 41)', () => {
    const doc = warriorDoc();
    doc.hpMethod = 'rolled';
    const entry = doc.classes[0];
    if (entry === undefined) throw new Error('fixture has a class');
    entry.hp = ['avg', 3, 7, 10, 1];
    expect(deriveSheet(doc, ctx).maxHp.value).toBe(41);
  });

  it('rolled falls back to average for un-rolled levels', () => {
    const doc = warriorDoc();
    doc.hpMethod = 'rolled';
    const entry = doc.classes[0];
    if (entry === undefined) throw new Error('fixture has a class');
    entry.hp = ['avg', 10, 'avg', 'avg', 'avg']; // 10 + (10+6+6+6) + 10 = 48
    expect(deriveSheet(doc, ctx).maxHp.value).toBe(48);
  });

  it('rolled values outside the die are clamped', () => {
    const doc = warriorDoc();
    doc.hpMethod = 'rolled';
    const entry = doc.classes[0];
    if (entry === undefined) throw new Error('fixture has a class');
    entry.hp = ['avg', 99, 0, 'avg', 'avg']; // clamps to 10 and 1 -> 10+(10+1+6+6)+10 = 43
    expect(deriveSheet(doc, ctx).maxHp.value).toBe(43);
  });
});

describe('deriveSheet — multi-count choices stay pending until full (Rogue bug)', () => {
  it('keeps a 2-skill class choice pending after only one pick', () => {
    const doc = warriorDoc();
    doc.choices['class:warrior|tst:skill:0'] = ['Athletics']; // only 1 of 2
    const sheet = deriveSheet(doc, ctx);
    const prompt = sheet.pending.find((p) => p.id === 'class:warrior|tst:skill:0');
    expect(prompt).toBeDefined();
    expect(prompt?.count).toBe(2);
    // The one pick still applies immediately.
    expect(sheet.skills.Athletics?.prof).toBe(1);
  });

  it('resolves the choice once both picks are made', () => {
    const sheet = deriveSheet(warriorDoc(), ctx); // fixture picks 2
    expect(sheet.pending.some((p) => p.id === 'class:warrior|tst:skill:0')).toBe(false);
  });
});

describe('deriveSheet — language options never empty', () => {
  it('offers standard languages for an anyStandard prompt', () => {
    const doc = warriorDoc();
    delete doc.choices['race:testfolk|tst:lang:0'];
    const sheet = deriveSheet(doc, ctx);
    const lang = sheet.pending.find((p) => p.id === 'race:testfolk|tst:lang:0');
    expect(lang?.options.length).toBeGreaterThan(8);
    expect(lang?.options.some((o) => o.label === 'Draconic')).toBe(true);
  });
});

describe('deriveSheet — innate spells (additionalSpells)', () => {
  it('grants level-gated racial spells at the character level', () => {
    const sheet = deriveSheet(warriorDoc(), ctx); // Testfolk, level 5
    const names = sheet.grantedSpells.map((g) => g.name);
    expect(names).toContain('guidance'); // "_" always
    expect(names).toContain('aid'); // gate 3 <= 5
    expect(names).not.toContain('flame strike'); // gate 9 > 5
    expect(sheet.grantedSpells.find((g) => g.name === 'aid')?.ability).toBe('wis');
  });

  it('grants subclass always-prepared spells and surfaces expanded ones', () => {
    const sheet = deriveSheet(warriorDoc(), ctx); // Warrior 5 / Path of Tests
    expect(sheet.grantedSpells.find((g) => g.name === 'bless')?.usage).toBe('prepared');
    expect(sheet.grantedSpells.find((g) => g.name === 'cure wounds')?.usage).toBe('prepared');
    // Level-gated: flame strike is a "9" entry, character is level 5.
    expect(sheet.grantedSpells.some((g) => g.name === 'flame strike')).toBe(false);
    // Expanded lists can't be auto-granted without a picker — surfaced as a note.
    expect(
      sheet.warnings.some(
        (w) => w.toLowerCase().includes('expands your spell options') && w.includes('shield'),
      ),
    ).toBe(true);
  });
});

describe('deriveSheet — optional-feature prerequisites', () => {
  it('level-gates optional feature options and labels their prerequisites', () => {
    const doc = warriorDoc(); // Warrior 5
    delete doc.choices['class:warrior|tst:optfeature:FS:T'];
    const sheet = deriveSheet(doc, ctx);
    const prompt = sheet.pending.find((p) => p.id === 'class:warrior|tst:optfeature:FS:T');
    expect(prompt).toBeDefined();
    // Precision needs level 10; the character is level 5 -> disabled with reason.
    const precision = prompt?.options.find((o) => o.id === 'precision|phb');
    expect(precision?.disabled?.reason).toContain('level 10');
    expect(precision?.description).toContain('Prereq: level 10');
    // Pact prereqs are informational only (depend on other picks) — not disabled.
    const archery = prompt?.options.find((o) => o.id === 'archery|phb');
    expect(archery?.description).toContain('Pact of the Blade');
    expect(archery?.disabled).toBeUndefined();
    // Defense has no prereq — plain description, selectable.
    const defense = prompt?.options.find((o) => o.id === 'defense|phb');
    expect(defense?.disabled).toBeUndefined();
    expect(defense?.description).not.toContain('Prereq');
  });
});

describe('deriveSheet — curated class save DC (Monk Stunning Strike)', () => {
  it('surfaces Stunning Strike as a Con save at the ki DC (8 + prof + Wis)', () => {
    const doc = newCharacterDoc('m1', 'Kwai', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 12, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
    doc.classes = [
      {
        ref: { name: 'Monk', source: 'TST' },
        levels: 5,
        hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
      },
    ];
    const sheet = deriveSheet(doc, ctx);
    const ss = sheet.actions.find((a) => a.label === 'Stunning Strike');
    expect(ss?.save?.targetAbility).toBe('con');
    // WIS 16 -> +3, level 5 prof +3, DC = 8 + 3 + 3 = 14.
    expect(ss?.save?.dc).toBe(14);
  });
});

describe('deriveSheet — stackable resources (superiority dice)', () => {
  it('sums same-key resources flagged stack; keeps first-wins otherwise', () => {
    const doc = warriorDoc();
    const origin = (label: string) => ({
      label,
      uid: label.toLowerCase(),
      type: 'custom' as const,
    });
    doc.customEffects = [
      // Battle Master pool + a Martial-Adept-style d6 that stacks into it.
      {
        kind: 'resource',
        key: 'superiority-dice',
        label: 'Superiority Dice (d8)',
        max: 4,
        resetOn: 'short',
        stack: true,
        origin: origin('BM'),
      },
      {
        kind: 'resource',
        key: 'superiority-dice',
        label: 'Superiority Dice (d6)',
        max: 1,
        resetOn: 'short',
        stack: true,
        origin: origin('MA'),
      },
      // Non-stack duplicate (curated vs prose) still collapses to the first.
      {
        kind: 'resource',
        key: 'rage',
        label: 'Rage',
        max: 3,
        resetOn: 'long',
        origin: origin('C'),
      },
      {
        kind: 'resource',
        key: 'rage',
        label: 'Rage',
        max: 99,
        resetOn: 'long',
        origin: origin('D'),
      },
    ];
    const sheet = deriveSheet(doc, ctx);
    const sup = sheet.resources.find((r) => r.key === 'superiority-dice');
    expect(sup?.max).toBe(5); // 4 + 1 stacked
    expect(sup?.label).toBe('Superiority Dice (d8)'); // first source's label wins
    const rage = sheet.resources.find((r) => r.key === 'rage');
    expect(rage?.max).toBe(3); // first wins, NOT summed to 102
  });
});

describe('deriveSheet — class-feature Expertise (prose-only, now prompted)', () => {
  function sneakDoc(): CharacterDoc {
    const doc = newCharacterDoc('sn1', 'Sly', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 8, dex: 16, con: 12, int: 14, wis: 10, cha: 10 };
    doc.classes = [{ ref: { name: 'Sneak', source: 'TST' }, levels: 1, hp: ['avg'] }];
    doc.choices = { 'class:sneak|tst:skill:0': ['Stealth', 'Acrobatics'] };
    return doc;
  }

  it('emits an expertise prompt limited to proficient skills', () => {
    const sheet = deriveSheet(sneakDoc(), ctx);
    const prompt = sheet.pending.find((p) => p.id === 'class:sneak|tst:expertise:1');
    expect(prompt).toBeDefined();
    expect(prompt?.count).toBe(2);
    const opts = prompt?.options.map((o) => o.id).sort();
    expect(opts).toEqual(['Acrobatics', 'Stealth']); // only proficient skills
  });

  it('applies expertise (2× proficiency) when chosen', () => {
    const doc = sneakDoc();
    doc.choices['class:sneak|tst:expertise:1'] = ['Stealth'];
    const sheet = deriveSheet(doc, ctx);
    // DEX +3, proficiency +2, expertise doubles it => 3 + 4 = 7
    expect(sheet.skills.Stealth?.prof).toBe(2);
    expect(sheet.skills.Stealth?.total.value).toBe(7);
    // Acrobatics still just proficient (3 + 2 = 5)
    expect(sheet.skills.Acrobatics?.total.value).toBe(5);
  });
});

describe('deriveSheet — ASI stacking +2 on one ability', () => {
  it('applies two picks of the same ability as +2', () => {
    const doc = warriorDoc();
    doc.choices['class:warrior|tst:asi:4'] = 'asi';
    delete doc.choices['class:warrior|tst:asi:4:feat'];
    doc.choices['class:warrior|tst:asi:4:abilities'] = ['con', 'con'];
    const sheet = deriveSheet(doc, ctx);
    // CON base 14 + 2 (ASI) = 16
    expect(sheet.abilities.con.value).toBe(16);
  });
});

describe('deriveSheet — resolved choices', () => {
  it('exposes made choices with their prompts and selections', () => {
    const sheet = deriveSheet(warriorDoc(), ctx);
    const skillChoice = sheet.resolvedChoices.find(
      (r) => r.prompt.id === 'class:warrior|tst:skill:0',
    );
    expect(skillChoice?.selected).toEqual(['Athletics', 'Intimidation']);
    expect(sheet.resolvedChoices.length).toBeGreaterThanOrEqual(4);
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

describe('deriveSheet — multiclass', () => {
  function multiDoc(): CharacterDoc {
    const doc = newCharacterDoc('mc1', 'Hexblade', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 14 };
    doc.classes = [
      { ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
      { ref: { name: 'Pactcaster', source: 'TST' }, levels: 2, hp: ['avg', 'avg'] },
    ];
    doc.choices = { 'class:mage|tst:skill:0': ['Arcana'] };
    return doc;
  }

  const sheet = deriveSheet(multiDoc(), ctx);

  it('total level and proficiency bonus span both classes', () => {
    expect(sheet.totalLevel).toBe(5);
    expect(sheet.profBonus.value).toBe(3);
  });

  it('shares one multiclass slot table and keeps pact separate', () => {
    const mage = sheet.spellcasting.find((b) => b.className === 'Mage');
    const pact = sheet.spellcasting.find((b) => b.className === 'Pactcaster');
    // combined caster level 3 (pact excluded) -> [4,2]
    expect(mage?.slots).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(pact?.slots).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(pact?.pactSlots).toEqual({ count: 2, level: 1 });
    expect(mage?.pactSlots).toBeUndefined();
  });

  it('later classes gain only multiclassing proficiencies, not saves', () => {
    expect(sheet.armorProfs).toContain('light'); // Pactcaster proficienciesGained
    expect(sheet.saves.cha.prof).toBe(false); // Pactcaster saves NOT gained
    expect(sheet.saves.int.prof).toBe(true); // first class saves kept
  });

  it('HP: mage 6+2×4 + pact 2×5 + con 2×5 = 34', () => {
    expect(sheet.maxHp.value).toBe(34);
    expect(sheet.hitDice).toEqual({ d6: 3, d8: 2 });
  });
});

describe('multiclass requirements helper', () => {
  it('reads requirement text and validates scores', async () => {
    const { meetsMulticlassRequirements, multiclassRequirementText } = await import('./multiclass');
    const mage = ctx.get('class', 'Mage', 'TST');
    expect(multiclassRequirementText(mage)).toBe('INT 13');
    expect(
      meetsMulticlassRequirements(mage, { str: 8, dex: 10, con: 10, int: 13, wis: 10, cha: 10 }),
    ).toBe(true);
    expect(
      meetsMulticlassRequirements(mage, { str: 8, dex: 10, con: 10, int: 12, wis: 10, cha: 10 }),
    ).toBe(false);
    expect(multiclassRequirementText(ctx.get('class', 'Warrior', 'TST'))).toBeUndefined();
  });
});

describe('deriveSheet — XPHB arrangement (either/or weighted abilities)', () => {
  function flexDoc(): CharacterDoc {
    const doc = warriorDoc();
    doc.background = { name: 'Flexible Scholar', source: 'TS2' };
    delete doc.choices['background:scholar|tst:skill:0'];
    return doc;
  }

  it('asks for the arrangement first (one prompt, not two)', () => {
    const sheet = deriveSheet(flexDoc(), ctx);
    const abilityPrompts = sheet.pending.filter((p) =>
      p.id.startsWith('background:flexible scholar|ts2:ability'),
    );
    expect(abilityPrompts).toHaveLength(1);
    expect(abilityPrompts[0]?.id).toBe('background:flexible scholar|ts2:ability:arrangement');
    expect(abilityPrompts[0]?.options.map((o) => o.label)).toEqual(['+2 / +1', '+1 / +1 / +1']);
  });

  it('after picking an arrangement, only its weighted prompt appears and applies', () => {
    const doc = flexDoc();
    doc.choices['background:flexible scholar|ts2:ability:arrangement'] = '1';
    let sheet = deriveSheet(doc, ctx);
    const weighted = sheet.pending.find((p) => p.kind === 'abilityWeighted');
    expect(weighted?.id).toBe('background:flexible scholar|ts2:ability:w1');
    expect(weighted?.count).toBe(3);

    doc.choices[weighted?.id ?? ''] = ['int', 'wis', 'cha'];
    sheet = deriveSheet(doc, ctx);
    expect(sheet.abilities.int.value).toBe(11); // 10 + 1
    expect(sheet.abilities.cha.value).toBe(9); // 8 + 1
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

describe('deriveSheet — curated racial traits and feats', () => {
  it('emits a resource for a curated racial trait (Relentless Endurance)', () => {
    const sheet = deriveSheet(warriorDoc(), ctx);
    const res = sheet.resources.find((r) => r.key === 'relentless-endurance');
    expect(res).toBeDefined();
    expect(res?.max).toBe(1);
    expect(res?.resetOn).toBe('long');
  });

  it('emits a Luck resource for the Lucky feat', () => {
    const doc = warriorDoc();
    doc.feats = [{ ref: { name: 'Lucky', source: 'PHB' }, instanceId: 'a' }];
    const sheet = deriveSheet(doc, ctx);
    const res = sheet.resources.find((r) => r.key === 'luck');
    expect(res?.max).toBe(3);
    expect(res?.resetOn).toBe('long');
  });
});

describe('deriveSheet — generic prose scan (Prosefolk)', () => {
  const doc = warriorDoc();
  doc.race = { name: 'Prosefolk', source: 'TST' };
  const sheet = deriveSheet(doc, ctx);

  it('profBonus-limited bonus-action trait → resource + action', () => {
    const res = sheet.resources.find((r) => r.key === 'test-surge');
    expect(res?.max).toBe(3); // prof bonus at level 5
    expect(res?.resetOn).toBe('long');
    expect(sheet.actions.some((a) => a.label === 'Test Surge' && a.economy === 'bonus')).toBe(true);
  });

  it('once-per-short-rest reaction trait → 1-use short resource + reaction', () => {
    const res = sheet.resources.find((r) => r.key === 'once-guard');
    expect(res?.max).toBe(1);
    expect(res?.resetOn).toBe('short');
    expect(sheet.actions.some((a) => a.label === 'Once Guard' && a.economy === 'reaction')).toBe(
      true,
    );
  });

  it('per-level HP rider → +1 HP per level', () => {
    // Warrior baseline is 44; Test Toughness adds 1×5 levels.
    expect(sheet.maxHp.value).toBe(49);
  });

  it('no-usage prose emits nothing', () => {
    expect(sheet.resources.some((r) => r.key === 'plain-lore')).toBe(false);
    expect(sheet.actions.some((a) => a.label === 'Plain Lore')).toBe(false);
  });

  it('curated traits are not double-emitted by the prose scan', () => {
    const s2 = deriveSheet(warriorDoc(), ctx);
    expect(s2.resources.filter((r) => r.key === 'relentless-endurance')).toHaveLength(1);
  });
});

describe('deriveSheet — dragonborn ancestry linkage', () => {
  function dragonbornDoc(withSubrace: boolean, levels = 1): CharacterDoc {
    const doc = newCharacterDoc('d1', 'Rina', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 };
    doc.race = { name: 'Dragonborn', source: 'TST' };
    if (withSubrace) doc.subrace = { name: 'Dragonborn (Blue)', source: 'TST' };
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels, hp: Array(levels).fill('avg') },
    ];
    return doc;
  }

  it('subrace ancestry pre-answers the racial resistance choice', () => {
    const sheet = deriveSheet(dragonbornDoc(true), ctx);
    expect(sheet.pending.some((p) => p.label === 'Damage resistance')).toBe(false);
    expect(sheet.resists.map((r) => r.damageType)).toContain('lightning');
  });

  it('keeps the resistance prompt when no subrace fixes it', () => {
    const sheet = deriveSheet(dragonbornDoc(false), ctx);
    expect(sheet.pending.some((p) => p.label === 'Damage resistance')).toBe(true);
  });

  it('types the breath weapon from the ancestry (damage, area, save DC)', () => {
    const sheet = deriveSheet(dragonbornDoc(true), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.roll).toBe('2d6');
    expect(bw?.note).toBe('lightning · 5 by 30 ft line');
    // DC = 8 + CON mod (+2) + proficiency (+2)
    expect(bw?.save).toEqual({ targetAbility: 'dex', dc: 12 });
  });

  it('scales breath weapon dice with total level', () => {
    const sheet = deriveSheet(dragonbornDoc(true, 11), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.roll).toBe('4d6');
  });

  it('disables already-known languages in language prompts', () => {
    const doc = dragonbornDoc(true);
    doc.background = { name: 'Linguist', source: 'TST' };
    const sheet = deriveSheet(doc, ctx);
    const lang = sheet.pending.find((p) => p.kind === 'language');
    expect(lang).toBeDefined();
    // Dragonborn already speak Common and Draconic; open picks can't re-buy them.
    expect(lang?.options.find((o) => o.id === 'Common')?.disabled).toBeDefined();
    expect(lang?.options.find((o) => o.id === 'Draconic')?.disabled).toBeDefined();
    expect(lang?.options.find((o) => o.id === 'Elvish')?.disabled).toBeUndefined();
  });
});

describe('deriveSheet — natural armor + 2024 Magic action (prose scan)', () => {
  function turtleDoc(): CharacterDoc {
    const doc = newCharacterDoc('t1', 'Shelly', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 12, dex: 16, con: 14, int: 8, wis: 12, cha: 10 };
    doc.race = { name: 'Turtlefolk', source: 'TST' };
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
    return doc;
  }

  it('applies natural armor base AC (17), ignoring a high Dex', () => {
    const sheet = deriveSheet(turtleDoc(), ctx);
    expect(sheet.ac.value).toBe(17); // not 10 + DEX 3 = 13
    expect(sheet.acFormulaLabel).toBe('Natural Armor');
  });

  it('reads a 2024 "Magic action" trait as an action + long-rest resource', () => {
    const sheet = deriveSheet(turtleDoc(), ctx);
    expect(sheet.actions.some((a) => a.label === 'Healing Touch' && a.economy === 'action')).toBe(
      true,
    );
    expect(sheet.resources.some((r) => r.label === 'Healing Touch' && r.resetOn === 'long')).toBe(
      true,
    );
  });

  it('adds the ability modifier for "13 + Dexterity modifier" natural armor', () => {
    const doc = turtleDoc();
    doc.race = { name: 'Scalefolk', source: 'TST' };
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.ac.value).toBe(16); // 13 + DEX 3, not a flat 13
    expect(sheet.acFormulaLabel).toBe('Natural Armor');
  });
});

describe('deriveSheet — FTD Dragonborn (prose-scanned; ancestry table must not clobber)', () => {
  function ftdDoc(name: string, levels = 1): CharacterDoc {
    const doc = newCharacterDoc('f1', 'Kaida', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 };
    doc.race = { name, source: 'FTST' };
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels, hp: Array(levels).fill('avg') },
    ];
    return doc;
  }

  it('keeps the chromatic LINE + DEX save even though the table lists green as a cone', () => {
    const sheet = deriveSheet(ftdDoc('Dragonborn (Chromatic; Green)'), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.note).toBe('poison · 30-foot line');
    expect(bw?.save).toEqual({ targetAbility: 'dex', dc: 12 }); // NOT con/cone
    expect(bw?.roll).toBe('1d10');
  });

  it('types a gem breath weapon (psychic cone) with no curated ancestry entry', () => {
    const sheet = deriveSheet(ftdDoc('Dragonborn (Gem; Emerald)'), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.note).toBe('psychic · 15-foot cone');
    expect(bw?.save?.targetAbility).toBe('dex');
  });

  it('scales the FTD breath weapon dice with total level', () => {
    const sheet = deriveSheet(ftdDoc('Dragonborn (Chromatic; Green)', 11), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.roll).toBe('3d10'); // level 11 step
  });
});

describe('deriveSheet — 2024 versioned Dragonborn (color in race name)', () => {
  function xDragonbornDoc(levels: number): CharacterDoc {
    const doc = newCharacterDoc('x1', 'Vex', 'test-tag');
    doc.rulesVersion = '2024';
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 };
    doc.race = { name: 'Dragonborn (Blue)', source: 'XTST' };
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels, hp: Array(levels).fill('avg') },
    ];
    return doc;
  }

  it('types the breath weapon (DEX save, flexible area, computed DC) from the race name', () => {
    const sheet = deriveSheet(xDragonbornDoc(1), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw).toBeDefined();
    expect(bw?.note).toBe('lightning · 15 ft cone or 30 ft line');
    expect(bw?.save).toEqual({ targetAbility: 'dex', dc: 12 }); // 8 + CON 2 + prof 2
    expect(bw?.roll).toBe('1d10');
  });

  it('scales breath-weapon dice with the 2024 "levels 5 (2d10)" phrasing', () => {
    const sheet = deriveSheet(xDragonbornDoc(11), ctx);
    const bw = sheet.actions.find((a) => a.label === 'Breath Weapon');
    expect(bw?.roll).toBe('3d10'); // level 11 step
  });

  it('grants the resistance and a proficiency-bonus-limited resource', () => {
    const sheet = deriveSheet(xDragonbornDoc(1), ctx);
    expect(sheet.resists.map((r) => r.damageType)).toContain('lightning');
    expect(sheet.resources.some((r) => r.label === 'Breath Weapon')).toBe(true);
  });
});
