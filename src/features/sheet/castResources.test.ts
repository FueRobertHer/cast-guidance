import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import {
  type CharacterDoc,
  type DerivedResource,
  emptyPlayState,
  type SpellcastingBlock,
} from '@/engine/types';
import {
  availableCastResources,
  castCost,
  castResourceChipLabel,
  castResourceId,
  castResourceOptions,
  castSpell,
  defaultCastResource,
  needsCastChoice,
  nextCastResource,
  poolCastResources,
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
    resource?: Parameters<typeof castSpell>[4],
  ) => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell((recipe) => recipe(doc), caster, level, { name: 'X', source: 'y' }, resource);
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
      block({ slots: [4, 3, 2] }),
      1,
      { name: 'Bless', source: 'phb', concentration: true, economy: 'action' },
      { kind: 'slot', level: 2 },
    );
    expect(doc.play.slotsSpent[1]).toBe(1);
    expect(doc.play.concentratingOn).toEqual({ label: 'Bless' });
    expect(doc.play.turn?.action).toBe(true);
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
      block({ slots: [4] }),
      1,
      { name: 'X', source: 'y' },
      { kind: 'pool', level: 1, key: 'sorcery-points', label: 'Sorcery Points', cost: 2 },
    );
    expect(doc.play.turn).toEqual({ action: false, bonus: true, reaction: false });
  });
});

describe('cast option wording', () => {
  const fireball = {
    name: 'Fireball',
    source: 'phb',
    level: 3,
    entries: ['A creature takes {@damage 8d6} fire damage on a failed save.'],
    entriesHigherLevel: [
      { entries: ['The damage increases by {@scaledamage 8d6|3-9|1d6} for each slot above 3rd.'] },
    ],
  } as unknown as Entity;

  it('says what each option spends, what is left, and what the dice become', () => {
    const play = emptyPlayState();
    play.slotsSpent = [0, 0, 1, 0, 0, 0, 0, 0, 0];
    const caster = block({ slots: [4, 3, 3, 2] });
    const options = availableCastResources(caster, play, 3, [points(6)]);
    expect(
      castResourceOptions(options, {
        block: caster,
        play,
        pools: [points(6)],
        spell: fireball,
        spellLevel: 3,
        characterLevel: 7,
      }),
    ).toEqual([
      { id: 'slot-3', label: 'Level 3 slot', hint: '8d6 · 2 left' },
      { id: 'slot-4', label: 'Level 4 slot (upcast)', hint: '9d6 · 2 left' },
      {
        id: 'pool-sorcery-points-3',
        label: 'Level 3 slot from Sorcery Points',
        hint: '8d6 · 5 points of 6 · Bonus Action to convert',
      },
      {
        id: 'pool-sorcery-points-4',
        label: 'Level 4 slot from Sorcery Points (upcast)',
        hint: '9d6 · 6 points of 6 · Bonus Action to convert',
      },
    ]);
  });

  it('labels the pact pool and gives its remaining count', () => {
    const caster = block({ slots: [], pactSlots: { count: 2, level: 3 } });
    const options = availableCastResources(caster, emptyPlayState(), 1);
    expect(
      castResourceOptions(options, {
        block: caster,
        play: emptyPlayState(),
        spellLevel: 1,
        characterLevel: 5,
      }),
    ).toEqual([{ id: 'pact', label: 'Pact slot · level 3 (upcast)', hint: '2 left' }]);
  });

  it('keeps the chip compact while the spoken name stays specific', () => {
    expect(castResourceChipLabel({ kind: 'slot', level: 3 })).toBe('L3');
    expect(castResourceChipLabel({ kind: 'pact', level: 3 })).toBe('L3 pact');
    expect(
      castResourceChipLabel({
        kind: 'pool',
        level: 2,
        key: 'sorcery-points',
        label: 'Sorcery Points',
        cost: 3,
      }),
    ).toBe('L2 SP');
    expect(castResourceChipLabel({ kind: 'none', level: 2 })).toBe('no slot');
  });
});

describe('needsCastChoice', () => {
  it('asks whenever there is more than one way to pay', () => {
    expect(needsCastChoice(availableCastResources(block(), emptyPlayState(), 1))).toBe(true);
  });

  it('does not ask about a single slot, or about having nothing left', () => {
    const play = emptyPlayState();
    play.slotsSpent = [0, 3, 2, 0, 0, 0, 0, 0, 0]; // only level 1 slots remain
    expect(needsCastChoice(availableCastResources(block(), play, 1))).toBe(false);
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(needsCastChoice(availableCastResources(block(), play, 1))).toBe(false);
    expect(needsCastChoice(availableCastResources(block(), play, 0))).toBe(false); // cantrip
  });

  it('asks about a lone conversion, which spends points nothing else mentions', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    // Two points buys a level 1 slot and nothing else: one option, still a
    // spend the player has to see coming.
    const options = availableCastResources(block(), play, 1, [points(2)]);
    expect(options).toHaveLength(1);
    expect(needsCastChoice(options)).toBe(true);
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
    castResourceOptions([conversion], {
      block: block(),
      play,
      pools: [points(2)],
      spell: entity,
      spellLevel: 1,
      characterLevel: 5,
    })[0]?.hint;

  it('says only what it costs when the turn can hold it', () => {
    expect(hint(spell('action'))).toBe('2 points of 2 · Bonus Action to convert');
    expect(hint(undefined)).toBe('2 points of 2 · Bonus Action to convert'); // a ritual
  });

  it('says a reaction leaves no Bonus Action to convert with', () => {
    // Shield and its kind are cast on another creature's turn, where there is
    // no Bonus Action to be had. The turn tracker records one anyway, because
    // it has a flag and not a timeline, so the option is where this gets said.
    expect(hint(spell('reaction'))).toBe(
      "2 points of 2 · Bonus Action to convert, no Bonus Action on another creature's turn",
    );
  });

  it('says when the spell already wants the same slice of the turn', () => {
    expect(hint(spell('bonus'))).toBe(
      "2 points of 2 · Bonus Action to convert, on top of the spell's own",
    );
  });

  it('says when the Bonus Action has already gone this turn', () => {
    const play = emptyPlayState();
    play.turn = { action: false, bonus: true, reaction: false };
    expect(hint(spell('action'), play)).toBe(
      '2 points of 2 · Bonus Action to convert, your Bonus Action is already used',
    );
    // An unspent turn says nothing extra.
    play.turn = { action: true, bonus: false, reaction: false };
    expect(hint(spell('action'), play)).toBe('2 points of 2 · Bonus Action to convert');
  });
});
