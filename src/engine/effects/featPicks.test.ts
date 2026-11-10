import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type CharacterDoc, type DataEntity, newCharacterDoc } from '../types';
import { Collector } from './base';
import { collectFeatEntity } from './feat';
import { isRepeatableFeat } from './featPicks';

// Invented wording throughout. The names that sit in the feat tables are real,
// since the tables key on them; the text and the options are not any book's.
const adeptOld: DataEntity = {
  name: 'Elemental Adept',
  source: 'PHB',
  entries: ['Favor an element.'],
};
const adeptNew: DataEntity = {
  name: 'Elemental Adept',
  source: 'XPHB',
  repeatable: true,
  entries: ['Favor an element, once more.'],
};
const masterNew: DataEntity = {
  name: 'Weapon Master',
  source: 'XPHB',
  entries: ['Train with a weapon.'],
};
const mixed: DataEntity = {
  name: 'Mixed Training',
  source: 'HB',
  skillToolLanguageProficiencies: [{ choose: [{ from: ['anySkill', 'anyTool'], count: 3 }] }],
  entries: ['Train in three things.'],
};
const warded: DataEntity = {
  name: 'Warded',
  source: 'HB',
  resist: [{ choose: { from: ['cold', 'fire'] } }],
  entries: ['Shrug off an element.'],
};
const stance: DataEntity = {
  name: 'Stance Student',
  source: 'HB',
  optionalfeatureProgression: [
    { name: 'Combat Stance', featureType: ['FS:T'], progression: { '*': 1 } },
  ],
  entries: ['Learn a stance.'],
};
const twoStances: DataEntity = {
  ...stance,
  name: 'Stance Scholar',
  optionalfeatureProgression: [
    { name: 'Combat Stance', featureType: ['FS:T'], progression: { '*': 2 } },
  ],
};
const invoker: DataEntity = {
  name: 'Eldritch Adept',
  source: 'TCE',
  optionalfeatureProgression: [
    { name: 'Eldritch Invocations', featureType: ['ZZ'], progression: { '*': 1 } },
  ],
  entries: ['Learn a secret.'],
};
const secrets: DataEntity[] = [
  { name: 'Open Secret', source: 'HB', featureType: ['ZZ'], entries: ['Anyone can.'] },
  {
    name: 'Late Secret',
    source: 'HB',
    featureType: ['ZZ'],
    prerequisite: [{ level: { level: 5, class: { name: 'Warlock' } } }],
    entries: ['Only later.'],
  },
  {
    name: 'Pact Secret',
    source: 'HB',
    featureType: ['ZZ'],
    prerequisite: [{ pact: 'Blade' }],
    entries: ['Only sworn.'],
  },
  {
    name: 'Spoken Secret',
    source: 'HB',
    featureType: ['ZZ'],
    additionalSpells: [{ innate: { _: ['fake whisper'] } }],
    entries: ['Say it aloud.'],
  },
];
const weapons: DataEntity[] = [
  {
    name: 'Fake Blade',
    source: 'XPHB',
    type: 'M',
    weaponCategory: 'martial',
    dmg1: '1d8',
    dmgType: 'S',
    mastery: ['Nick|XPHB'],
  },
  // A mastery with a note is an object (Psychic Blade's).
  {
    name: 'Fake Mind Blade',
    source: 'XPHB',
    type: 'M',
    weaponCategory: 'simple',
    dmg1: '1d6',
    dmgType: 'Y',
    mastery: [{ uid: 'Vex|XPHB', note: 'Placeholder note.' }],
  },
  // An older printing with no mastery, then a firearm that has one.
  { name: 'Old Blade', source: 'PHB', type: 'M', weaponCategory: 'martial', dmg1: '1d8' },
  {
    name: 'Fake Rifle',
    source: 'XDMG',
    type: 'R',
    weaponCategory: 'martial',
    age: 'futuristic',
    mastery: ['Sap|XPHB'],
  },
];

