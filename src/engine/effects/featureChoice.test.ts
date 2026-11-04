import { describe, expect, it } from 'vitest';
import { makePickOneContext, pickOneDoc } from '../../../tests-fixtures/pickOneWorld';
import { deriveSheet } from '../derive';
import type { CharacterDoc, DerivedSheet } from '../types';

const ctx = makePickOneContext();
const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);

const featureNames = (sheet: DerivedSheet) => sheet.features.map((f) => f.name);
const featurePrompts = (sheet: DerivedSheet) => sheet.pending.filter((p) => p.kind === 'feature');

const CLERIC = { name: 'Cleric', source: 'XPHB' };
const BLESSED = 'class:cleric|xphb:feature:blessed strikes:7';
const DIVINE_ORDER = 'class:cleric|xphb:feature:divine order:1';

describe('2024 Cleric: Blessed Strikes and Divine Order', () => {
  it('opens Divine Order at level 1 and Blessed Strikes only from level 7', () => {
    expect(featurePrompts(derive(pickOneDoc(CLERIC, 6))).map((p) => p.id)).toEqual([DIVINE_ORDER]);
    expect(featurePrompts(derive(pickOneDoc(CLERIC, 7))).map((p) => p.id)).toEqual([
      DIVINE_ORDER,
      BLESSED,
    ]);
  });

  it('offers each branch as an option card with its text, and grants neither unpicked', () => {
    const sheet = derive(pickOneDoc(CLERIC, 7));
    const prompt = sheet.pending.find((p) => p.id === BLESSED);
    expect(prompt).toMatchObject({
      kind: 'feature',
      count: 1,
      label: 'Level 7: Blessed Strikes',
      origin: { type: 'class', uid: 'cleric|xphb' },
    });
    expect(prompt?.options).toEqual([
      {
        id: 'divine strike',
        label: 'Divine Strike',
        description: 'Once on each of your turns, a weapon hit deals an extra 1d8 radiant damage.',
        entries: ['Once on each of your turns, a weapon hit deals an extra 1d8 radiant damage.'],
      },
      expect.objectContaining({ id: 'potent spellcasting', label: 'Potent Spellcasting' }),
    ]);
    // The parent card stays; the branches wait for the pick.
    expect(featureNames(sheet)).toContain('Blessed Strikes');
    expect(featureNames(sheet)).not.toContain('Divine Strike');
    expect(featureNames(sheet)).not.toContain('Potent Spellcasting');
    expect(sheet.actions.some((a) => a.label === 'Potent Spellcasting')).toBe(false);
  });

  it('shows the picked branch, its effects, and not the other', () => {
    const sheet = derive(
      pickOneDoc(CLERIC, 7, { choices: { [BLESSED]: ['potent spellcasting'] } }),
    );
    expect(featureNames(sheet)).toContain('Potent Spellcasting');
    expect(featureNames(sheet)).not.toContain('Divine Strike');
    expect(sheet.actions).toContainEqual(
      expect.objectContaining({ label: 'Potent Spellcasting', economy: 'reaction' }),
    );
    expect(sheet.pending.some((p) => p.id === BLESSED)).toBe(false);
    expect(sheet.resolvedChoices).toContainEqual(
      expect.objectContaining({ selected: ['potent spellcasting'] }),
    );
    const card = sheet.features.find((f) => f.name === 'Potent Spellcasting');
    expect(card).toMatchObject({ level: 7, origin: { type: 'class', uid: 'cleric|xphb' } });
  });

  it('adds the Thaumaturge’s WIS, at least +1, to Arcana and Religion checks', () => {
    // WIS 10: the +0 modifier rises to the stated minimum.
    const sheet = derive(pickOneDoc(CLERIC, 1, { choices: { [DIVINE_ORDER]: ['thaumaturge'] } }));
    const bonus = { label: 'Thaumaturge', amount: 1 };
    expect(sheet.skills.Arcana?.total.parts).toContainEqual(bonus);
    expect(sheet.skills.Religion?.total.parts).toContainEqual(bonus);
    expect(sheet.skills.Nature?.total.parts).not.toContainEqual(bonus);
  });

  it('keeps a save from before the pick existed open, losing nothing else', () => {
    // A level 7 Cleric saved under v2.32.0 had no Blessed Strikes key at all.
    const before = pickOneDoc(CLERIC, 7, {
      choices: { [DIVINE_ORDER]: ['thaumaturge'] },
    });
    const sheet = derive(before);
    expect(featurePrompts(sheet).map((p) => p.id)).toEqual([BLESSED]);
    expect(featureNames(sheet)).toContain('Thaumaturge');
    expect(sheet.warnings).toEqual([]);
  });

  it('reopens a saved pick that names no branch, with a warning', () => {
    const sheet = derive(pickOneDoc(CLERIC, 7, { choices: { [BLESSED]: ['divine smite'] } }));
    expect(sheet.pending.some((p) => p.id === BLESSED)).toBe(true);
    expect(sheet.warnings).toContainEqual(expect.stringContaining('“divine smite”'));
    expect(featureNames(sheet)).not.toContain('Divine Strike');
  });

  it('matches a saved pick without regard to case', () => {
    const sheet = derive(pickOneDoc(CLERIC, 7, { choices: { [BLESSED]: ['Divine Strike'] } }));
    expect(featureNames(sheet)).toContain('Divine Strike');
  });
});

