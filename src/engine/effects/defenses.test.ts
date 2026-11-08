import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type EngineContext,
  type EquipmentEntry,
  newCharacterDoc,
} from '../types';

/** A context holding only the given entities, looked up by type and name. */
function world(entities: Array<DataEntity & { type_: string }>): EngineContext {
  return {
    get: (type, name, source) =>
      entities.find(
        (e) =>
          e.type_ === type &&
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      ),
    byType: (type) => entities.filter((e) => e.type_ === type),
  };
}

function wearing(item: DataEntity, attuned = false, equipped = true): CharacterDoc {
  const doc = newCharacterDoc('c', 'Hild', 't');
  const entry: EquipmentEntry = {
    id: 'e1',
    ref: { name: String(item.name), source: String(item.source) },
    qty: 1,
    equipped,
    attuned,
  };
  doc.equipment = [entry];
  return doc;
}

const item = (fields: DataEntity): DataEntity & { type_: string } => ({
  type_: 'item',
  source: 'TST',
  ...fields,
});

describe('defenses an equipped item gives', () => {
  const ring = item({ name: 'Ring of Testing', type: 'RG', resist: ['fire'] });
  const periapt = item({
    name: 'Amulet of Tests',
    reqAttune: true,
    immune: ['poison'],
    conditionImmune: ['poisoned'],
    vulnerable: ['radiant'],
  });
  const ctx = world([ring, periapt]);

  it('reads resistance from an item that needs no attunement, under its name', () => {
    const sheet = deriveSheet(wearing(ring), ctx);
    expect(sheet.resists).toEqual([{ damageType: 'fire', origin: 'Ring of Testing' }]);
    // No save bonus in its data, so no part for it on a save.
    expect(sheet.saves.dex.total.parts.map((p) => p.label)).toEqual(['DEX modifier']);
  });

  it('gives nothing from an item in the pack', () => {
    expect(deriveSheet(wearing(ring, false, false), ctx).resists).toEqual([]);
  });

  it('waits on attunement when the item asks for it', () => {
    const off = deriveSheet(wearing(periapt), ctx);
    expect([off.immunities, off.conditionImmunities, off.vulnerabilities]).toEqual([[], [], []]);

    const on = deriveSheet(wearing(periapt, true), ctx);
    expect(on.immunities).toEqual([{ damageType: 'poison', origin: 'Amulet of Tests' }]);
    expect(on.conditionImmunities).toEqual([{ condition: 'poisoned', origin: 'Amulet of Tests' }]);
    expect(on.vulnerabilities).toEqual([{ damageType: 'radiant', origin: 'Amulet of Tests' }]);
  });

  it('counts a "by a wizard" attunement as needing it, and "optional" as not', () => {
    const staff = item({ name: 'Staff of Tests', reqAttune: 'by a wizard', resist: ['cold'] });
    const charm = item({ name: 'Charm of Tests', reqAttune: 'optional', resist: ['acid'] });
    const both = world([staff, charm]);
    expect(deriveSheet(wearing(staff), both).resists).toEqual([]);
    expect(deriveSheet(wearing(staff, true), both).resists).toHaveLength(1);
    expect(deriveSheet(wearing(charm), both).resists).toHaveLength(1);
  });

  it('gives nothing from a potion, whose resistance comes once it is drunk', () => {
    const potion = item({ name: 'Potion of Testing', type: 'P', resist: ['fire'] });
    expect(deriveSheet(wearing(potion), world([potion])).resists).toEqual([]);
  });

  it('takes the corrected tags where the data names more than wearing gives', () => {
    // The 2024 periapt's tags leave out the condition its text names.
    const periapt2024 = item({
      name: 'Periapt of Proof against Poison',
      source: 'XDMG',
      reqAttune: true,
      immune: ['poison'],
    });
    // One immunity is picked when attuning; the tags list every option.
    const mace = item({
      name: 'Nightbringer',
      source: 'MCV2DC',
      reqAttune: true,
      immune: ['acid', 'cold'],
      conditionImmune: ['charmed'],
    });
    const ctx2 = world([periapt2024, mace]);
    const worn = deriveSheet(wearing(periapt2024, true), ctx2);
    expect(worn.immunities.map((i) => i.damageType)).toEqual(['poison']);
    expect(worn.conditionImmunities.map((c) => c.condition)).toEqual(['poisoned']);

    const wielded = deriveSheet(wearing(mace, true), ctx2);
    expect(wielded.immunities).toEqual([]);
    expect(wielded.conditionImmunities.map((c) => c.condition)).toEqual(['charmed']);
  });
});

