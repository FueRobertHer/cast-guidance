import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import {
  type CharacterDoc,
  type ClassLevelEntry,
  type DerivedResource,
  emptyPlayState,
  type SpellcastingBlock,
} from '@/engine/types';
import {
  availableCastResources,
  type CastContext,
  type CastResource,
  castCost,
  castNote,
  castResourceId,
  castResourceLabel,
  castSpell,
  castWays,
  defaultCastResource,
  defaultCastTile,
  nextCastResource,
  ordinal,
  poolCastResources,
  setArcanumUsed,
  upcastEffectSummary,
} from './castResources';

const value = { value: 0, base: 0, overridden: false, parts: [] };

function block(overrides: Partial<SpellcastingBlock> = {}): SpellcastingBlock {
  return {
    classUid: 'mage|tst',
    className: 'Mage',
    ability: 'int',
    mode: 'known',
    saveDc: value,
    attackMod: value,
    slots: [4, 3, 2],
    ...overrides,
  };
}

/** A sorcery-point pool of `max` points, as the derived sheet reports it. */
function points(max: number): DerivedResource {
  return {
    key: 'sorcery-points',
    label: 'Sorcery Points',
    max,
    resetOn: 'long',
    origin: 'Sorcerer',
  };
}

/** Room enough that ending an effect never moves current HP. */
const HP = { maxHp: 100, edition: '2024' } as const;

/** What the cast prompt reads, for a level 1 spell of `caster`. */
function ctxOf(
  caster: SpellcastingBlock | undefined,
  play = emptyPlayState(),
  pools: DerivedResource[] = [],
): CastContext {
  return {
    block: caster,
    play,
    pools,
    spellLevel: 1,
    characterLevel: 5,
    rulesVersion: '2014',
    classes: [],
  };
}

describe('nextCastResource', () => {
  it('previews cantrips without a resource', () => {
    expect(nextCastResource(block(), emptyPlayState(), 0)).toEqual({ kind: 'cantrip', level: 0 });
  });

  it('uses the same pact-first and shared-slot fallback order as casting', () => {
    const play = emptyPlayState();
    const caster = block({ pactSlots: { count: 2, level: 3 } });
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'pact', level: 3 });
    play.pactSlotsSpent = 2;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 1 });
    play.slotsSpent[0] = 4;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 2 });
  });

  it('keeps an exhausted cast possible but labels it as no resource', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(nextCastResource(block(), play, 1)).toEqual({ kind: 'none', level: 1 });
  });
});

describe('availableCastResources (GAME-001 upcast options)', () => {
  it('lists every slot level >= the spell level that still has a slot, plus pact', () => {
    const play = emptyPlayState();
    const caster = block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } });
    expect(availableCastResources(caster, play, 1)).toEqual([
      { kind: 'slot', level: 1 },
      { kind: 'slot', level: 2 },
      { kind: 'slot', level: 3 },
      { kind: 'pact', level: 3 },
    ]);
  });

  it('excludes exhausted slot levels and an exhausted pact pool', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 0, 2, 0, 0, 0, 0, 0, 0]; // L1 and L3 tapped out
    play.pactSlotsSpent = 2;
    const caster = block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } });
    expect(availableCastResources(caster, play, 1)).toEqual([{ kind: 'slot', level: 2 }]);
  });

  it('returns nothing for a cantrip or when fully tapped out', () => {
    const play = emptyPlayState();
    expect(availableCastResources(block(), play, 0)).toEqual([]);
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(availableCastResources(block(), play, 1)).toEqual([]);
  });

  it('castResourceId round-trips each option uniquely', () => {
    const play = emptyPlayState();
    const caster = block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } });
    const options = availableCastResources(caster, play, 1);
    const ids = options.map(castResourceId);
    expect(ids).toEqual(['slot-1', 'slot-2', 'slot-3', 'pact']);
    expect(new Set(ids).size).toBe(ids.length); // unique
    // Every id maps back to exactly its option (the cast handler's find).
    for (const o of options) {
      expect(options.find((x) => castResourceId(x) === castResourceId(o))).toBe(o);
    }
  });
});

