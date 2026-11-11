import type { Entity } from '@/data5e/copyMod';
import {
  type SetDice,
  setDiceOf,
  setsDice,
  tagLevels,
  textUpcastTag,
} from '../../data5e/entries/upcast';

export interface SpellRollAction {
  expr: string;
  label: string;
  /** `heal` for dice its label calls healing (DS-001), so they show green. */
  variant: 'dice' | 'damage' | 'heal';
}

export interface SpellRollOptions {
  characterLevel: number;
  /** Slot actually used for this cast; defaults to the spell's base level. */
  slotLevel?: number;
  abilityModifier?: number;
  /**
   * What the character adds to this spell's damage (Agonizing Blast, Potent
   * Spellcasting): to each damage roll, or with `oneRoll` to the first alone.
   */
  damageBonuses?: ReadonlyArray<{ amount: number; oneRoll?: boolean }>;
}

interface TaggedRoll {
  expr: string;
  kind: 'damage' | 'dice';
  source: string;
  after: string;
  /** Set when the roll came from a scaling block: that block's own label. */
  scalingLabel?: string;
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const child of value) stringsIn(child, out);
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) stringsIn(child, out);
  }
  return out;
}

/**
 * Longest tag body or argument list the roll patterns will consider. Real
 * dice expressions are a handful of characters. The cap is what keeps these
 * patterns linear: with an unbounded `[^}|]+`, every unclosed `{@damage `
 * in a string made the engine walk the rest of that string again, so a long
 * homebrew entry full of them cost time proportional to its length squared.
 * Bounded, each attempt gives up after this many characters.
 */
const MAX_TAG_PART = 200;

const TAGGED_ROLL = new RegExp(
  `{@(damage|dice) ([^}|]{1,${MAX_TAG_PART}})(?:\\|[^}]{0,${MAX_TAG_PART}})?}`,
  'gi',
);

/** `{@scaledamage <base rolls>|<slot levels>|<step>}`, any later arguments aside. */
const SCALE_TAG = new RegExp(
  `{@scale(?:damage|dice) ([^}|]{1,${MAX_TAG_PART}})\\|([^}|]{1,${MAX_TAG_PART}})\\|([^}|]{1,${MAX_TAG_PART}})(?:\\|[^}]{0,${MAX_TAG_PART}})?}`,
  'gi',
);

function taggedRolls(value: unknown): TaggedRoll[] {
  const out: TaggedRoll[] = [];
  for (const source of stringsIn(value)) {
    // `matchAll` iterates a copy, so the shared pattern's `lastIndex` stays put.
    for (const match of source.matchAll(TAGGED_ROLL)) {
      const kind = match[1]?.toLowerCase();
      // "d4" and "1d4" are the same roll, and only one of them looks like one.
      const expr = match[2]?.replaceAll(' ', '').replace(/^d/i, '1d');
      if ((kind !== 'damage' && kind !== 'dice') || expr === undefined) continue;
      const end = (match.index ?? 0) + match[0].length;
      out.push({ expr, kind, source, after: source.slice(end, end + 100) });
    }
  }
  return out;
}

interface ScalingBlock {
  label?: unknown;
  scaling?: Record<string, unknown>;
}

/**
 * The die a scaling block gives at this character level.
 *
 * A spell with two outcomes carries two blocks (Toll the Dead rolls d8, or d12
 * against a wounded target), so this runs per block and the caller keeps one
 * chip for each.
 */