describe('2014 Ranger: Hunter', () => {
  const doc = (choices: CharacterDoc['choices'] = {}) =>
    pickOneDoc({ name: 'Ranger', source: 'PHB' }, 3, {
      subclass: { name: 'Hunter', source: 'PHB' },
      choices,
    });
  const PREY = "subclass:hunter|phb:feature:hunter's prey:3";

  it("asks for Hunter's Prey under the subclass", () => {
    const prompt = derive(doc()).pending.find((p) => p.id === PREY);
    expect(prompt?.origin).toMatchObject({ type: 'subclass', uid: 'hunter|phb', label: 'Hunter' });
    expect(prompt?.options.map((o) => o.label)).toEqual([
      'Colossus Slayer',
      'Giant Killer',
      'Horde Breaker',
    ]);
  });

  it('grants only the picked branch', () => {
    const sheet = derive(doc({ [PREY]: ['giant killer'] }));
    expect(featureNames(sheet)).toEqual(expect.arrayContaining(['Hunter', "Hunter's Prey"]));
    expect(featureNames(sheet)).toContain('Giant Killer');
    expect(featureNames(sheet)).not.toContain('Colossus Slayer');
    expect(featureNames(sheet)).not.toContain('Horde Breaker');
    expect(sheet.actions).toContainEqual(
      expect.objectContaining({ label: 'Giant Killer', economy: 'reaction' }),
    );
  });
});

describe('2014 Barbarian: totems and storms', () => {
  const BARBARIAN = { name: 'Barbarian', source: 'PHB' };

  it('asks for each totem on its own, so the animals may differ', () => {
    const subclass = { name: 'Path of the Totem Warrior', source: 'PHB' };
    const sheet = derive(
      pickOneDoc(BARBARIAN, 6, {
        subclass,
        choices: {
          'subclass:path of the totem warrior|phb:feature:totem spirit:3': ['bear'],
          'subclass:path of the totem warrior|phb:feature:aspect of the beast:6': ['elk'],
        },
      }),
    );
    expect(featurePrompts(sheet)).toEqual([]);
    const animals = sheet.features
      .filter((f) => ['Bear', 'Eagle', 'Elk', 'Tiger', 'Wolf'].includes(f.name))
      .map((f) => `${f.name} ${f.level}`);
    expect(animals).toEqual(['Bear 3', 'Elk 6']);
  });

  it("gives Storm Soul the Storm Aura's environment without asking again", () => {
    const subclass = { name: 'Path of the Storm Herald', source: 'XGE' };
    const AURA = 'subclass:path of the storm herald|xge:feature:storm aura:3';
    const unpicked = derive(pickOneDoc(BARBARIAN, 6, { subclass }));
    expect(featurePrompts(unpicked).map((p) => p.id)).toEqual([AURA]);
    expect(featureNames(unpicked)).toContain('Storm Soul');

    const sheet = derive(pickOneDoc(BARBARIAN, 6, { subclass, choices: { [AURA]: ['sea'] } }));
    expect(featurePrompts(sheet)).toEqual([]);
    const environments = sheet.features
      .filter((f) => ['Desert', 'Sea', 'Tundra'].includes(f.name))
      .map((f) => `${f.name} ${f.level}`);
    expect(environments).toEqual(['Sea 3', 'Sea 6']);
  });
});