describe('castSpell resource override (GAME-001)', () => {
  const runCast = (
    caster: SpellcastingBlock,
    level: number,
    resource?: Parameters<typeof castSpell>[5],
  ) => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell((recipe) => recipe(doc), HP, caster, level, { name: 'X', source: 'y' }, resource);
    return doc.play;
  };

  it('spends the chosen higher slot (upcast) instead of the lowest', () => {
    const play = runCast(block({ slots: [4, 3, 2] }), 1, { kind: 'slot', level: 3 });
    expect(play.slotsSpent[2]).toBe(1); // level 3 spent
    expect(play.slotsSpent[0]).toBe(0); // level 1 untouched
  });

  it('still applies concentration/economy when a resource is chosen', () => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell(
      (recipe) => recipe(doc),
      HP,
      block({ slots: [4, 3, 2] }),
      1,
      { name: 'Bless', source: 'phb', concentration: true, economy: 'action' },
      { kind: 'slot', level: 2 },
    );
    expect(doc.play.slotsSpent[1]).toBe(1);
    expect(doc.play.concentratingOn).toEqual({ label: 'Bless', level: 2 });
    expect(doc.play.turn?.action).toBe(true);
  });

  it('remembers no slot for a concentration spell that spent none', () => {
    const cast = (level: number, resource?: Parameters<typeof castSpell>[5]) => {
      const doc = { play: emptyPlayState() } as CharacterDoc;
      castSpell(
        (recipe) => recipe(doc),
        HP,
        block({ slots: [1] }),
        level,
        { name: 'Hum', source: 'phb', concentration: true },
        resource,
      );
      return doc.play.concentratingOn;
    };
    expect(cast(0)).toEqual({ label: 'Hum' });
    expect(cast(1, { kind: 'none', level: 1 })).toEqual({ label: 'Hum' });
  });

  it("ends the character's own effects held by the concentration it replaces", () => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    const bless = (id: string, mine: boolean) => ({
      id,
      name: 'Bless',
      parts: [],
      lasts: { minutes: 1, concentration: true },
      ...(mine ? { mine: true } : {}),
    });
    doc.play.activeEffects = [bless('mine', true), bless('ally', false)];
    doc.play.concentratingOn = { label: 'Bless', level: 1 };
    castSpell((recipe) => recipe(doc), HP, block({ slots: [2, 1] }), 2, {
      name: 'Haste',
      source: 'phb',
      concentration: true,
    });
    expect(doc.play.concentratingOn).toEqual({ label: 'Haste', level: 2 });
    expect(doc.play.activeEffects?.map((e) => e.id)).toEqual(['ally']);
  });

  it('spends the pact pool when the pact resource is chosen', () => {
    const play = runCast(block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } }), 1, {
      kind: 'pact',
      level: 3,
    });
    expect(play.pactSlotsSpent).toBe(1);
    expect(play.slotsSpent.every((n) => n === 0)).toBe(true);
  });

  it('falls back to the lowest slot when no override is given', () => {
    const play = runCast(block({ slots: [4, 3, 2] }), 1);
    expect(play.slotsSpent[0]).toBe(1); // lowest (level 1)
  });

  /** Casts Cure Wounds with `resource` and no class, as an innate row or an item does. */
  const castFree = (resource: CastResource, play = emptyPlayState()) => {
    const doc = { play } as CharacterDoc;
    let label: string | undefined;
    castSpell(
      (recipe, named) => {
        recipe(doc);
        label = typeof named === 'function' ? named(doc) : named;
      },
      HP,
      undefined,
      1,
      { name: 'Cure Wounds', source: 'xphb', economy: 'action' },
      resource,
    );
    return { play: doc.play, label };
  };

  it("spends an innate grant's use, and names it in the history", () => {
    const play = emptyPlayState();
    play.resources.push({ key: 'rebuke', used: 0 });
    const out = castFree({ kind: 'uses', level: 2, key: 'rebuke', label: 'Infernal Legacy' }, play);
    expect(out.play.resources).toEqual([{ key: 'rebuke', used: 1 }]);
    expect(out.play.slotsSpent.every((n) => n === 0)).toBe(true);
    expect(out.play.turn?.action).toBe(true);
    expect(out.label).toBe('Cast Cure Wounds (Infernal Legacy)');
  });

  it("spends an item's charges at the level picked", () => {
    const out = castFree({
      kind: 'charges',
      level: 3,
      key: 'item-charges:staff',
      label: 'Staff of Healing',
      cost: 3,
    });
    expect(out.play.resources).toEqual([{ key: 'item-charges:staff', used: 3 }]);
    expect(out.label).toBe('Cast Cure Wounds (L3 from 3 Staff of Healing charges)');
  });

  it('spends nothing with no class and nothing chosen', () => {
    const out = castFree({ kind: 'none', level: 1 });
    expect(out.play.resources).toEqual([]);
    expect(out.play.turn?.action).toBe(true);
  });
});