function levelScaledRoll(
  block: ScalingBlock,
  characterLevel: number,
  abilityModifier: number | undefined,
): TaggedRoll | undefined {
  if (block.scaling === undefined) return undefined;
  // A sheet with no class picked yet is level 0. It rolls what a 1st-level
  // character rolls: Fire Bolt's 1d10, and no on-hit die for Booming or
  // Green-Flame Blade, which only gain one at 5th level. Offering a block's
  // first tier instead handed a classless sheet 5th-level dice.
  const atLevel = Math.max(characterLevel, 1);
  let bestLevel = -1;
  let expr: string | undefined;
  for (const [rawLevel, rawExpr] of Object.entries(block.scaling)) {
    const level = Number.parseInt(rawLevel, 10);
    if (typeof rawExpr !== 'string') continue;
    if (level <= atLevel && level > bestLevel) {
      bestLevel = level;
      expr = rawExpr.replaceAll(' ', '');
    }
  }
  if (expr === undefined) return undefined;
  const filled = fillSpellcastingModifier(expr, abilityModifier);
  if (filled === undefined) return undefined;
  const label = typeof block.label === 'string' ? block.label : '';
  return { expr: filled, kind: 'damage', source: label, after: '', scalingLabel: label };
}

const SPELLCASTING_MOD = /([+-]?)\{\{spellcasting_mod\}\}/g;

/**
 * Put the caster's modifier where 5etools writes `{{spellcasting_mod}}`
 * (Green-Flame Blade's "1d8 + {{spellcasting_mod}}"), signed so a negative one
 * reads `1d8-1`. Without a known modifier the term is dropped, since a chip
 * cannot roll a number the sheet does not have.
 *
 * Returns undefined when nothing rollable is left: an empty expression, a
 * fixed amount of zero or less, or any other `{{...}}` template this does not
 * know, which the dice parser would refuse.
 */
function fillSpellcastingModifier(expr: string, modifier: number | undefined): string | undefined {
  const filled = expr
    .replace(SPELLCASTING_MOD, (_match, sign: string, offset: number) => {
      if (modifier === undefined) return '';
      const value = sign === '-' ? -modifier : modifier;
      if (value === 0) return '';
      if (sign === '' && offset === 0) return String(value);
      return value > 0 ? `+${value}` : String(value);
    })
    .replace(/^\+/, '');
  if (filled === '' || filled.includes('{{')) return undefined;
  if (/^[+-]?\d+$/.test(filled) && Number(filled) <= 0) return undefined;
  return filled;
}

/** Every scaling block a spell carries, in file order: one on most cantrips,
 *  and an array on the two-outcome ones. A block without a `scaling` table is
 *  skipped, so a malformed one leaves the prose dice in place. */
function scalingBlocks(entity: Entity): ScalingBlock[] {
  const raw: unknown = entity.scalingLevelDice;
  if (raw === undefined || raw === null) return [];
  const blocks: unknown[] = Array.isArray(raw) ? raw : [raw];
  return blocks.filter(
    (block): block is ScalingBlock =>
      block !== null &&
      typeof block === 'object' &&
      typeof (block as ScalingBlock).scaling === 'object' &&
      (block as ScalingBlock).scaling !== null,
  );
}

function levelScaledRolls(
  blocks: ScalingBlock[],
  characterLevel: number,
  abilityModifier: number | undefined,
): TaggedRoll[] {
  const out: TaggedRoll[] = [];
  for (const block of blocks) {
    const roll = levelScaledRoll(block, characterLevel, abilityModifier);
    if (roll !== undefined) out.push(roll);
  }
  return out;
}

/**
 * Whether a tagged roll is part of a sentence about how the spell grows rather
 * than something rolled at the table. Both editions phrase it the same way:
 * "increases by 1d10 when you reach 5th level" / "when you reach levels 5".
 */
function describesScaling(roll: TaggedRoll): boolean {
  return /when you reach/i.test(roll.after);
}

function sameDie(expr: string): { count: number; sides: number } | undefined {
  const match = expr.match(/^(\d*)d(\d+)$/i);
  if (match === null) return undefined;
  return { count: Number(match[1] || 1), sides: Number(match[2]) };
}

function addRepeated(base: string, increment: string, times: number): string {
  if (times <= 0) return base;
  const a = sameDie(base);
  const b = sameDie(increment);
  if (a !== undefined && b !== undefined && a.sides === b.sides) {
    return `${a.count + b.count * times}d${a.sides}`;
  }
  return [base, ...Array.from({ length: times }, () => increment)].join('+');
}

