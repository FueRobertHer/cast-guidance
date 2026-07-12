/**
 * Curated one-liners and ability priorities that turn bare name lists into
 * decisions a first-time player can actually make. Data-derived summaries
 * (ability bonuses, granted skills) cover everything the curated maps miss.
 */
import type { Entity } from '@/data5e/copyMod';
import { summarizeEntries } from '@/engine/summarize';
import { ABILITIES, type Ability } from '@/engine/types';

const nameOf = (e: Entity) => String(e.name ?? '?');

interface RegistryLike {
  byType(type: string): readonly Entity[];
}

/**
 * Describe a subclass by summarizing its lowest-level (identity) feature, so a
 * picker can answer "what makes this subclass different" without curating the
 * hundreds of subclasses. Returns a `describe` fn bound to the registry.
 */
export function makeSubclassBlurb(registry: RegistryLike): (sub: Entity) => string | undefined {
  return (sub) => {
    const shortName = String(sub.shortName ?? '').toLowerCase();
    const className = String(sub.className ?? '').toLowerCase();
    const source = String(sub.source ?? '').toLowerCase();
    if (shortName === '') return undefined;
    const feats = registry
      .byType('subclassFeature')
      .filter(
        (f) =>
          String(f.subclassShortName ?? '').toLowerCase() === shortName &&
          String(f.className ?? '').toLowerCase() === className &&
          String(f.subclassSource ?? '').toLowerCase() === source,
      )
      .sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
    const summary = summarizeEntries(feats[0]?.entries);
    return summary !== '' ? summary : undefined;
  };
}

// --- Classes ---------------------------------------------------------------

/** Playstyle blurb per class (keyed lowercase). Kept to one phone-width line. */
const CLASS_BLURBS: Record<string, string> = {
  artificer: 'Magical inventor — infuses items, versatile gadgets. Medium complexity.',
  barbarian: 'Raging melee tank — huge HP, hits hard, simple to play.',
  bard: 'Charming support caster — inspire allies, talk your way in. Flexible.',
  cleric: 'Divine caster — heal, buff, and still fight. Strong at every level.',
  druid: 'Nature caster — shapeshift into beasts, control terrain. Medium complexity.',
  fighter: 'Master of weapons and armor — durable, straightforward, always useful.',
  monk: 'Fast unarmored striker — flurries of blows, mobility tricks.',
  paladin: 'Holy knight — melee + healing + smites. Durable and dramatic.',
  ranger: 'Wilderness skirmisher — ranged or two-weapon fighting, tracking, a bit of magic.',
  rogue: 'Sneaky skill expert — one big Sneak Attack per turn, best skills in the game.',
  sorcerer: 'Innate caster — fewer spells than a wizard but bends them with metamagic.',
  warlock: 'Pact caster — few but always-max spell slots, strongest cantrip. Simple casting.',
  wizard: 'The spell encyclopedia — most options, most fragile. High complexity.',
};

/**
 * Standard-array assignment order per class: first entry gets 15, then 14, …
 * The classic "safe" builds; players can always rearrange afterwards.
 */
