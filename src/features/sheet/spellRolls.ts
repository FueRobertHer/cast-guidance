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
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const child of value) stringsIn(child, out);
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) stringsIn(child, out);
  }
  return out;
}

function taggedRolls(value: unknown): TaggedRoll[] {
  const out: TaggedRoll[] = [];
  for (const source of stringsIn(value)) {
    const re = /{@(damage|dice) ([^}|]+)(?:\|[^}]*)?}/gi;
    for (const match of source.matchAll(re)) {
      const kind = match[1]?.toLowerCase();
      const expr = match[2]?.replaceAll(' ', '');
      if ((kind !== 'damage' && kind !== 'dice') || expr === undefined) continue;
      const end = (match.index ?? 0) + match[0].length;
      out.push({ expr, kind, source, after: source.slice(end, end + 100) });
    }
  }
  return out;
}

function levelScaledRoll(entity: Entity, characterLevel: number): TaggedRoll | undefined {
  const block = entity.scalingLevelDice as
    | { label?: unknown; scaling?: Record<string, unknown> }
    | undefined;
  if (block?.scaling === undefined) return undefined;
  let bestLevel = -1;
  let expr: string | undefined;
  for (const [rawLevel, rawExpr] of Object.entries(block.scaling)) {
    const level = Number.parseInt(rawLevel, 10);
    if (level <= characterLevel && level > bestLevel && typeof rawExpr === 'string') {
      bestLevel = level;
      expr = rawExpr.replaceAll(' ', '');
    }
  }
  if (expr === undefined) return undefined;
  return {
    expr,
    kind: 'damage',
    source: typeof block.label === 'string' ? block.label : '',
    after: '',
  };
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
  const re = /{@scale(?:damage|dice) ([^}|]+)\|[^}|]+\|([^}|]+)(?:\|[^}]*)?}/gi;
  for (const match of higher.matchAll(re)) {
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
  const scaled = levelScaledRoll(entity, options.characterLevel);
  const primary = taggedRolls(entity.entries);
  const rolls =
    scaled === undefined ? primary : [scaled, ...primary.filter((roll) => roll.kind !== 'damage')];
  const scalingLabel =
    scaled !== undefined &&
    typeof (entity.scalingLevelDice as { label?: unknown }).label === 'string'
      ? String((entity.scalingLevelDice as { label: string }).label)
      : undefined;
  const seen = new Set<string>();
  const out: SpellRollAction[] = [];
  for (const raw of rolls) {
    const roll = withAbilityModifier(
      applySlotScaling(raw, entity, baseLevel, slotLevel),
      options.abilityModifier,
    );
    const label = rollLabel(name, roll, raw === scaled ? scalingLabel : undefined);
    const key = `${roll.kind}|${roll.expr}|${label}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ expr: roll.expr, label, variant: roll.kind === 'damage' ? 'damage' : 'dice' });
  }
  return out;
}