/** One upcast step: the rolls it grows, the slot levels it lists, and what it adds at each. */
interface UpcastStep {
  bases: string[];
  levels: number[] | undefined;
  step: string;
  /** Grows the first roll of its base alone: "the spell's initial damage increases by". */
  firstOnly: boolean;
}

function stepOf(match: RegExpMatchArray, firstOnly: boolean): UpcastStep | undefined {
  const step = match[3]?.replaceAll(' ', '');
  if (step === undefined) return undefined;
  const bases = (match[1] ?? '').split(';').map((base) => base.replaceAll(' ', ''));
  return { bases, levels: tagLevels(match[2] ?? ''), step, firstOnly };
}

/**
 * The spell's upcast steps: its tags that add dice, and none that set them
 * ("increases to", which `setDiceOf` reads). A spell with no tag at all takes
 * its step from the text ("the damage increases by 1d6 for each slot level
 * above 1st"), as the converter does; that step grows only the first roll of
 * its die when the text says it is the initial damage that grows.
 */
function upcastSteps(entity: Entity, baseLevel: number): UpcastStep[] {
  const higher = stringsIn(entity.entriesHigherLevel).join(' ');
  if (/\{@scale(?:damage|dice) /i.test(higher)) {
    const steps: UpcastStep[] = [];
    for (const match of higher.matchAll(SCALE_TAG)) {
      if (setsDice(higher.slice(0, match.index))) continue;
      const step = stepOf(match, false);
      if (step !== undefined) steps.push(step);
    }
    return steps;
  }
  const tag = textUpcastTag(entity.entries, entity.entriesHigherLevel, baseLevel);
  const match = tag === undefined ? undefined : [...tag.matchAll(SCALE_TAG)][0];
  const step = match === undefined ? undefined : stepOf(match, /\binitial damage\b/i.test(higher));
  return step === undefined ? [] : [step];
}

/**
 * The roll as cast with a higher slot. Dice a sentence sets for this slot
 * replace the roll (Shadow Blade's 3d8 at 3rd and 4th). Otherwise an upcast step grows
 * each of its base rolls, which a semicolon separates ("4d4;2d4": Acid Arrow's
 * initial and later damage), by its step once for each level it lists above
 * its lowest (and above the spell's own), up to the slot used: so "2,4,6,8"
 * adds nothing at 3rd level and one step at 4th. A list of another shape counts
 * every level above the spell's. `grown` holds the first-only steps already used.
 */
function applySlotScaling(
  roll: TaggedRoll,
  steps: readonly UpcastStep[],
  set: readonly SetDice[],
  grown: Set<UpcastStep>,
  baseLevel: number,
  slotLevel: number,
): TaggedRoll {
  const at = set.find((s) => s.base === roll.expr && s.levels.includes(slotLevel));
  if (at !== undefined) return { ...roll, expr: at.expr };
  for (const upcast of steps) {
    if (!upcast.bases.includes(roll.expr)) continue;
    if (upcast.firstOnly && grown.has(upcast)) return roll;
    grown.add(upcast);
    const { levels } = upcast;
    // The printed roll is the spell's own level's, whatever lower level a tag lists.
    const lowest = levels === undefined ? baseLevel : Math.max(baseLevel, Math.min(...levels));
    const times =
      levels === undefined
        ? slotLevel - baseLevel
        : levels.filter((level) => level > lowest && level <= slotLevel).length;
    return { ...roll, expr: addRepeated(roll.expr, upcast.step, times) };
  }
  return roll;
}

function withAbilityModifier(roll: TaggedRoll, modifier: number | undefined): TaggedRoll {
  if (modifier === undefined) return roll;
  if (!/^\s*(?:\+|plus)\s+your spellcasting ability modifier/i.test(roll.after)) return roll;
  if (modifier === 0) return roll;
  return { ...roll, expr: `${roll.expr}${modifier > 0 ? '+' : ''}${modifier}` };
}

/**
 * A roll with a flat amount added, folded into the number its dice end with
 * (Magic Missile's "1d4+1" and 3 make "1d4+4").
 */
function plus(roll: TaggedRoll, amount: number): TaggedRoll {
  if (amount === 0) return roll;
  const flat = /^(.*d\d+)([+-]\d+)$/i.exec(roll.expr);
  const [dice, total] =
    flat?.[1] !== undefined ? [flat[1], Number(flat[2]) + amount] : [roll.expr, amount];
  if (total === 0) return { ...roll, expr: dice };
  return { ...roll, expr: `${dice}${total > 0 ? '+' : ''}${total}` };
}

/** Whether a roll restores hit points, by the words around it. */
function heals(roll: TaggedRoll): boolean {
  return /\bregains?\b|\bhealing\b/.test(roll.source.toLowerCase());
}

function rollLabel(name: string, roll: TaggedRoll, scalingLabel?: string): string {
  if (scalingLabel !== undefined && scalingLabel !== '') return `${name} ${scalingLabel}`;
  // Damage first, as the variant is: Vampiric Touch's dice are its damage.
  if (roll.kind === 'damage') {
    const damageType = roll.after.match(
      /^\s*(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/i,
    )?.[1];
    return `${name}${damageType !== undefined ? ` ${damageType}` : ''} damage`;
  }
  if (heals(roll)) return `${name} healing`;
  return `${name} roll`;
}

/**
 * Convert 5etools spell dice tags into playable roll actions. Cantrip dice use
 * total character level; `scaledamage`/`scaledice` tags use the selected slot.
 */
export function spellRollActions(
  entity: Entity | undefined,
  options: SpellRollOptions,
): SpellRollAction[] {
  if (entity === undefined) return [];
  const name = typeof entity.name === 'string' ? entity.name : 'Spell';
  const baseLevel = typeof entity.level === 'number' ? entity.level : 0;
  const slotLevel = Math.max(baseLevel, options.slotLevel ?? baseLevel);
  const blocks = scalingBlocks(entity);
  const scaled = levelScaledRolls(blocks, options.characterLevel, options.abilityModifier);
  const primary = taggedRolls(entity.entries);
  // A scaling cantrip states its ladder twice: once in the machine-readable
  // block, and again in prose ("increases by 1d10 when you reach 5th level").
  // Only the block knows the character's level, so the sentence beside it is
  // description, not a roll anyone makes, whichever tag it happens to carry.
  // That holds even when no block has a roll at this level (Green-Flame Blade
  // at 1st level with no modifier known): the prose dice are 5th-level dice.
  const rolls =
    blocks.length === 0
      ? primary
      : [...scaled, ...primary.filter((roll) => roll.kind !== 'damage' && !describesScaling(roll))];
  const steps = upcastSteps(entity, baseLevel);
  const set = setDiceOf(entity.entries, entity.entriesHigherLevel);
  const grown = new Set<UpcastStep>();
  const bonuses = options.damageBonuses ?? [];
  const each = bonuses.reduce((sum, b) => sum + (b.oneRoll === true ? 0 : b.amount), 0);
  const once = bonuses.reduce((sum, b) => sum + (b.oneRoll === true ? b.amount : 0), 0);
  let damageRolls = 0;
  const seen = new Set<string>();
  const out: SpellRollAction[] = [];
  for (const raw of rolls) {
    const plain = withAbilityModifier(
      applySlotScaling(raw, steps, set, grown, baseLevel, slotLevel),
      options.abilityModifier,
    );
    const label = rollLabel(name, plain, plain.scalingLabel);
    // A roll the spell states twice is one chip. Checked before a bonus is
    // added, since a one-roll bonus would make the second look different.
    const key = `${plain.kind}|${plain.expr}|${label}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const roll =
      plain.kind === 'damage' ? plus(plain, each + (damageRolls === 0 ? once : 0)) : plain;
    // Damage first: a spell that hurts and heals (Vampiric Touch) still
    // rolls its damage dice as damage.
    const variant = roll.kind === 'damage' ? 'damage' : heals(roll) ? 'heal' : 'dice';
    if (roll.kind === 'damage') damageRolls++;
    out.push({ expr: roll.expr, label, variant });
  }
  return out;
}