const base = makeTestContext();
const feats = [adeptOld, adeptNew, masterNew, mixed, warded, stance, twoStances, invoker];
const ctx = {
  get: (type: string, name: string, source?: string) =>
    (type === 'feat'
      ? feats.find(
          (f) =>
            String(f.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(f.source).toLowerCase() === source.toLowerCase()),
        )
      : undefined) ??
    (type === 'optionalfeature'
      ? secrets.find((o) => String(o.name).toLowerCase() === name.toLowerCase())
      : undefined) ??
    (type === 'baseitem'
      ? weapons.find((w) => String(w.name).toLowerCase() === name.toLowerCase())
      : undefined) ??
    base.get(type, name, source),
  byType: (type: string) =>
    type === 'baseitem'
      ? weapons
      : type === 'optionalfeature'
        ? [...base.byType(type), ...secrets]
        : base.byType(type),
};

function docWith(...taken: Array<[DataEntity, string]>): CharacterDoc {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
  doc.choices['class:warrior|tst:optfeature:FS:T'] = ['defense|phb'];
  doc.feats = taken.map(([f, instanceId]) => ({
    ref: { name: String(f.name), source: String(f.source) },
    instanceId,
  }));
  return doc;
}

const idOf = (f: DataEntity, instance: string, rest: string) =>
  `${`feat:${String(f.name)}|${String(f.source)}`.toLowerCase()}:${instance}:${rest}`;

describe('a skill or tool pick', () => {
  const promptId = idOf(mixed, 'i1', 'skillTool:0');

  it('offers skills and tools in one list, for the data count', () => {
    const sheet = deriveSheet(docWith([mixed, 'i1']), ctx);
    const prompt = sheet.pending.find((p) => p.id === promptId);
    expect(prompt?.kind).toBe('skillOrTool');
    expect(prompt?.count).toBe(3);
    const ids = prompt?.options.map((o) => o.id);
    expect(ids).toContain('Stealth');
    expect(ids).toContain("thieves' tools");
    expect(ids).toContain('lute');
  });

  it('grants each pick as what it is, after a save and load', () => {
    const doc = docWith([mixed, 'i1']);
    doc.choices[promptId] = ['Stealth', "thieves' tools", 'lute'];
    const sheet = deriveSheet(JSON.parse(JSON.stringify(doc)) as typeof doc, ctx);
    expect(sheet.pending.map((p) => p.id)).not.toContain(promptId);
    expect(sheet.skills.Stealth?.prof).toBe(1);
    expect(sheet.toolProfs).toEqual(expect.arrayContaining(["thieves' tools", 'lute']));
  });

  it('says which skills the build already grants, as a skill pick does', () => {
    const doc = docWith([mixed, 'i1']);
    doc.feats.push({ ref: { name: 'Skilled', source: 'TST' }, instanceId: 'f1' });
    doc.choices['feat:skilled|tst:f1:skill:0'] = ['Stealth', 'Arcana', 'History'];
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.id === promptId);
    expect(prompt?.options.find((o) => o.id === 'Stealth')?.advisory).toContain(
      'Already proficient from Skilled (feat).',
    );
  });
});

