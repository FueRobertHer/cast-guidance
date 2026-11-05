import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type DataEntity, newCharacterDoc } from '../types';
import { Collector } from './base';
import { collectClasses } from './class';
import { collectFeatEntity, collectFeats } from './feat';

function collect(feat: DataEntity) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
  collectFeatEntity(col, feat, 'testfeat|tst', 'i1');
  return col;
}

describe('collectFeatEntity', () => {
  it('emits senses from a senses block', () => {
    const col = collect({ name: 'Darksight', senses: [{ darkvision: 60 }] });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'sense', sense: 'darkvision', range: 60 }),
    );
  });

  it('grants expertise for a fixed named skill', () => {
    const col = collect({ name: 'Expert', expertise: [{ Stealth: true }] });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'skillProf', skill: 'Stealth', level: 2 }),
    );
  });

  it('always pushes a feature card for the feat', () => {
    const col = collect({ name: 'Lucky', entries: ['You have 3 luck points.'] });
    expect(col.features.some((f) => f.name === 'Lucky')).toBe(true);
  });
});

describe('a chosen spell, from the feat to the sheet', () => {
  const feat: DataEntity = {
    name: 'Pick Test',
    source: 'HB',
    additionalSpells: [
      {
        ability: 'int',
        known: { _: [{ choose: 'level=0' }] },
        innate: { _: { daily: { 1: [{ choose: 'level=1' }] } } },
      },
    ],
  };
  const base = makeTestContext();
  const ctx = {
    get: (type: string, name: string, source?: string) =>
      type === 'feat' && name.toLowerCase() === 'pick test' ? feat : base.get(type, name, source),
    byType: (type: string) => base.byType(type),
  };
  const docWithFeat = () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Fighter', source: 'TST' }, levels: 1, hp: ['avg'] }];
    doc.feats = [{ ref: { name: 'Pick Test', source: 'HB' }, instanceId: 'i1' }];
    return doc;
  };
  const cantripId = 'feat:pick test|hb:i1:spell:u:0:known:_:0';
  const spellId = 'feat:pick test|hb:i1:spell:u:0:innate:_:0';

  it('is pending until picked, then reaches the sheet with its pool, after a save and load', () => {
    const doc = docWithFeat();
    const before = deriveSheet(doc, ctx);
    expect(before.pending.map((p) => p.id)).toEqual(expect.arrayContaining([cantripId, spellId]));
    expect(before.warnings.join()).not.toContain('choose a spell');

    doc.choices[cantripId] = ['Fake Spark|HB'];
    doc.choices[spellId] = ['Fake Ward|HB'];
    const saved = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const after = deriveSheet(saved, ctx);

    expect(after.pending.filter((p) => p.kind === 'spell')).toEqual([]);
    expect(after.grantedSpells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Fake Spark',
          source: 'HB',
          ability: 'int',
          usage: undefined,
          origin: 'Pick Test',
        }),
        expect.objectContaining({
          name: 'Fake Ward',
          source: 'HB',
          ability: 'int',
          usage: '1/day',
          origin: 'Pick Test',
        }),
      ]),
    );
    expect(after.resources.find((r) => r.label === 'Fake Ward')?.max).toBe(1);
    expect(after.resolvedChoices.map((r) => r.prompt.id)).toEqual(
      expect.arrayContaining([cantripId, spellId]),
    );
  });
});

describe('an inherited casting ability', () => {
  const grants = (feat: DataEntity, choices: Record<string, string> = {}) => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
    Object.assign(col.doc.choices, choices);
    collectFeatEntity(col, feat, 'gift|hb', 'i1');
    return col.effects.filter((e) => e.kind === 'grantSpell');
  };
  const inherits: DataEntity = {
    name: 'Gift',
    ability: [{ choose: { from: ['int', 'wis', 'cha'] } }],
    additionalSpells: [{ ability: 'inherit', known: { _: ['fake spark'] } }],
  };
  const picked = { 'feat:gift|hb:i1:ability:c0': 'wis' };

  it('is the ability the same feat raised', () => {
    expect(grants(inherits, picked)).toMatchObject([{ ability: 'wis' }]);
  });

  it('is a fixed raise too', () => {
    expect(grants({ ...inherits, ability: [{ cha: 1 }] })).toMatchObject([{ ability: 'cha' }]);
  });

  it('waits for the pick, granting the spell meanwhile', () => {
    const [grant] = grants(inherits);
    expect(grant).toMatchObject({ spell: { name: 'fake spark' } });
    expect(grant).not.toHaveProperty('ability', expect.anything());
  });

  it('names no ability when the feat raised two', () => {
    const [grant] = grants({ ...inherits, ability: [{ int: 1, wis: 1 }] });
    expect(grant).not.toHaveProperty('ability', expect.anything());
  });

  it('is not the raise of a feat built on another feat, whose choice it inherits', () => {
    const builtOn = { ...inherits, prerequisite: [{ feat: ['first gift|hb'] }] };
    const [grant] = grants(builtOn, picked);
    expect(grant).not.toHaveProperty('ability', expect.anything());
  });

  it('does not reach an entry that names no ability, or one that names its own', () => {
    const feat = {
      ...inherits,
      additionalSpells: [
        { known: { _: ['fake spark'] } },
        { ability: 'int', known: { _: ['fake ward'] } },
      ],
    };
    const [none, own] = grants(feat, picked);
    expect(none).not.toHaveProperty('ability', expect.anything());
    expect(own).toMatchObject({ ability: 'int' });
  });
});

