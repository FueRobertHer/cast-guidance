import { describe, expect, it } from 'vitest';
import type { RollEffects } from '@/engine/playRules';
import type { AttackRow, DerivedSheet, FeatureCard } from '@/engine/types';
import { SLOT_COST } from '@/engine/types';
import {
  actionKey,
  damageAdds,
  damageParts,
  entriesText,
  oncePerTurn,
  weaponNeed,
} from './damageAdds';

function row(over: Partial<AttackRow> = {}): AttackRow {
  return {
    label: 'Longsword',
    toHit: { value: 5, base: 5, overridden: false, parts: [] },
    damage: '1d8+3',
    extraDamage: [],
    properties: [],
    origin: 'Weapon',
    ...over,
  };
}

function feature(name: string, entries: unknown, label = 'Rogue'): FeatureCard {
  return {
    name,
    origin: { label, uid: label, type: 'class' },
    entries,
  } as unknown as FeatureCard;
}

const abilities = { str: { mod: 3 }, dex: { mod: 4 } } as unknown as DerivedSheet['abilities'];

describe('entriesText', () => {
  it('returns a string as it is', () => {
    expect(entriesText('Once per turn')).toBe('Once per turn');
  });

  it('joins nested arrays with spaces', () => {
    expect(entriesText(['a', ['b', 'c']])).toBe('a b c');
  });

  it('reads the entries, items and entry keys of an object', () => {
    expect(entriesText({ entries: 'x' }).trim()).toBe('x');
    expect(entriesText({ items: 'z' }).trim()).toBe('z');
    expect(entriesText({ entry: 'w' }).trim()).toBe('w');
    expect(entriesText({ entries: ['p', { items: ['q'] }], entry: 'r' }).split(/\s+/)).toEqual(
      expect.arrayContaining(['p', 'q', 'r']),
    );
  });

  it('gives an empty string for non-string values', () => {
    expect(entriesText(5)).toBe('');
    expect(entriesText(null)).toBe('');
    expect(entriesText(undefined)).toBe('');
    expect(entriesText(true)).toBe('');
  });
});

describe('oncePerTurn', () => {
  it.each([
    'Once per turn, you can deal extra damage.',
    'Once on each of your turns when you hit',
    'You can deal this extra damage only once per turn.',
    'once during each of your turns',
  ])('is true for %j', (text) => {
    expect(oncePerTurn(text)).toBe(true);
  });

  it.each([
    'When you hit a creature with a melee weapon attack, you can expend one spell slot',
    'once per day',
  ])('is false for %j', (text) => {
    expect(oncePerTurn(text)).toBe(false);
  });
});

describe('weaponNeed', () => {
  it('needs a finesse or ranged weapon', () => {
    expect(weaponNeed('The attack must use a finesse or a ranged weapon.')).toBe('finesseOrRanged');
  });

  it('needs a melee weapon', () => {
    expect(weaponNeed('When you hit a creature with a melee weapon attack')).toBe('melee');
  });

  it('needs any weapon for a generic weapon attack', () => {
    expect(weaponNeed('when you hit a creature with a weapon attack')).toBe('any');
  });

  it('needs any weapon when the text mentions both melee and ranged', () => {
    expect(weaponNeed('When you hit with a melee weapon attack or a ranged weapon attack')).toBe(
      'any',
    );
  });
});

describe('damageParts', () => {
  it('names the ability modifier alone', () => {
    expect(damageParts(row({ ability: 'str' }), '1d8+3', abilities)).toBe('STR +3');
  });

  it('adds the magic bonus from the to-hit parts', () => {
    const a = row({
      ability: 'str',
      toHit: {
        value: 5,
        base: 5,
        overridden: false,
        parts: [{ label: 'Magic bonus', amount: 1 }],
      },
    });
    expect(damageParts(a, '1d8+4', abilities)).toBe('STR +3 · Magic +1');
  });

  it('names a damage feature with what it adds past the ability', () => {
    expect(damageParts(row({ ability: 'str', damageFrom: ['Rage'] }), '1d8+5', abilities)).toBe(
      'STR +3 · Rage +2',
    );
  });

  it('joins two damage features with "and"', () => {
    const a = row({ ability: 'str', damageFrom: ['Rage', 'Dueling'] });
    expect(damageParts(a, '1d8+7', abilities)).toBe('STR +3 · Rage and Dueling +4');
  });

  it('gives an empty string for an attack with no ability', () => {
    expect(damageParts(row({ ability: undefined }), '1d8+3', abilities)).toBe('');
  });
});