describe('Mystic Arcanum casting', () => {
  /** A warlock 13: two 5th-level pact slots and arcana at 6th and 7th level. */
  const warlock = block({
    mode: 'pact',
    slots: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactSlots: { count: 3, level: 5 },
    mysticArcanum: [6, 7],
  });
  const runCast = (caster: SpellcastingBlock, level: number, play = emptyPlayState()) => {
    const doc = { play } as CharacterDoc;
    let label: string | undefined;
    castSpell(
      (recipe, named) => {
        recipe(doc);
        label = typeof named === 'function' ? named(doc) : named;
      },
      HP,
      caster,
      level,
      { name: 'Eyebite', source: 'phb' },
    );
    return { play: doc.play, label };
  };

  it('casts an open arcanum without a slot, once', () => {
    expect(availableCastResources(warlock, emptyPlayState(), 6)).toEqual([
      { kind: 'arcanum', level: 6 },
    ]);
    const { play, label } = runCast(warlock, 6);
    expect(play.arcanumUsed).toEqual([6]);
    expect(play.pactSlotsSpent).toBe(0);
    expect(play.slotsSpent.every((n) => n === 0)).toBe(true);
    expect(label).toBe('Cast Eyebite (Mystic Arcanum)');
    // Used, nothing is left to pay for it, but the cast is still allowed.
    expect(availableCastResources(warlock, play, 6)).toEqual([]);
    expect(nextCastResource(warlock, play, 6)).toEqual({ kind: 'none', level: 6 });
    expect(runCast(warlock, 6, play).label).toBe('Cast Eyebite (no slot)');
  });

  it('tracks each arcanum level apart', () => {
    const play = emptyPlayState();
    setArcanumUsed(play, 7, true);
    expect(nextCastResource(warlock, play, 6)).toEqual({ kind: 'arcanum', level: 6 });
    expect(nextCastResource(warlock, play, 7)).toEqual({ kind: 'none', level: 7 });
  });

  it('offers no arcanum at a level the warlock has not reached', () => {
    expect(availableCastResources(warlock, emptyPlayState(), 8)).toEqual([]);
    expect(availableCastResources(block(), emptyPlayState(), 6)).toEqual([]);
  });

  it('puts the arcanum ahead of a slot another class shares', () => {
    const multiclass = { ...warlock, slots: [4, 3, 3, 3, 2, 1, 0, 0, 0] };
    const options = availableCastResources(multiclass, emptyPlayState(), 6);
    expect(options).toEqual([
      { kind: 'arcanum', level: 6 },
      { kind: 'slot', level: 6 },
    ]);
    expect(castWays({ ...ctxOf(multiclass), spellLevel: 6 }).map((w) => w.title)).toEqual([
      'Mystic Arcanum',
      'Spell slots',
    ]);
    expect(nextCastResource(multiclass, emptyPlayState(), 6)).toEqual({
      kind: 'arcanum',
      level: 6,
    });
  });

  it('keeps the used list sorted, and drops it when nothing is used', () => {
    const play = emptyPlayState();
    setArcanumUsed(play, 8, true);
    setArcanumUsed(play, 6, true);
    setArcanumUsed(play, 6, true);
    expect(play.arcanumUsed).toEqual([6, 8]);
    setArcanumUsed(play, 8, false);
    setArcanumUsed(play, 6, false);
    expect('arcanumUsed' in play).toBe(false);
  });

  it('names the arcanum on its tile and in the note', () => {
    const arcanum = { kind: 'arcanum', level: 6 } as const;
    const ctx = { ...ctxOf(warlock), spellLevel: 6, characterLevel: 13 };
    expect(castResourceId(arcanum)).toBe('arcanum-6');
    expect(castResourceLabel(arcanum)).toBe('Mystic Arcanum · level 6');
    expect(castWays(ctx)).toEqual([
      {
        title: 'Mystic Arcanum',
        sub: 'once per long rest',
        tiles: [{ resource: arcanum, ok: true, sub: 'ready' }],
      },
    ]);
    expect(castNote(arcanum, ctx)).toBe('Spends your 6th-level Mystic Arcanum.');
  });

  it('keeps a used arcanum on show, spent, and starts on nothing', () => {
    const play = emptyPlayState();
    setArcanumUsed(play, 6, true);
    const ctx = { ...ctxOf(warlock, play), spellLevel: 6 };
    const ways = castWays(ctx);
    expect(ways[0]?.tiles).toEqual([
      { resource: { kind: 'arcanum', level: 6 }, ok: false, sub: 'used' },
    ]);
    expect(defaultCastTile(ways, ctx)).toBeUndefined();
    expect(castNote(undefined, ctx)).toBe('Nothing left to spend: it marks only your turn.');
  });
});