describe('a damage type only the prose asks for', () => {
  const first = idOf(adeptOld, 'i1', 'damageType');
  const second = idOf(adeptOld, 'i2', 'damageType');

  it('offers the five types, and shows the pick on the card', () => {
    const doc = docWith([adeptOld, 'i1']);
    const before = deriveSheet(doc, ctx);
    expect(before.pending.find((p) => p.id === first)?.options.map((o) => o.label)).toEqual([
      'Acid',
      'Cold',
      'Fire',
      'Lightning',
      'Thunder',
    ]);
    doc.choices[first] = ['fire'];
    const after = deriveSheet(doc, ctx);
    expect(after.pending.map((p) => p.id)).not.toContain(first);
    expect(after.features.map((f) => f.name)).toContain('Elemental Adept (Fire)');
  });

  it('applies twice even though the older printing has no repeatable flag', () => {
    expect(isRepeatableFeat(adeptOld)).toBe(true);
    expect(isRepeatableFeat(adeptNew)).toBe(true);
    expect(isRepeatableFeat({ name: 'Elemental Adept', source: 'HB' })).toBe(false);
    const sheet = deriveSheet(docWith([adeptOld, 'i1'], [adeptOld, 'i2']), ctx);
    expect(sheet.warnings.join()).not.toContain('not a repeatable feat');
    expect(sheet.pending.map((p) => p.id)).toEqual(expect.arrayContaining([first, second]));
  });

  it('closes a type the other copy took, in either order, and leaves its own open', () => {
    const doc = docWith([adeptOld, 'i1'], [adeptOld, 'i2']);
    doc.choices[second] = ['cold'];
    const sheet = deriveSheet(doc, ctx);
    const pending = sheet.pending.find((p) => p.id === first);
    expect(pending?.options.find((o) => o.id === 'cold')?.disabled?.reason).toBe(
      'You already have this from Elemental Adept (feat).',
    );
    expect(pending?.options.find((o) => o.id === 'fire')?.disabled).toBeUndefined();
    const made = sheet.resolvedChoices.find((r) => r.prompt.id === second);
    expect(made?.prompt.options.find((o) => o.id === 'cold')?.disabled).toBeUndefined();
  });

  it('warns once when both copies have come to hold one type', () => {
    const doc = docWith([adeptOld, 'i1'], [adeptOld, 'i2']);
    doc.choices[first] = ['fire'];
    doc.choices[second] = ['fire'];
    const warning =
      'Elemental Adept: you already have Fire from Elemental Adept (feat); choose another.';
    expect(deriveSheet(doc, ctx).warnings.filter((w) => w === warning)).toHaveLength(1);
  });

  it('is not held by a saved pick whose copy of the feat has gone', () => {
    const doc = docWith([adeptOld, 'i1']);
    doc.choices[second] = ['cold'];
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.id === first);
    expect(prompt?.options.find((o) => o.id === 'cold')?.disabled).toBeUndefined();
  });

  it('is not held by a resistance pick of the same word', () => {
    const doc = docWith([adeptOld, 'i1'], [warded, 'i2']);
    doc.choices[idOf(warded, 'i2', 'resist:r0')] = ['cold'];
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.id === first);
    expect(prompt?.options.find((o) => o.id === 'cold')?.disabled).toBeUndefined();
  });
});

describe('a weapon mastery only the prose asks for', () => {
  const promptId = idOf(masterNew, 'i1', 'weaponMastery');

  it('offers the kinds of weapon with a mastery, firearms aside, and says which it has', () => {
    const prompt = deriveSheet(docWith([masterNew, 'i1']), ctx).pending.find(
      (p) => p.id === promptId,
    );
    expect(prompt?.options.map((o) => o.id)).toEqual(['Fake Blade', 'Fake Mind Blade']);
    expect(prompt?.options[0]?.description).toBe('Nick. Martial melee · 1d8 slashing');
    expect(prompt?.options[1]?.description).toMatch(/^Vex\. Simple melee/);
  });

  it('shows the pick on the card', () => {
    const doc = docWith([masterNew, 'i1']);
    doc.choices[promptId] = ['Fake Blade'];
    expect(deriveSheet(doc, ctx).features.map((f) => f.name)).toContain(
      'Weapon Master (Fake Blade)',
    );
  });

  it('lets the attack with that kind of weapon use its mastery', () => {
    const doc = docWith([masterNew, 'i1']);
    doc.equipment = [
      {
        id: 'e1',
        ref: { name: 'Fake Blade', source: 'XPHB' },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    const tags = () =>
      deriveSheet(doc, ctx).attacks.find((a) => a.label === 'Fake Blade')?.properties ?? [];
    expect(tags()).not.toContain('mastery: nick');
    doc.choices[promptId] = ['Fake Blade'];
    expect(tags()).toContain('mastery: nick');
  });
});

describe('an optional feature pick on a feat', () => {
  const promptId = idOf(stance, 'i1', 'optfeature:FS:T');

  it('reads the feat progression, at any level', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), ctx);
    collectFeatEntity(col, twoStances, 'stance scholar|hb', 'i1');
    const prompt = col.pending[0];
    expect(prompt?.kind).toBe('optionalfeature');
    expect(prompt?.label).toBe('Combat Stance');
    expect(prompt?.count).toBe(2);
  });

  it('adds a card under the feat, and curated effects, once picked', () => {
    const doc = docWith([stance, 'i1']);
    doc.choices[promptId] = ['archery|phb'];
    const sheet = deriveSheet(doc, ctx);
    const card = sheet.features.find((f) => f.name === 'Combat Stance: Archery');
    expect(card?.origin.type).toBe('feat');
    expect(sheet.pending.map((p) => p.id)).not.toContain(promptId);
  });

  it('closes what the class already picked', () => {
    const prompt = deriveSheet(docWith([stance, 'i1']), ctx).pending.find((p) => p.id === promptId);
    expect(prompt?.options.find((o) => o.id === 'defense|phb')?.disabled?.reason).toBe(
      'You already have this from Warrior (class).',
    );
    expect(prompt?.options.find((o) => o.id === 'archery|phb')?.disabled).toBeUndefined();
  });

  it('leaves its own picks open, so a multi-pick can still be undone', () => {
    const doc = docWith([twoStances, 'i1']);
    const id = idOf(twoStances, 'i1', 'optfeature:FS:T');
    doc.choices[id] = ['archery|phb'];
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.id === id);
    expect(prompt?.options.find((o) => o.id === 'archery|phb')?.disabled).toBeUndefined();
  });

  it('warns when the class and the feat have come to hold the same pick', () => {
    const doc = docWith([stance, 'i1']);
    doc.choices[promptId] = ['defense|phb'];
    const warning =
      'Stance Student: you already have Defense (PHB) from Warrior (class); choose another.';
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.warnings).toContain(warning);
    const made = sheet.resolvedChoices.find((r) => r.prompt.id === promptId);
    expect(made?.prompt.options.find((o) => o.id === 'defense|phb')?.disabled).toBeUndefined();
  });

  it('does not change what a class prompt offers', () => {
    const doc = docWith([stance, 'i1']);
    doc.choices[promptId] = ['archery|phb'];
    delete doc.choices['class:warrior|tst:optfeature:FS:T'];
    const prompt = deriveSheet(doc, ctx).pending.find(
      (p) => p.id === 'class:warrior|tst:optfeature:FS:T',
    );
    expect(prompt?.options.find((o) => o.id === 'archery|phb')?.disabled).toBeUndefined();
  });
});

