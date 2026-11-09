/**
 * The named effects the sheet puts in play itself (the buffs canvas, "How a
 * buff gets on"): Rage and Innate Sorcery from their own Use, and the starter
 * list under + Effect (Bless, Guidance, Bardic Inspiration). Each is built in
 * the character's rules version with its questions already answered (the
 * barbarian's level, the bard's die), as an effect in play is
 * stored: never a pointer into this table, so a later change here leaves the
 * effects already on a character as they were.
 */
import type { ActiveEffect, EffectPart } from '../types';

type Edition = '2014' | '2024';

/** Rage's damage by barbarian level, the same in both rules versions. */
export function rageDamage(level: number): number {
  if (level >= 16) return 4;
  if (level >= 9) return 3;
  return 2;
}

/** The line Rage and the spells it stops share. */
export const RAGE_NO_SPELLS = 'You cannot cast spells or concentrate while raging';

/**
 * What heavy armor does to Rage in each printing. The sheet says it on Rage's
 * row while heavy armor is worn, and enforces neither.
 */
export function rageHeavyArmor(edition: Edition): string {
  return edition === '2024'
    ? "you can't enter Rage in heavy armor, and putting it on ends Rage"
    : "Rage's benefits need you out of heavy armor";
}

/**
 * Rage, for a barbarian of this level. 2014: Strength melee weapon attacks
 * (an Unarmed Strike is one), for a minute, ending early if you are knocked
 * unconscious. 2024: any attack made with Strength, a thrown weapon too, for
 * up to 10 minutes as you keep it going, ending early if you are
 * Incapacitated. Both only out of heavy armor, which the sheet warns of
 * (`rageHeavyArmor`) but does not enforce.
 */
export function rageEffect(id: string, level: number, edition: Edition): ActiveEffect {
  const parts: EffectPart[] = [
    { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check', 'save'], abilities: ['str'] } },
    {
      kind: 'damageBonus',
      scope: edition === '2024' ? 'all' : 'melee',
      amount: rageDamage(level),
      ability: 'str',
    },
    { kind: 'resist', damageType: 'bludgeoning' },
    { kind: 'resist', damageType: 'piercing' },
    { kind: 'resist', damageType: 'slashing' },
    { kind: 'cue', tone: 'warn', text: RAGE_NO_SPELLS },
  ];
  const lasts =
    edition === '2024'
      ? { minutes: 10, endsWhen: 'incapacitated' as const }
      : { minutes: 1, endsWhen: 'unconscious' as const };
  return { id, name: 'Rage', parts, lasts, mine: true };
}

/** 2024 Innate Sorcery: Sorcerer spells' save DC +1 and advantage on their attack rolls. */
export function innateSorceryEffect(id: string): ActiveEffect {
  return {
    id,
    name: 'Innate Sorcery',
    parts: [
      { kind: 'spellDcBonus', amount: 1, className: 'Sorcerer' },
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['attack'], attack: 'spell', className: 'Sorcerer' },
      },
    ],
    lasts: { minutes: 1 },
    mine: true,
  };
}

/**
 * Bless: a d4 rolled into every attack and save (2014 lets you roll it, and
 * nobody turns down a free d4; 2024 adds it). `mine` when the character cast
 * it, so it ends with their concentration; an ally's stays until removed.
 */
export function blessEffect(id: string, mine: boolean): ActiveEffect {
  return {
    id,
    name: 'Bless',
    parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
    lasts: { minutes: 1, concentration: true },
    ...(mine ? { mine: true } : {}),
  };
}

/**
 * Guidance, a d4 offered after the roll. 2014: on one ability check, then it
 * ends. 2024: on skill checks until it ends. 2024 has the caster choose one
 * skill, but the sheet offers the die on every skill check and leaves which
 * one to the player, rather than asking up front.
 */
export function guidanceEffect(id: string, edition: Edition): ActiveEffect {
  return {
    id,
    name: 'Guidance',
    parts: [
      edition === '2024'
        ? { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], skilled: true } }
        : { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true },
    ],
    lasts: { minutes: 1, concentration: true },
  };
}

/** The bard's die by their level: d6, d8 at 5th, d10 at 10th, d12 at 15th. */
export const BARDIC_DICE = ['d6', 'd8', 'd10', 'd12'] as const;
export type BardicDie = (typeof BARDIC_DICE)[number];

/**
 * Bardic Inspiration: one die on one attack, save or check, after you see the
 * d20. 2014: within 10 minutes, before the DM says how it went. 2024: within
 * an hour, and only on a roll that failed.
 */
export function bardicEffect(id: string, edition: Edition, die: BardicDie): ActiveEffect {
  return {
    id,
    name: 'Bardic Inspiration',
    parts: [
      {
        kind: 'rollOffer',
        dice: `1${die}`,
        on: { rolls: ['attack', 'save', 'check'] },
        once: true,
        ...(edition === '2024' ? { ifFailed: true } : {}),
      },
    ],
    lasts: { minutes: edition === '2024' ? 60 : 10 },
  };
}