describe('upcastEffectSummary (GAME-001 preview)', () => {
  // Fireball-shaped: 8d6 at level 3, +1d6 per slot above.
  const fireball = {
    name: 'Fireball',
    source: 'phb',
    level: 3,
    entries: ['A creature takes {@damage 8d6} fire damage on a failed save.'],
    entriesHigherLevel: [
      { entries: ['The damage increases by {@scaledamage 8d6|3-9|1d6} for each slot above 3rd.'] },
    ],
  } as unknown as Entity;

  it('shows the spell dice scaled to the chosen slot level', () => {
    expect(upcastEffectSummary(fireball, 5, 3)).toBe('8d6'); // base
    expect(upcastEffectSummary(fireball, 5, 4)).toBe('9d6'); // upcast +1d6
    expect(upcastEffectSummary(fireball, 5, 6)).toBe('11d6'); // +3d6
  });

  it('shows the scaling die of a multi-damage spell, not just the first roll', () => {
    // Ice Knife: piercing 1d10 (fixed) + cold 2d6 (scales +1d6/slot).
    const iceKnife = {
      name: 'Ice Knife',
      source: 'phb',
      level: 1,
      entries: [
        'On a hit, the target takes {@damage 1d10} piercing damage. Then cold explodes: {@damage 2d6} cold damage.',
      ],
      entriesHigherLevel: [
        {
          entries: ['The cold damage increases by {@scaledamage 2d6|1-9|1d6} per slot above 1st.'],
        },
      ],
    } as unknown as Entity;
    expect(upcastEffectSummary(iceKnife, 5, 1)).toBe('1d10 / 2d6'); // base
    expect(upcastEffectSummary(iceKnife, 5, 3)).toBe('1d10 / 4d6'); // cold scales, piercing fixed
  });

  it('shows no dice for an upcast that adds instances rather than dice', () => {
    // Magic Missile: 1d4+1 per dart, upcast adds a dart (no {@scaledamage}).
    const magicMissile = {
      name: 'Magic Missile',
      source: 'phb',
      level: 1,
      entries: ['Each dart deals {@damage 1d4+1} force damage.'],
      entriesHigherLevel: [{ entries: ['One more dart for each slot above 1st.'] }],
    } as unknown as Entity;
    expect(upcastEffectSummary(magicMissile, 5, 1)).toBe('1d4+1'); // base shows its dice
    expect(upcastEffectSummary(magicMissile, 5, 3)).toBeUndefined(); // upcast: no misleading die
  });

  it('previews scaling healing dice too', () => {
    const cureWounds = {
      name: 'Cure Wounds',
      source: 'phb',
      level: 1,
      entries: ['A creature regains {@dice 1d8} + your spellcasting ability modifier hit points.'],
      entriesHigherLevel: [{ entries: ['+{@scaledice 1d8|1-9|1d8} per slot above 1st.'] }],
    } as unknown as Entity;
    expect(upcastEffectSummary(cureWounds, 5, 1)).toBe('1d8');
    expect(upcastEffectSummary(cureWounds, 5, 2)).toBe('2d8');
  });

  it('never previews a template the dice engine cannot roll', () => {
    // This caller passes no ability modifier. Green-Flame Blade's secondary
    // die is written "1d8 + {{spellcasting_mod}}" in the data, and its on-hit
    // die starts at 5th level, so a 1st-level preview has no dice at all.
    const greenFlameBlade = {
      name: 'Green-Flame Blade',
      source: 'TCE',
      level: 0,
      entries: ['At 5th level, the attack deals an extra {@damage 1d8} fire damage.'],
      scalingLevelDice: [
        {
          label: 'fire damage to secondary creature',
          scaling: { '1': '{{spellcasting_mod}}', '5': '1d8 + {{spellcasting_mod}}' },
        },
        { label: 'fire damage on hit', scaling: { '5': '1d8' } },
      ],
    } as Entity;
    expect(upcastEffectSummary(greenFlameBlade, 1, 0)).toBeUndefined();
    expect(upcastEffectSummary(greenFlameBlade, 5, 0)).toBe('1d8 / 1d8');
  });

  it('is undefined for a spell with no rolled dice', () => {
    const shield = { name: 'Shield', source: 'phb', level: 1, entries: ['+5 AC.'] } as Entity;
    expect(upcastEffectSummary(shield, 5, 1)).toBeUndefined();
    expect(upcastEffectSummary(undefined, 5, 1)).toBeUndefined();
  });
});

describe('castCost', () => {
  it('says nothing when the spell paid its own level', () => {
    expect(castCost({ kind: 'slot', level: 3 }, 3)).toBe('');
    expect(castCost({ kind: 'cantrip', level: 0 }, 0)).toBe('');
    expect(castCost(undefined, 1)).toBe('');
  });

  it('names an upcast, a pact slot, and a cast with nothing left to spend', () => {
    expect(castCost({ kind: 'slot', level: 4 }, 3)).toBe(' (L4)');
    expect(castCost({ kind: 'pact', level: 3 }, 1)).toBe(' (pact slot)');
    // Must not read like a paid cast: the explicit label replaces the diff that
    // would otherwise reveal no slot moved.
    expect(castCost({ kind: 'none', level: 2 }, 2)).toBe(' (no slot)');
  });
});

