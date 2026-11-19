// Try it on (board 3): an entry not saved yet, worked into a character's sheet
// through the registry's lookups with the entry in front.
import { describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { samplesOf, tryOn, wearing, withEntry } from './TryItOn';

/** Ogre's Grip as Save would store it: Strength at least 19 while attuned. */
const grip = {
  name: "Ogre's Grip",
  source: 'MyHomebrew',
  type: 'W',
  rarity: 'uncommon',
  reqAttune: true,
  entries: ['While you wear these gloves, your Strength score is 19.'],
  castGuidance: { v: 1, effects: [{ kind: 'abilityMin', ability: 'str', min: 19 }] },
};

/** A level 5 warrior of the test world, with Strength 8. */
function hild() {
  const doc = newCharacterDoc('hild', 'Hild', '');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 12 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: Array(5).fill('avg') }];
  return doc;
}

describe('Try it on', () => {
  it("gives a Strength 8 character Strength 19 with Ogre's Grip worn and attuned", () => {
    const tried = tryOn(makeTestContext(), hild(), 'item', grip);
    expect(tried.state).toBe('changed');
    const changes = tried.state === 'changed' ? tried.changes : [];
    expect(changes).toContainEqual({ label: 'Strength', now: '19', was: '8', way: 'up' });
    // The modifier follows: the warrior's proficient Strength saves, and Athletics.
    expect(changes).toContainEqual({ label: 'Strength saves', now: '+7', was: '+2', way: 'up' });
    expect(changes).toContainEqual({ label: 'Athletics', now: '+4', was: '−1', way: 'up' });
  });

  it('shows what the changes do for a character who already wears the saved one', () => {
    const saved = {
      ...grip,
      castGuidance: { v: 1, effects: [{ kind: 'abilityMin', ability: 'str', min: 17 }] },
    };
    const ctx = withEntry(makeTestContext(), 'item', saved);
    const wears = wearing(hild(), 'item', saved) ?? hild();
    const tried = tryOn(ctx, wears, 'item', grip);
    expect(tried).toMatchObject({ state: 'changed', already: true });
    expect(tried.state === 'changed' && tried.changes[0]).toMatchObject({
      label: 'Strength',
      now: '19',
      was: '17',
    });
    expect(tryOn(ctx, hild(), 'item', grip)).toMatchObject({ already: false });
  });

  it('says nothing changes for a character whose own score is higher', () => {
    const strong = hild();
    strong.abilities.base.str = 20;
    expect(tryOn(makeTestContext(), strong, 'item', grip).state).toBe('none');
  });

  it('finds the entry under the book Save stores it in, and leaves the rest to the registry', () => {
    const ctx = withEntry(makeTestContext(), 'item', grip);
    expect(ctx.get('item', "ogre's grip", 'myhomebrew')).toBe(grip);
    expect(ctx.get('item', "Ogre's Grip")).toBe(grip);
    expect(ctx.get('item', "Ogre's Grip", 'TST')).toBeUndefined();
    expect(ctx.get('class', 'Warrior', 'TST')).toMatchObject({ name: 'Warrior' });
    const items = ctx.byType('item');
    expect(items[0]).toBe(grip);
    // One list per lookup, not a new one each time the engine asks.
    expect(ctx.byType('item')).toBe(items);
  });

  it('wears an item once, attuned when it asks for it, and keeps the character as it was', () => {
    const doc = hild();
    const on = wearing(doc, 'item', grip);
    expect(on?.equipment).toEqual([
      expect.objectContaining({
        ref: { name: "Ogre's Grip", source: 'MyHomebrew' },
        attuned: true,
      }),
    ]);
    expect(doc.equipment).toEqual([]);
    expect(wearing(on ?? doc, 'item', grip)?.equipment).toHaveLength(1);
    expect(wearing(doc, 'item', { ...grip, reqAttune: undefined })?.equipment[0]?.attuned).toBe(
      false,
    );
    expect(wearing(doc, 'spell', grip)).toBeUndefined();
  });

  it('puts a condition on, and takes a feat', () => {
    const shaken = {
      name: 'Shaken',
      source: 'MyHomebrew',
      entries: ['You are shaken.'],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: -2 }] },
    };
    const tried = tryOn(makeTestContext(), hild(), 'condition', shaken);
    expect(
      tried.state === 'changed' && tried.changes.find((c) => c.label === 'Armor Class'),
    ).toEqual(expect.objectContaining({ way: 'down' }));
    const sturdy = {
      name: 'Sturdy',
      source: 'MyHomebrew',
      entries: [],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    };
    const feat = tryOn(makeTestContext(), hild(), 'feat', sturdy);
    expect(feat.state === 'changed' && feat.changes.map((c) => c.label)).toContain('Armor Class');
  });

  it('makes a fighter-like sample and a caster with Strength 8 from the classes the data has', () => {
    const samples = samplesOf(makeTestContext());
    expect(samples.map((s) => s.label)).toEqual(['A level 5 warrior', 'A level 5 sorcerer']);
    const caster = samples[1]?.doc;
    expect(caster?.abilities.base.str).toBe(8);
    expect(caster?.abilities.base.cha).toBe(16);
    const tried = tryOn(makeTestContext(), caster ?? hild(), 'item', grip);
    expect(tried.state === 'changed' && tried.changes[0]).toMatchObject({
      label: 'Strength',
      now: '19',
      was: '8',
    });
  });

  it('still tries an entry on with no class data at all', () => {
    const none = { get: () => undefined, byType: () => [] };
    const [only, ...rest] = samplesOf(none);
    expect(rest).toEqual([]);
    expect(only?.label).toBe('A sample character');
    const tried = tryOn(none, only?.doc ?? hild(), 'item', grip);
    expect(tried.state === 'changed' && tried.changes[0]).toMatchObject({ label: 'Strength' });
  });

  it('lists what a list gained, and nothing for two equal sheets', () => {
    const ctx = makeTestContext();
    const resist = {
      ...grip,
      castGuidance: { v: 1, effects: [{ kind: 'resist', damageType: 'fire' }] },
    };
    const tried = tryOn(ctx, hild(), 'item', resist);
    expect(tried.state === 'changed' && tried.changes).toContainEqual({
      label: 'Resistances',
      now: 'fire',
      was: 'none',
    });
    const same = tryOn(ctx, hild(), 'item', { ...grip, castGuidance: undefined });
    expect(same.state).toBe('none');
  });
});