describe('the invocation pick', () => {
  const promptId = idOf(invoker, 'i1', 'optfeature:ZZ');
  const abilityId = idOf(invoker, 'i1', 'castingAbility');
  const options = (doc: CharacterDoc) =>
    deriveSheet(doc, ctx).pending.find((p) => p.id === promptId)?.options ?? [];

  it('closes every option with a prerequisite to a character of another class', () => {
    const listed = options(docWith([invoker, 'i1']));
    expect(listed.find((o) => o.id === 'open secret|hb')?.disabled).toBeUndefined();
    for (const id of ['late secret|hb', 'pact secret|hb']) {
      expect(listed.find((o) => o.id === id)?.disabled?.reason).toBe(
        'Has a prerequisite, so only a warlock who meets it can take this',
      );
    }
  });

  it('holds a warlock to the prerequisite by their warlock level, not their total', () => {
    const warlockAt = (levels: number) => {
      const doc = docWith([invoker, 'i1']);
      doc.classes.push({ ref: { name: 'Warlock', source: 'TST' }, levels, hp: [] });
      return options(doc);
    };
    expect(warlockAt(1).find((o) => o.id === 'late secret|hb')?.disabled?.reason).toBe(
      'Requires level 5',
    );
    expect(warlockAt(5).find((o) => o.id === 'late secret|hb')?.disabled).toBeUndefined();
    expect(warlockAt(1).find((o) => o.id === 'pact secret|hb')?.disabled).toBeUndefined();
  });

  it('asks for the spellcasting ability too, and shows it on the card', () => {
    const doc = docWith([invoker, 'i1']);
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.id === abilityId);
    expect(prompt?.kind).toBe('ability');
    expect(prompt?.options.map((o) => o.id)).toEqual(['int', 'wis', 'cha']);
    doc.choices[abilityId] = ['cha'];
    expect(deriveSheet(doc, ctx).features.map((f) => f.name)).toContain('Eldritch Adept (CHA)');
  });

  it("casts an invocation's spell with the ability it picked", () => {
    const doc = docWith([invoker, 'i1']);
    doc.choices[promptId] = ['spoken secret|hb'];
    const whisper = () =>
      deriveSheet(doc, ctx).grantedSpells.find((g) => g.name === 'fake whisper');
    expect(whisper()).toMatchObject({ origin: 'Eldritch Invocations: Spoken Secret' });
    expect(whisper()?.ability).toBeUndefined();
    doc.choices[abilityId] = ['wis'];
    expect(whisper()).toMatchObject({ ability: 'wis', usage: undefined });
  });
});