describe('Artificer: Armor Model, which the data does not mark as a pick', () => {
  it('offers the TCE models as groups and grants only the picked group', () => {
    const doc = (choices: CharacterDoc['choices'] = {}) =>
      pickOneDoc({ name: 'Artificer', source: 'TCE' }, 3, {
        subclass: { name: 'Armorer', source: 'TCE' },
        choices,
      });
    const MODEL = 'subclass:armorer|tce:feature:armor model:3';
    const PARTS = [
      'Thunder Gauntlets',
      'Defensive Field',
      'Lightning Launcher',
      'Powered Steps',
      'Dampening Field',
    ];

    const unpicked = derive(doc());
    const prompt = unpicked.pending.find((p) => p.id === MODEL);
    expect(prompt?.options.map((o) => o.id)).toEqual(['guardian', 'infiltrator']);
    expect(prompt?.options[0]?.description).toBe('You design your armor for the front line.');
    // The info sheet reads each part in full, not as a list of names.
    expect(JSON.stringify(prompt?.options[0]?.entries)).toContain(
      '"name":"Thunder Gauntlets","entries":["Gauntlets deal 1d8 thunder damage."]',
    );
    expect(featureNames(unpicked).filter((n) => PARTS.includes(n))).toEqual([]);

    const sheet = derive(doc({ [MODEL]: ['guardian'] }));
    expect(featureNames(sheet).filter((n) => PARTS.includes(n))).toEqual([
      'Thunder Gauntlets',
      'Defensive Field',
    ]);
    expect(sheet.actions).toContainEqual(
      expect.objectContaining({ label: 'Defensive Field', economy: 'bonus' }),
    );
  });

  it('offers the three EFA models, each one ref', () => {
    const MODEL = 'subclass:armorer|efa:feature:armor model:3';
    const sheet = derive(
      pickOneDoc({ name: 'Artificer', source: 'EFA' }, 3, {
        subclass: { name: 'Armorer', source: 'EFA' },
        rulesVersion: '2024',
        choices: { [MODEL]: ['infiltrator'] },
      }),
    );
    expect(sheet.resolvedChoices.find((r) => r.prompt.id === MODEL)?.prompt.options).toHaveLength(
      3,
    );
    const models = featureNames(sheet).filter((n) =>
      ['Dreadnaught', 'Guardian', 'Infiltrator'].includes(n),
    );
    expect(models).toEqual(['Infiltrator']);
  });
});

describe('an options node with no count', () => {
  it('grants every Psi Warrior power, as the rules do, and asks nothing', () => {
    const sheet = derive(
      pickOneDoc({ name: 'Fighter', source: 'PHB' }, 3, {
        subclass: { name: 'Psi Warrior', source: 'TCE' },
      }),
    );
    expect(featurePrompts(sheet)).toEqual([]);
    expect(featureNames(sheet)).toEqual(
      expect.arrayContaining(['Protective Field', 'Psionic Strike', 'Telekinetic Movement']),
    );
  });
});

describe('a pick inside a picked branch', () => {
  const OUTER = 'class:nestling|tst:feature:outer pick:1';
  const INNER = `${OUTER}:path a:feature:path a:1`;

  it('is keyed under the branch, so swapping the branch can clear it', () => {
    const open = derive(
      pickOneDoc({ name: 'Nestling', source: 'TST' }, 1, { choices: { [OUTER]: ['path a'] } }),
    );
    expect(featurePrompts(open).map((p) => p.id)).toEqual([INNER]);

    const done = derive(
      pickOneDoc({ name: 'Nestling', source: 'TST' }, 1, {
        choices: { [OUTER]: ['path a'], [INNER]: ['leaf two'] },
      }),
    );
    expect(featureNames(done)).toEqual(['Outer Pick', 'Path A', 'Leaf Two']);
  });
});

describe('branches a pick cannot use as they stand', () => {
  const ODDLING = { name: 'Oddling', source: 'TST' };

  it('leaves out a branch above the class level', () => {
    const prompt = derive(pickOneDoc(ODDLING, 1)).pending.find(
      (p) => p.id === 'class:oddling|tst:feature:gated pick:1',
    );
    expect(prompt?.options.map((o) => o.id)).toEqual(['low road']);
  });

  it('keys two branches of one name by their refs, both of them', () => {
    const TWIN = 'class:oddling|tst:feature:twin pick:1';
    const prompt = derive(pickOneDoc(ODDLING, 1)).pending.find((p) => p.id === TWIN);
    expect(prompt?.options.map((o) => o.id)).toEqual([
      'twin|oddling|tst|1|tst',
      'twin|oddling|tst|1|xtst',
    ]);
    const sheet = derive(
      pickOneDoc(ODDLING, 1, { choices: { [TWIN]: ['twin|oddling|tst|1|xtst'] } }),
    );
    const twins = sheet.features.filter((f) => f.name === 'Twin');
    expect(twins.map((f) => f.entries)).toEqual([['The second twin.']]);
  });
});