describe('a save bonus an equipped item gives', () => {
  const cloak = item({
    name: 'Cloak of Testing',
    reqAttune: true,
    bonusAc: '+1',
    bonusSavingThrow: '+1',
  });

  it('adds to every save, named for the item, attuned or not as its AC bonus is', () => {
    const sheet = deriveSheet(wearing(cloak), world([cloak]));
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(sheet.saves[a].total.value).toBe(1);
      expect(sheet.saves[a].total.parts).toContainEqual({ label: 'Cloak of Testing', amount: 1 });
    }
  });

  it('takes a penalty as well', () => {
    const stone = item({ name: 'Stone of Tests', bonusSavingThrow: '-2' });
    expect(deriveSheet(wearing(stone), world([stone])).saves.wis.total.value).toBe(-2);
  });

  it('reaches only the ability the item names, where the tag says every save', () => {
    const gear = item({ name: 'Far Gear', source: 'AI', bonusSavingThrow: '+1' });
    const sheet = deriveSheet(wearing(gear), world([gear]));
    expect(sheet.saves.cha.total.value).toBe(1);
    expect(sheet.saves.str.total.value).toBe(0);
  });

  it('leaves out a bonus that only holds sometimes', () => {
    const rod = item({ name: 'Rod of Alertness', source: 'DMG', bonusSavingThrow: '+1' });
    expect(deriveSheet(wearing(rod), world([rod])).saves.dex.total.value).toBe(0);
  });
});

describe('defenses and speeds a species gives', () => {
  const species = {
    type_: 'race',
    name: 'Testkin',
    source: 'TST',
    speed: { walk: 30, fly: true, climb: 20 },
    resist: ['necrotic'],
    immune: ['poison'],
    vulnerable: ['bludgeoning'],
    conditionImmune: ['poisoned', { conditionImmune: ['charmed'], note: 'malformed' }],
  };
  const sub = {
    type_: 'subrace',
    name: 'Deep',
    source: 'TST',
    raceName: 'Testkin',
    raceSource: 'TST',
    speed: { walk: 35, swim: 40 },
  };
  const ctx = world([species, sub]);
  const doc = () => {
    const d = newCharacterDoc('c', 'Hild', 't');
    d.race = { name: 'Testkin', source: 'TST' };
    return d;
  };

  it('reads immunities, vulnerabilities and condition immunities beside resistance', () => {
    const sheet = deriveSheet(doc(), ctx);
    expect(sheet.resists).toEqual([{ damageType: 'necrotic', origin: 'Testkin' }]);
    expect(sheet.immunities).toEqual([{ damageType: 'poison', origin: 'Testkin' }]);
    expect(sheet.vulnerabilities).toEqual([{ damageType: 'bludgeoning', origin: 'Testkin' }]);
    expect(sheet.conditionImmunities).toEqual([{ condition: 'poisoned', origin: 'Testkin' }]);
  });

  it('reads fly and climb speeds, `true` as fast as the character walks', () => {
    const d = doc();
    d.customEffects = [
      { kind: 'speedBonus', amount: 10, origin: { label: 'Boots', uid: 'b', type: 'custom' } },
    ];
    expect(deriveSheet(d, ctx).otherSpeeds).toEqual([
      { mode: 'fly', value: 40, origin: 'Testkin' },
      { mode: 'climb', value: 20, origin: 'Testkin' },
    ]);
  });

  it("adds a subrace's swim speed to the species' own", () => {
    const d = doc();
    d.subrace = { name: 'Deep', source: 'TST' };
    expect(deriveSheet(d, ctx).otherSpeeds).toEqual([
      { mode: 'fly', value: 35, origin: 'Testkin' },
      { mode: 'climb', value: 20, origin: 'Testkin' },
      { mode: 'swim', value: 40, origin: 'Deep' },
    ]);
  });

  it('reads a speed given as a number in an object', () => {
    const owl = { type_: 'race', name: 'Owlkin', source: 'TST', speed: { walk: 25, fly: { number: 50 } } };
    const d = newCharacterDoc('c', 'Hild', 't');
    d.race = { name: 'Owlkin', source: 'TST' };
    expect(deriveSheet(d, world([owl])).otherSpeeds).toEqual([
      { mode: 'fly', value: 50, origin: 'Owlkin' },
    ]);
  });
});

describe('defenses a feat gives', () => {
  const boon = {
    type_: 'feat',
    name: 'Boon of Tests',
    source: 'TST',
    immune: ['radiant'],
    conditionImmune: ['frightened'],
    vulnerable: [{ choose: { from: ['cold', 'fire'] } }],
  };
  const ctx = world([boon]);

  it('reads immunity and condition immunity, and asks which vulnerability', () => {
    const doc = newCharacterDoc('c', 'Hild', 't');
    doc.feats = [{ ref: { name: 'Boon of Tests', source: 'TST' }, instanceId: 'f1' }];
    const before = deriveSheet(doc, ctx);
    expect(before.immunities).toEqual([{ damageType: 'radiant', origin: 'Boon of Tests' }]);
    expect(before.conditionImmunities).toEqual([
      { condition: 'frightened', origin: 'Boon of Tests' },
    ]);
    const prompt = before.pending.find((p) => p.label === 'Damage vulnerability');
    expect(prompt?.id).toBe('feat:boon of tests|tst:f1:vulnerable:r0');

    doc.choices[prompt?.id ?? ''] = ['fire'];
    expect(deriveSheet(doc, ctx).vulnerabilities).toEqual([
      { damageType: 'fire', origin: 'Boon of Tests' },
    ]);
  });
});