describe('pool conversions as cast sources (GAME-001)', () => {
  it('offers a slot at every level the points can buy, from the spell level up', () => {
    // Sorcery points: 2/3/5/6/7 for a level 1-5 slot. Six points buys a 1st,
    // 2nd, 3rd or 4th-level slot, but not the 5th.
    expect(poolCastResources([points(6)], emptyPlayState(), 1)).toEqual([
      { kind: 'pool', level: 1, key: 'sorcery-points', label: 'Sorcery Points', cost: 2 },
      { kind: 'pool', level: 2, key: 'sorcery-points', label: 'Sorcery Points', cost: 3 },
      { kind: 'pool', level: 3, key: 'sorcery-points', label: 'Sorcery Points', cost: 5 },
      { kind: 'pool', level: 4, key: 'sorcery-points', label: 'Sorcery Points', cost: 6 },
    ]);
  });

  it('never offers a slot below the spell level, or one the table cannot make', () => {
    const levels = (spellLevel: number) =>
      poolCastResources([points(20)], emptyPlayState(), spellLevel).map((o) => o.level);
    expect(levels(3)).toEqual([3, 4, 5]);
    // The conversion table stops at 5th in both editions, so a 6th-level spell
    // has no conversion however many points are banked.
    expect(levels(6)).toEqual([]);
    expect(levels(0)).toEqual([]); // cantrips spend nothing
  });

  it('prices against the points that are actually left, not the maximum', () => {
    const play = emptyPlayState();
    play.resources = [{ key: 'sorcery-points', used: 4 }];
    expect(poolCastResources([points(6)], play, 1).map((o) => o.level)).toEqual([1]); // 2 left
    play.resources = [{ key: 'sorcery-points', used: 6 }];
    expect(poolCastResources([points(6)], play, 1)).toEqual([]);
  });

  it('will not buy a slot with points that cannot become one', () => {
    const levels = (pool: DerivedResource, play = emptyPlayState()) =>
      poolCastResources([pool], play, 1).map((o) => o.level);
    // All of them locked: nothing to offer at all.
    expect(levels({ ...points(2), noSlotConversion: 2 })).toEqual([]);
    // Three of five free: five points would buy a 3rd, three stop at a 2nd.
    const mixed = { ...points(5), noSlotConversion: 2 };
    expect(levels(mixed)).toEqual([1, 2]);
    // Two gone could be the locked ones, so the three free points still count.
    const play = emptyPlayState();
    play.resources = [{ key: 'sorcery-points', used: 2 }];
    expect(levels(mixed, play)).toEqual([1, 2]);
  });

  it('ignores pools with no slot conversion', () => {
    const ki: DerivedResource = {
      key: 'ki',
      label: 'Ki',
      max: 10,
      resetOn: 'short',
      origin: 'Monk',
    };
    expect(poolCastResources([ki], emptyPlayState(), 1)).toEqual([]);
  });

  it('offers a conversion alongside the slots, after them', () => {
    const options = availableCastResources(block({ slots: [4] }), emptyPlayState(), 1, [points(3)]);
    expect(options.map(castResourceId)).toEqual([
      'slot-1',
      'pool-sorcery-points-1',
      'pool-sorcery-points-2',
    ]);
    // Having a slot left never hides the conversion: spending points to keep a
    // slot is a real choice, not an error to prevent.
    expect(options[0]).toEqual({ kind: 'slot', level: 1 });
  });

  it('gives each conversion a distinct, round-tripping id', () => {
    const options = availableCastResources(block({ slots: [1] }), emptyPlayState(), 1, [points(5)]);
    const ids = options.map(castResourceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of options) {
      expect(options.find((x) => castResourceId(x) === castResourceId(o))).toBe(o);
    }
  });
});

describe('defaultCastResource', () => {
  it('spends slots before points while any slot is left', () => {
    expect(defaultCastResource(block({ slots: [4] }), emptyPlayState(), 1, [points(20)])).toEqual({
      kind: 'slot',
      level: 1,
    });
  });

  it('reaches for a conversion only once slots and pact magic are gone', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(defaultCastResource(block(), play, 1, [points(4)])).toEqual({
      kind: 'pool',
      level: 1,
      key: 'sorcery-points',
      label: 'Sorcery Points',
      cost: 2,
    });
    // With nothing left anywhere it still allows the cast, honestly labelled.
    expect(defaultCastResource(block(), play, 1, [points(0)])).toEqual({ kind: 'none', level: 1 });
  });
});