describe('a limited always-prepared spell on the sheet', () => {
  const feat: DataEntity = {
    name: 'Sigil',
    source: 'HB',
    additionalSpells: [{ ability: 'int', prepared: { _: { daily: { 1: ['fake ward|hb'] } } } }],
  };
  const base = makeTestContext();
  const ctx = {
    get: (type: string, name: string, source?: string) => {
      if (type === 'feat' && name.toLowerCase() === 'sigil') return feat;
      if (type === 'class' && name === 'Half Test') {
        const sorcerer = base.get('class', 'Sorcerer', 'TST');
        return { ...sorcerer, name, casterProgression: '1/2' };
      }
      return base.get(type, name, source);
    },
    byType: (type: string) => base.byType(type),
  };
  const rowsOf = (className: string, levels = 3) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [
      { ref: { name: className, source: 'TST' }, levels, hp: Array(levels).fill('avg') },
    ];
    doc.feats = [{ ref: { name: 'Sigil', source: 'HB' }, instanceId: 'i1' }];
    return deriveSheet(doc, ctx).grantedSpells.map((g) => g.usage);
  };

  it('has only its free uses for a character with no spellcasting', () => {
    expect(rowsOf('Warrior')).toEqual(['1/day']);
  });

  it('has its slots row too for a caster', () => {
    expect(rowsOf('Sorcerer')).toEqual(['prepared', '1/day']);
  });

  it('waits for a half caster to have slots before giving it a slots row', () => {
    expect(rowsOf('Half Test', 1)).toEqual(['1/day']);
    expect(rowsOf('Half Test', 2)).toEqual(['prepared', '1/day']);
  });
});

describe('collectFeats', () => {
  it('warns for a feat the registry does not have', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.feats = [{ ref: { name: 'Nonexistent', source: 'TST' }, instanceId: 'i1' }];
    const col = new Collector(doc, makeTestContext());
    collectFeats(col);
    expect(col.warnings).toContainEqual(expect.stringMatching(/Feat not found: nonexistent\|tst/i));
  });
});

describe('non-repeatable feat dedup (FIX-004)', () => {
  const darksight: DataEntity = { name: 'Darksight', senses: [{ darkvision: 60 }] };

  it('applies a non-repeatable feat once even when collected twice', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
    // Same feat granted (background) and chosen (ASI), or picked at two levels.
    collectFeatEntity(col, darksight, 'darksight|tst', 'background');
    collectFeatEntity(col, darksight, 'darksight|tst', 'asi8');
    const senses = col.effects.filter((e) => e.kind === 'sense' && e.sense === 'darkvision');
    expect(senses).toHaveLength(1);
    expect(col.warnings).toContainEqual(expect.stringMatching(/not a repeatable feat/i));
  });

  it('keeps independent instances of a repeatable feat', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
    const boon: DataEntity = { name: 'Boon', repeatable: true, senses: [{ darkvision: 60 }] };
    collectFeatEntity(col, boon, 'boon|tst', 'asi4');
    collectFeatEntity(col, boon, 'boon|tst', 'asi8');
    const senses = col.effects.filter((e) => e.kind === 'sense' && e.sense === 'darkvision');
    expect(senses).toHaveLength(2);
    expect(col.warnings).not.toContainEqual(expect.stringMatching(/not a repeatable feat/i));
  });

  it('scopes a feat spell-branch choice to the feat instance (FIX-001 wiring)', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
    const feat: DataEntity = {
      name: 'Branchy',
      additionalSpells: [
        { name: 'Fire', known: { _: ['fire bolt'] } },
        { name: 'Frost', known: { _: ['ray of frost'] } },
      ],
    };
    collectFeatEntity(col, feat, 'branchy|tst', 'asi4');
    const prompt = col.pending.find((p) => p.id === 'feat:branchy|tst:asi4:branch');
    expect(prompt).toBeDefined();
    expect(prompt?.options.map((o) => o.label)).toEqual(['Fire', 'Frost']);
  });

  it('disables an already-taken non-repeatable feat in the ASI picker', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
    ];
    doc.choices['class:warrior|tst:asi:4'] = 'feat'; // resolve ASI-or-feat to Feat
    doc.choices['class:warrior|tst:asi:8:feat'] = ['alert|phb']; // Alert taken elsewhere
    const col = new Collector(doc, makeTestContext());
    collectClasses(col);
    const prompt = col.pending.find((p) => p.id === 'class:warrior|tst:asi:4:feat');
    expect(prompt).toBeDefined();
    const alert = prompt?.options.find((o) => o.id === 'alert|phb');
    expect(alert?.disabled?.reason).toMatch(/already taken/i);
  });
});