describe('actionKey', () => {
  it('joins origin, label and economy', () => {
    expect(actionKey({ origin: 'Rogue', label: 'Sneak Attack', economy: 'none' })).toBe(
      'Rogue:Sneak Attack:none',
    );
  });
});

describe('damageAdds', () => {
  const sneakFeature = feature('Sneak Attack', [
    'Once per turn, you can deal extra damage. The attack must use a finesse or a ranged weapon.',
  ]);
  const sneak: DerivedSheet['actions'][number] = {
    economy: 'none',
    label: 'Sneak Attack',
    roll: '2d6',
    origin: 'Rogue',
  };
  const smiteFeature = feature(
    'Divine Smite',
    ['When you hit a creature with a melee weapon attack, you can expend a spell slot.'],
    'Paladin',
  );
  const smite: DerivedSheet['actions'][number] = {
    economy: 'none',
    label: 'Divine Smite',
    origin: 'Paladin',
    cost: {
      resource: SLOT_COST,
      amount: 1,
      slotDice: { die: 8, base: 1, maxDice: 5 },
    },
  };
  const noOffers: RollEffects['offers'] = [];

  it('offers Sneak Attack on a finesse melee weapon', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const out = damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'Rogue:Sneak Attack:none',
      source: 'Sneak Attack',
      dice: '2d6',
      kind: 'action',
      oncePerTurn: true,
      action: sneak,
    });
  });

  it('offers Sneak Attack on a ranged weapon', () => {
    const a = row({ ability: 'dex', ranged: true, properties: [] });
    const out = damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'action', dice: '2d6' });
  });

  it('does not offer Sneak Attack on a plain melee weapon', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    expect(damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action with a save', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const withSave = { ...sneak, save: { targetAbility: 'dex' as const, dc: 14 } };
    expect(damageAdds({ actions: [withSave], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action that heals', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const heals = { ...sneak, heals: true };
    expect(damageAdds({ actions: [heals], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action of plain dice', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const plain = { ...sneak, plainDice: true };
    expect(damageAdds({ actions: [plain], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('offers Divine Smite as a slot on a melee weapon, with no dice', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const out = damageAdds({ actions: [smite], features: [smiteFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'Paladin:Divine Smite:none',
      source: 'Divine Smite',
      kind: 'slot',
      oncePerTurn: false,
    });
    expect(out[0]?.dice).toBeUndefined();
  });

  it('does not offer Divine Smite on a ranged weapon', () => {
    const a = row({ ability: 'dex', ranged: true, properties: [] });
    expect(damageAdds({ actions: [smite], features: [smiteFeature] }, a, noOffers)).toEqual([]);
  });

  it('offers a Bardic Inspiration effect die with a College of Valor note', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d8', source: 'Bardic Inspiration', effectId: 'b1', once: true, ifFailed: false },
    ];
    const out = damageAdds({ actions: [], features: [] }, a, offers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'b1',
      source: 'Bardic Inspiration',
      dice: '1d8',
      kind: 'effect',
      oncePerTurn: false,
      effectId: 'b1',
    });
    expect(out[0]?.note).toContain('College of Valor');
  });

  it('offers nothing for an effect from another source', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d4', source: 'Guidance', effectId: 'g1', once: true, ifFailed: false },
    ];
    expect(damageAdds({ actions: [], features: [] }, a, offers)).toEqual([]);
  });

  it('offers nothing for a Bardic Inspiration effect that is not once only', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d8', source: 'Bardic Inspiration', effectId: 'b2', once: false, ifFailed: false },
    ];
    expect(damageAdds({ actions: [], features: [] }, a, offers)).toEqual([]);
  });
});