describe('castSpell pool conversion', () => {
  it('spends the points and the Bonus Action the conversion costs', () => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell(
      (recipe) => recipe(doc),
      HP,
      block({ slots: [4] }),
      1,
      { name: 'Shield', source: 'phb', economy: 'reaction' },
      { kind: 'pool', level: 3, key: 'sorcery-points', label: 'Sorcery Points', cost: 5 },
    );
    expect(doc.play.resources).toEqual([{ key: 'sorcery-points', used: 5 }]);
    expect(doc.play.slotsSpent.every((n) => n === 0)).toBe(true); // no slot moved
    expect(doc.play.turn).toEqual({ action: false, bonus: true, reaction: true });
  });

  it('adds to points already spent rather than replacing the count', () => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    doc.play.resources = [{ key: 'sorcery-points', used: 2 }];
    castSpell(
      (recipe) => recipe(doc),
      HP,
      block({ slots: [4] }),
      1,
      { name: 'X', source: 'y' },
      { kind: 'pool', level: 1, key: 'sorcery-points', label: 'Sorcery Points', cost: 2 },
    );
    expect(doc.play.resources).toEqual([{ key: 'sorcery-points', used: 4 }]);
  });

  it('names the pool that paid in the history label, even at the spell level', () => {
    expect(
      castCost(
        { kind: 'pool', level: 1, key: 'sorcery-points', label: 'Sorcery Points', cost: 2 },
        1,
      ),
    ).toBe(' (L1 from 2 Sorcery Points)');
  });

  it('marks the turn for the conversion alone when the spell has no action cost', () => {
    // A ritual cast has no economy; converting points is still a Bonus Action,
    // so the turn is marked for the conversion alone.
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell(
      (recipe) => recipe(doc),
      HP,
      block({ slots: [4] }),
      1,
      { name: 'X', source: 'y' },
      { kind: 'pool', level: 1, key: 'sorcery-points', label: 'Sorcery Points', cost: 2 },
    );
    expect(doc.play.turn).toEqual({ action: false, bonus: true, reaction: false });
  });
});

describe('ways to cast, as tiles', () => {
  it('groups slots and a conversion, each tile saying what is left or what it costs', () => {
    const play = emptyPlayState();
    play.slotsSpent = [0, 0, 1, 0, 0, 0, 0, 0, 0];
    const caster = block({ slots: [4, 3, 3, 2] });
    const ways = castWays({
      ...ctxOf(caster, play, [points(6)]),
      spellLevel: 3,
      characterLevel: 7,
    });
    const pool = (level: number, cost: number) => ({
      resource: { kind: 'pool', level, key: 'sorcery-points', label: 'Sorcery Points', cost },
      // Seven points for a 5th-level slot is more than the pool holds.
      ok: cost <= 6,
      sub: `${String(cost)} points`,
    });
    expect(ways).toEqual([
      {
        title: 'Spell slots',
        tiles: [
          { resource: { kind: 'slot', level: 3 }, ok: true, sub: '2 left' },
          { resource: { kind: 'slot', level: 4 }, ok: true, sub: '2 left' },
        ],
      },
      {
        title: 'Sorcery Points',
        sub: '6 left · Bonus Action to convert',
        tiles: [pool(3, 5), pool(4, 6), pool(5, 7)],
      },
    ]);
  });

  it('keeps a spent slot level on show, unable to pay', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 0, 0, 0, 0, 0, 0, 0, 0];
    const [slots] = castWays(ctxOf(block(), play));
    expect(slots?.tiles.map((t) => [t.resource.level, t.ok, t.sub])).toEqual([
      [1, false, '0 left'],
      [2, true, '3 left'],
      [3, true, '2 left'],
    ]);
  });

  it('offers the pact slot at its own level', () => {
    const caster = block({ slots: [], pactSlots: { count: 2, level: 3 } });
    const ctx = ctxOf(caster);
    expect(castWays(ctx)).toEqual([
      {
        title: 'Pact slots',
        tiles: [{ resource: { kind: 'pact', level: 3 }, ok: true, sub: '2 left' }],
      },
    ]);
    expect(castNote({ kind: 'pact', level: 3 }, ctx)).toBe('Spends a pact slot (3rd level).');
    // A spell above the pact slot's level has no pact tile.
    expect(castWays({ ...ctx, spellLevel: 4 })).toEqual([]);
  });

  it('offers an innate grant its uses, with no class to cast it', () => {
    const play = emptyPlayState();
    const use = { key: 'tiefling-rebuke', label: 'Infernal Legacy', max: 1 };
    const ctx = { ...ctxOf(undefined, play), spellLevel: 2 };
    const resource = { kind: 'uses', level: 2, key: use.key, label: use.label } as const;
    expect(castWays(ctx, { uses: [use] })).toEqual([
      { title: 'Infernal Legacy', tiles: [{ resource, ok: true, sub: '1 left' }] },
    ]);
    expect(castNote(resource, ctx)).toBe('Spends a use of Infernal Legacy.');
    play.resources.push({ key: use.key, used: 1 });
    expect(castWays(ctx, { uses: [use] })[0]?.tiles[0]).toMatchObject({
      ok: false,
      sub: '0 left',
    });
  });

  it('offers an item its charges a level at a time, with what is left of them', () => {
    const play = emptyPlayState();
    play.resources.push({ key: 'item-charges:staff', used: 7 });
    const staff = {
      key: 'item-charges:staff',
      label: 'Staff of Healing',
      max: 10,
      costs: [1, 2, 3, 4].map((level) => ({ level, cost: level })),
    };
    const ctx = ctxOf(block(), play);
    const charged = castWays(ctx, { charges: [staff] }).find((w) => w.title === 'Staff of Healing');
    expect(charged?.sub).toBe('1 charge a level · 3 of 10 left');
    expect(charged?.tiles.map((t) => [t.resource.level, t.ok, t.sub])).toEqual([
      [1, true, '1 charge'],
      [2, true, '2 charges'],
      [3, true, '3 charges'],
      [4, false, '4 charges'],
    ]);
    const second = charged?.tiles[1]?.resource;
    expect(second && castNote(second, ctx)).toBe('Spends 2 Staff of Healing charges.');
    expect(second && castResourceLabel(second)).toBe('Level 2 from Staff of Healing');
  });

  it('says nothing of a per-level cost for a one-level item', () => {
    const wand = {
      key: 'item-charges:wand',
      label: 'Wand of Fireballs',
      max: 7,
      costs: [{ level: 3, cost: 1 }],
    };
    const [way] = castWays({ ...ctxOf(undefined), spellLevel: 3 }, { charges: [wand] });
    expect(way?.sub).toBe('7 of 7 left');
  });

  it('offers nothing for a cantrip', () => {
    expect(castWays({ ...ctxOf(block()), spellLevel: 0 })).toEqual([]);
  });

  it('says levels as a tile does', () => {
    expect([1, 2, 3, 4, 9, 11, 12, 13, 21].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '9th',
      '11th',
      '12th',
      '13th',
      '21st',
    ]);
  });
});

