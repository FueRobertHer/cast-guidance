import type { Entity } from '@/data5e/copyMod';

export interface SpellRollAction {
  expr: string;
  label: string;
  variant: 'dice' | 'damage';
}

export interface SpellRollOptions {
  characterLevel: number;
  /** Slot actually used for this cast; defaults to the spell's base level. */
  slotLevel?: number;
  abilityModifier?: number;
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

const SCALE_TAG = new RegExp(
  `{@scale(?:damage|dice) ([^}|]{1,${MAX_TAG_PART}})\\|[^}|]{1,${MAX_TAG_PART}}\\|([^}|]{1,${MAX_TAG_PART}})(?:\\|[^}]{0,${MAX_TAG_PART}})?}`,
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

function applySlotScaling(
  roll: TaggedRoll,
  entity: Entity,
  baseLevel: number,
  slotLevel: number,
): TaggedRoll {
  const higher = stringsIn(entity.entriesHigherLevel).join(' ');
  for (const match of higher.matchAll(SCALE_TAG)) {
    const base = match[1]?.replaceAll(' ', '');
    const increment = match[2]?.replaceAll(' ', '');
    if (base === roll.expr && increment !== undefined) {
      return { ...roll, expr: addRepeated(roll.expr, increment, slotLevel - baseLevel) };
    }
  }
  return roll;
}

function withAbilityModifier(roll: TaggedRoll, modifier: number | undefined): TaggedRoll {
  if (modifier === undefined) return roll;
  if (!/^\s*(?:\+|plus)\s+your spellcasting ability modifier/i.test(roll.after)) return roll;
  if (modifier === 0) return roll;
  return { ...roll, expr: `${roll.expr}${modifier > 0 ? '+' : ''}${modifier}` };
}

function rollLabel(name: string, roll: TaggedRoll, scalingLabel?: string): string {
  if (scalingLabel !== undefined && scalingLabel !== '') return `${name} ${scalingLabel}`;
  const source = roll.source.toLowerCase();
  if (/\bregains?\b|\bhealing\b/.test(source)) return `${name} healing`;
  if (roll.kind === 'damage') {
    const damageType = roll.after.match(
      /^\s*(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/i,
    )?.[1];
    return `${name}${damageType !== undefined ? ` ${damageType}` : ''} damage`;
  }
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
  const seen = new Set<string>();
  const out: SpellRollAction[] = [];
  for (const raw of rolls) {
    const roll = withAbilityModifier(
      applySlotScaling(raw, entity, baseLevel, slotLevel),
      options.abilityModifier,
    );
    const label = rollLabel(name, roll, roll.scalingLabel);
    const key = `${roll.kind}|${roll.expr}|${label}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ expr: roll.expr, label, variant: roll.kind === 'damage' ? 'damage' : 'dice' });
  }
  return out;
}
