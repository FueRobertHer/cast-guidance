import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type DataEntity, type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { Collector } from './base';
import { readOptionalFeatures } from './optionalFeatures';

// Invented options: what they grant is the point, not any book's wording.
const options: DataEntity[] = [
  {
    name: 'Whisper Secret',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ innate: { _: ['fake whisper'] } }],
    entries: ['Speak a secret.'],
  },
  {
    name: 'Daily Secret',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ innate: { _: { daily: { '1e': ['fake daily'] } } } }],
    entries: [
      'You can also cast {@spell fake daily} once without expending a spell slot. You regain the ability to do so when you finish a long rest.',
    ],
  },
  {
    name: 'Slot Secret',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ innate: { _: { daily: { '1e': ['fake slotted'] } } } }],
    entries: [
      "You can cast {@spell fake slotted} once using a spell slot. You can't do so again until you finish a long rest.",
    ],
  },
  {
    name: 'Late Gift',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ innate: { 7: ['fake late'] } }],
    entries: ['Only later.'],
  },
  {
    name: 'Own Voice',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ ability: 'wis', known: { _: ['fake own'] } }],
    entries: ['Cast with another voice.'],
  },
  {
    name: 'Costly Form',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [
      {
        ability: 'wis',
        resourceName: 'Focus',
        innate: { _: { resource: { 2: ['fake bought'] }, will: ['fake free'] } },
      },
    ],
    entries: ['Spend points to cast.'],
  },
  {
    name: 'Picked Tome',
    source: 'HB',
    featureType: ['QQ'],
    additionalSpells: [{ known: { _: [{ choose: 'level=0', count: 2 }] } }],
    entries: ['Learn two cantrips.'],
  },
];

const base = makeTestContext();
const ctx = {
  ...base,
  get: (type: string, name: string, source?: string) =>
    (type === 'optionalfeature'
      ? options.find((o) => String(o.name).toLowerCase() === name.toLowerCase())
      : undefined) ?? base.get(type, name, source),
  byType: (type: string) => (type === 'optionalfeature' ? options : base.byType(type)),
};

const host: DataEntity = {
  name: 'Secret Keeper',
  source: 'HB',
  optionalfeatureProgression: [{ name: 'Secrets', featureType: ['QQ'], progression: { 1: 1 } }],
};
const origin: EffectOrigin = { label: 'Keeper', uid: 'keeper|hb', type: 'class' };
const promptId = 'class:keeper|hb:optfeature:QQ';

function pick(uids: string[], level = 1, choices: Record<string, string[]> = {}) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.choices = { [promptId]: uids, ...choices };
  const col = new Collector(doc, ctx);
  readOptionalFeatures(col, host, {
    idBase: 'class:keeper|hb',
    origin,
    level,
    spellAbility: 'cha',
  });
  return col;
}

const granted = (col: Collector) =>
  col.effects.filter(
    (e): e is Extract<EffectInput, { kind: 'grantSpell' }> => e.kind === 'grantSpell',
  );

describe('the spells a picked option gives', () => {
  it("are cast with the host's ability, under the option's name", () => {
    expect(granted(pick(['whisper secret|hb']))).toMatchObject([
      {
        spell: { name: 'fake whisper' },
        ability: 'cha',
        usage: undefined,
        origin: { label: 'Secrets: Whisper Secret', uid: 'whisper secret|hb', type: 'class' },
      },
    ]);
  });

  it('count their free casts in a pool of their own, which the prose does not count again', () => {
    const col = pick(['daily secret|hb']);
    const key = 'spell:daily secret|hb:fake-daily';
    expect(granted(col)).toMatchObject([
      { spell: { name: 'fake daily' }, usage: '1/day', resourceKey: key },
    ]);
    expect(col.effects.filter((e) => e.kind === 'resource')).toMatchObject([
      { key, max: 1, resetOn: 'long' },
    ]);
  });

  it("cast with the class's slots where the prose spends one, leaving the prose to count how often", () => {
    const col = pick(['slot secret|hb']);
    expect(granted(col)).toEqual([
      expect.objectContaining({ spell: { name: 'fake slotted', source: '' }, usage: 'prepared' }),
    ]);
    expect(granted(col)[0]).not.toHaveProperty('resourceKey');
    expect(col.effects.filter((e) => e.kind === 'resource')).toMatchObject([
      { key: 'slot-secret', max: 1, resetOn: 'long' },
    ]);
  });

  it("open by the host's level, not the character's", () => {
    expect(granted(pick(['late gift|hb'], 6))).toEqual([]);
    expect(granted(pick(['late gift|hb'], 7)).map((g) => g.spell.name)).toEqual(['fake late']);
  });

  it('keep an ability the option names', () => {
    expect(granted(pick(['own voice|hb']))).toMatchObject([{ ability: 'wis' }]);
  });

  it("leave out a spell bought with a pool's points, whose spend is the option's own", () => {
    expect(granted(pick(['costly form|hb'])).map((g) => g.spell.name)).toEqual(['fake free']);
  });

  it('ask for the spells an option lets you choose, under ids beside the prompt', () => {
    const id = 'class:keeper|hb:spells-of:picked tome|hb:spell:u:0:known:_:0';
    expect(pick(['picked tome|hb']).pending.map((p) => p.id)).toEqual([id]);
    // Saving the prompt clears what sits under its id (`OriginChoices`).
    expect(id.startsWith(`${promptId}:`)).toBe(false);
    const made = pick(['picked tome|hb'], 1, { [id]: ['Fake One|HB', 'Fake Two|HB'] });
    expect(granted(made).map((g) => g.spell.name)).toEqual(['Fake One', 'Fake Two']);
  });
});