describe('the tile a cast starts on', () => {
  const start = (ctx: CastContext, extra: Parameters<typeof castWays>[1] = {}) =>
    defaultCastTile(castWays(ctx, extra), ctx)?.resource;

  it('starts on the lowest slot left, as an unchosen cast always spent', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(start(ctxOf(block(), play, [points(6)]))).toEqual({ kind: 'slot', level: 2 });
  });

  it('starts on the first way left once the slots are gone', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(start(ctxOf(block(), play, [points(2)]))).toEqual({
      kind: 'pool',
      level: 1,
      key: 'sorcery-points',
      label: 'Sorcery Points',
      cost: 2,
    });
    const use = { key: 'rebuke', label: 'Infernal Legacy', max: 1 };
    expect(start(ctxOf(block(), play), { uses: [use] })).toMatchObject({ kind: 'uses' });
  });

  it('starts on nothing when nothing can pay', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(start(ctxOf(block(), play))).toBeUndefined();
  });

  it('says what a slot spends, and what nothing left does', () => {
    const ctx = ctxOf(block());
    expect(castNote({ kind: 'slot', level: 1 } satisfies CastResource, ctx)).toBe(
      'Spends a 1st-level slot.',
    );
    expect(castNote({ kind: 'none', level: 1 }, ctx)).toBe(
      'Nothing left to spend: it marks only your turn.',
    );
  });
});