const CLASS_ABILITY_PRIORITY: Record<string, Ability[]> = {
  artificer: ['int', 'con', 'dex', 'wis', 'str', 'cha'],
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  cleric: ['wis', 'con', 'str', 'cha', 'dex', 'int'],
  druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  monk: ['dex', 'wis', 'con', 'str', 'cha', 'int'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'],
  ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  rogue: ['dex', 'con', 'cha', 'int', 'wis', 'str'],
  sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};

export function classBlurb(e: Entity): string | undefined {
  const curated = CLASS_BLURBS[nameOf(e).toLowerCase()];
  const hd = (e.hd as { faces?: number } | undefined)?.faces;
  const hdText = typeof hd === 'number' ? `d${hd} HP` : undefined;
  if (curated !== undefined) return hdText !== undefined ? `${curated} (${hdText})` : curated;
  return hdText;
}

/** "STR, then CON" — what to put your best scores in for this class. */
export function classAbilityHint(className: string): string | undefined {
  const prio = CLASS_ABILITY_PRIORITY[className.toLowerCase()];
  if (prio === undefined) return undefined;
  const [first, second] = prio;
  if (first === undefined || second === undefined) return undefined;
  return `${first.toUpperCase()} first, then ${second.toUpperCase()}`;
}

/** Standard array laid onto this class's priority order (undefined = no data). */
export function standardArrayFor(className: string): Record<Ability, number> | undefined {
  const prio = CLASS_ABILITY_PRIORITY[className.toLowerCase()];
  if (prio === undefined) return undefined;
  const out = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const values = [15, 14, 13, 12, 10, 8];
  prio.forEach((a, i) => {
    out[a] = values[i] ?? 10;
  });
  return out;
}

/**
 * Point-buy preset that spends all 27 points on the class's top three
 * abilities (15/15/15, rest 8) — the classic focused optimizer spread.
 * Costs 3×9 = 27, so it's always legal.
 */
export function pointBuyFocusFor(className: string): Record<Ability, number> | undefined {
  const prio = CLASS_ABILITY_PRIORITY[className.toLowerCase()];
  if (prio === undefined) return undefined;
  const out = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  for (const a of prio.slice(0, 3)) out[a] = 15;
  return out;
}

// --- Races -------------------------------------------------------------------

/** Flavor for the core options a new player is most likely to weigh. */
const RACE_BLURBS: Record<string, string> = {
  human: 'Adaptable all-rounder — a bonus to everything. Never a wrong pick.',
  elf: 'Graceful and perceptive — darkvision, keen senses, trance instead of sleep.',
  dwarf: 'Tough and steady — darkvision, poison resistance, at home underground.',
  halfling: 'Small and lucky — reroll natural 1s, brave, nimble.',
  dragonborn: 'Draconic heritage — breath weapon and an elemental resistance.',
  gnome: 'Small, clever, hard to charm — advantage on mental saves vs magic.',
  'half-elf': 'Charismatic and flexible — two skills and two ability picks of your choice.',
  'half-orc': 'Relentless bruiser — survive at 1 HP once per rest, brutal crits.',
  tiefling: 'Infernal heritage — fire resistance and innate magic.',
  aasimar: 'Celestial heritage — healing touch, radiant power.',
  goliath: 'Mountain-born powerhouse — shrug off part of a hit.',
  orc: 'Powerful and unstoppable — dash toward enemies, tough.',
};

/** "+2 STR, +1 CHA" from a race's ability block (2014-style data). */
function abilityBonusText(e: Entity): string | undefined {
  const arr = Array.isArray(e.ability) ? e.ability : [];
  const parts: string[] = [];
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) continue;
    for (const a of ABILITIES) {
      const v = (entry as Record<string, unknown>)[a];
      if (typeof v === 'number') parts.push(`+${v} ${a.toUpperCase()}`);
    }
    if ('choose' in entry) parts.push('+ your choice');
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function raceBlurb(e: Entity): string | undefined {
  const bits: string[] = [];
  const curated = RACE_BLURBS[nameOf(e).toLowerCase()];
  if (curated !== undefined) bits.push(curated);
  const bonuses = abilityBonusText(e);
  if (bonuses !== undefined) bits.push(bonuses);
  if (typeof e.darkvision === 'number') bits.push(`darkvision ${e.darkvision} ft`);
  return bits.length > 0 ? bits.join(' · ') : undefined;
}

// --- Backgrounds -------------------------------------------------------------

/** Fixed skill grants straight from the data — what the pick actually gives. */
export function backgroundBlurb(e: Entity): string | undefined {
  const arr = Array.isArray(e.skillProficiencies) ? e.skillProficiencies : [];
  const skills: string[] = [];
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) continue;
    for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
      if (v === true) skills.push(k.replace(/(^|\s)\w/g, (c) => c.toUpperCase()));
    }
  }
  return skills.length > 0 ? `Skills: ${skills.join(', ')}` : undefined;
}