describe('what a conversion costs the turn', () => {
  const conversion = {
    kind: 'pool',
    level: 1,
    key: 'sorcery-points',
    label: 'Sorcery Points',
    cost: 2,
  } as const;
  const spell = (unit?: string) =>
    ({
      name: 'Ward',
      source: 'phb',
      level: 1,
      entries: ['A ward.'],
      ...(unit === undefined ? {} : { time: [{ number: 1, unit }] }),
    }) as unknown as Entity;
  const hint = (entity: Entity | undefined, play = emptyPlayState()) =>
    castNote(conversion, { ...ctxOf(block(), play, [points(2)]), spell: entity });

  it('says only what it costs when the turn can hold it', () => {
    expect(hint(spell('action'))).toBe('Spends 2 Sorcery Points and a Bonus Action to convert.');
    expect(hint(undefined)).toBe('Spends 2 Sorcery Points and a Bonus Action to convert.'); // a ritual
  });

  it('says a reaction leaves no Bonus Action to convert with', () => {
    // Shield and its kind are cast on another creature's turn, where there is
    // no Bonus Action to be had. The turn tracker records one anyway, because
    // it has a flag and not a timeline, so the option is where this gets said.
    expect(hint(spell('reaction'))).toBe(
      "Spends 2 Sorcery Points and a Bonus Action to convert, no Bonus Action on another creature's turn.",
    );
  });

  it('says when the spell already wants the same slice of the turn', () => {
    expect(hint(spell('bonus'))).toBe(
      "Spends 2 Sorcery Points and a Bonus Action to convert, on top of the spell's own.",
    );
  });

  it('says when the Bonus Action has already gone this turn', () => {
    const play = emptyPlayState();
    play.turn = { action: false, bonus: true, reaction: false };
    expect(hint(spell('action'), play)).toBe(
      'Spends 2 Sorcery Points and a Bonus Action to convert, your Bonus Action is already used.',
    );
    // An unspent turn says nothing extra.
    play.turn = { action: true, bonus: false, reaction: false };
    expect(hint(spell('action'), play)).toBe(
      'Spends 2 Sorcery Points and a Bonus Action to convert.',
    );
  });
});

describe('2024 slot creation level (GAME-008)', () => {
  const sorcerer = (levels: number): ClassLevelEntry => ({
    ref: { name: 'Sorcerer', source: 'XPHB' },
    levels,
    hp: [],
  });
  const mage = (levels: number): ClassLevelEntry => ({
    ref: { name: 'Mage', source: 'TST' },
    levels,
    hp: [],
  });
  /** The conversion tiles' notes for a level-1 spell, by tile. */
  const hints = (
    classes: ClassLevelEntry[],
    rulesVersion: '2014' | '2024' = '2024',
    play = emptyPlayState(),
  ) => {
    const ctx = { ...ctxOf(block({ slots: [] }), play, [points(7)]), rulesVersion, classes };
    return Object.fromEntries(
      castWays(ctx)
        .flatMap((w) => w.tiles)
        .map((t) => [castResourceId(t.resource), castNote(t.resource, ctx)]),
    );
  };

  it('says what Sorcerer level a 2024 conversion needs, on the rows that need more', () => {
    expect(hints([sorcerer(7)])).toEqual({
      'pool-sorcery-points-1': 'Spends 2 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-2': 'Spends 3 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-3': 'Spends 5 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-4': 'Spends 6 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-5':
        'Spends 7 Sorcery Points and a Bonus Action to convert. 2024: needs Sorcerer 9.',
    });
  });

  it('still offers the conversion: the note is guidance, not a gate', () => {
    // A 2024 Sorcerer 7 with seven points can still be offered a 5th-level slot.
    expect(poolCastResources([points(7)], emptyPlayState(), 1).map((o) => o.level)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('says nothing under 2014 rules, which have no level column', () => {
    for (const hint of Object.values(hints([sorcerer(7)], '2014'))) {
      expect(hint).not.toContain('needs');
    }
  });

  it('reads the Sorcerer level, not the character level, for a multiclass', () => {
    expect(hints([sorcerer(3), mage(6)])).toEqual({
      'pool-sorcery-points-1': 'Spends 2 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-2': 'Spends 3 Sorcery Points and a Bonus Action to convert.',
      'pool-sorcery-points-3':
        'Spends 5 Sorcery Points and a Bonus Action to convert. 2024: needs Sorcerer 5.',
      'pool-sorcery-points-4':
        'Spends 6 Sorcery Points and a Bonus Action to convert. 2024: needs Sorcerer 7.',
      'pool-sorcery-points-5':
        'Spends 7 Sorcery Points and a Bonus Action to convert. 2024: needs Sorcerer 9.',
    });
  });

  it('says nothing when the character has no Sorcerer level to measure', () => {
    for (const hint of Object.values(hints([mage(9)]))) expect(hint).not.toContain('needs');
  });

  it('says nothing when the Sorcerer level cannot be read', () => {
    // A level from an imported doc can be anything; labelling every row from a
    // guessed 0 would say more than the app knows.
    for (const hint of Object.values(hints([sorcerer(Number.NaN)]))) {
      expect(hint).not.toContain('needs');
    }
  });

  it('keeps the turn note and the level note apart', () => {
    const play = emptyPlayState();
    play.turn = { action: false, bonus: true, reaction: false };
    expect(hints([sorcerer(7)], '2024', play)['pool-sorcery-points-5']).toBe(
      'Spends 7 Sorcery Points and a Bonus Action to convert, your Bonus Action is already used. 2024: needs Sorcerer 9.',
    );
  });
});
