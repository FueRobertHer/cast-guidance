/**
 * Effects on the character during play (`PlayState.activeEffects`): reading
 * them back from a stored document, and the rule that effects of one name
 * never add up. Pure: derive folds what counts in beside the build's own.
 */
import {
  ABILITIES,
  ACTIVE_PART_KINDS,
  type ActiveEffect,
  type ActivePartKind,
  type EffectDuration,
  type EffectInput,
  type EffectPart,
  type NotCounted,
} from './types';

type Raw = Record<string, unknown>;

const isObj = (x: unknown): x is Raw => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const optStr = (x: unknown) => x === undefined || isStr(x);
const optBool = (x: unknown) => x === undefined || typeof x === 'boolean';
const isAbility = (x: unknown) => ABILITIES.includes(x as never);
const optAbility = (x: unknown) => x === undefined || isAbility(x);
const isScope = (x: unknown) => x === 'melee' || x === 'ranged' || x === 'all';
const oneOf =
  (...values: readonly unknown[]) =>
  (x: unknown) =>
    values.includes(x);
const listOf = (x: unknown, each: (v: unknown) => boolean) =>
  Array.isArray(x) && x.length > 0 && x.every(each);
/** "1d4", "d8", "2d6": what a die field holds. Never "0d4" or "1d0". */
const isDice = (x: unknown) => typeof x === 'string' && /^([1-9]\d?)?d[1-9]\d{0,2}$/.test(x);

function isFilter(x: unknown): boolean {
  if (!isObj(x)) return false;
  return (
    listOf(x.rolls, oneOf('attack', 'save', 'check')) &&
    (x.abilities === undefined || listOf(x.abilities, isAbility)) &&
    (x.skills === undefined || listOf(x.skills, isStr)) &&
    optBool(x.skilled) &&
    (x.attack === undefined || oneOf('weapon', 'spell')(x.attack)) &&
    (x.range === undefined || oneOf('melee', 'ranged')(x.range)) &&
    optStr(x.className)
  );
}

/** Each kind's fields, checked. Amounts are plain numbers, never worked out here. */
const VALID: Record<ActivePartKind, (p: Raw) => boolean> = {
  abilityMin: (p) => isAbility(p.ability) && isNum(p.min),
  acBonus: (p) => isNum(p.amount),
  acFormula: (p) =>
    isStr(p.label) &&
    isNum(p.base) &&
    Array.isArray(p.addAbilities) &&
    p.addAbilities.every(isAbility) &&
    (p.dexMax === undefined || isNum(p.dexMax)),
  acMin: (p) => isNum(p.min),
  attackBonus: (p) =>
    isScope(p.scope) &&
    isNum(p.amount) &&
    (p.attack === undefined || oneOf('weapon', 'spell', 'any')(p.attack)) &&
    optAbility(p.ability) &&
    optStr(p.weapon),
  checkBonus: (p) =>
    isNum(p.amount) &&
    ('every' in p
      ? p.every === true && !('ability' in p) && !('skills' in p)
      : 'ability' in p
        ? isAbility(p.ability) && !('skills' in p)
        : listOf(p.skills, isStr)),
  conditionImmune: (p) => isStr(p.condition) && optStr(p.note),
  critRange: (p) => Number.isInteger(p.min) && (p.min as number) >= 2 && (p.min as number) <= 20,
  cue: (p) => oneOf('help', 'ward', 'warn', 'info')(p.tone) && isStr(p.text),
  damageBonus: (p) =>
    isScope(p.scope) && isNum(p.amount) && optAbility(p.ability) && optStr(p.weapon),
  damageDie: (p) => isScope(p.scope) && isDice(p.dice) && optStr(p.damageType) && optStr(p.weapon),
  extraAction: (p) => isStr(p.label) && optStr(p.note),
  immune: (p) => isStr(p.damageType) && optStr(p.note),
  initiativeBonus: (p) => isNum(p.amount),
  maxHpBonus: (p) => isNum(p.amount),
  moveSpeed: (p) =>
    oneOf('fly', 'climb', 'swim')(p.mode) &&
    (p.speed === 'walk' || (isNum(p.speed) && p.speed >= 0)),
  resist: (p) => isStr(p.damageType) && optStr(p.note),
  rollAdvantage: (p) => oneOf('adv', 'dis')(p.mode) && isFilter(p.on),
  rollDie: (p) => isDice(p.dice) && isFilter(p.on),
  rollOffer: (p) => isDice(p.dice) && isFilter(p.on) && optBool(p.once) && optBool(p.ifFailed),
  saveBonus: (p) =>
    isNum(p.amount) && (p.abilities === undefined || listOf(p.abilities, isAbility)),
  sense: (p) => isStr(p.sense) && isNum(p.range) && p.range >= 0,
  spellDcBonus: (p) => isNum(p.amount) && optStr(p.className),
  speedBonus: (p) => isNum(p.amount),
  speedMultiplier: (p) => isNum(p.factor) && p.factor > 0,
  tempHpEachTurn: (p) => isNum(p.amount) && p.amount >= 0,
  vulnerable: (p) => isStr(p.damageType),
};

function readPart(raw: unknown): EffectPart | undefined {
  if (!isObj(raw) || !ACTIVE_PART_KINDS.includes(raw.kind as never)) return undefined;
  if (!optStr(raw.same) || !VALID[raw.kind as ActivePartKind](raw)) return undefined;
  return { ...raw } as EffectPart;
}

function readDuration(raw: unknown): EffectDuration | undefined {
  if (!isObj(raw)) return undefined;
  const out: EffectDuration = {};
  if (isNum(raw.minutes) && raw.minutes >= 0) out.minutes = raw.minutes;
  if (raw.rest === 'short' || raw.rest === 'long') out.rest = raw.rest;
  if (typeof raw.concentration === 'boolean') out.concentration = raw.concentration;
  return out;
}

export interface ReadEffects {
  effects: ActiveEffect[];
  /** What was left out and why, worded for the player. */
  problems: string[];
}

/**
 * The effects a stored document holds, checked field by field, as copies. An
 * effect with no id or name, or an id another one already has, is left out; a
 * part this version cannot read (a newer app's kind, a malformed field) is left
 * out of its effect. The document itself is never changed, so an older app in
 * another tab cannot strip what a newer one saved.
 */
export function readActiveEffects(raw: unknown): ReadEffects {
  const effects: ActiveEffect[] = [];
  const problems: string[] = [];
  if (raw === undefined) return { effects, problems };
  if (!Array.isArray(raw)) {
    problems.push('Effects in play could not be read, so none of them count.');
    return { effects, problems };
  }
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObj(item) || !isStr(item.id) || !isStr(item.name) || !Array.isArray(item.parts)) {
      problems.push('An effect in play could not be read, so it does not count.');
      continue;
    }
    if (ids.has(item.id)) {
      problems.push(
        `${item.name}: it is in play twice under one id, so the second does not count.`,
      );
      continue;
    }
    ids.add(item.id);
    const parts: EffectPart[] = [];
    for (const p of item.parts) {
      const part = readPart(p);
      if (part !== undefined) parts.push(part);
    }
    const skipped = item.parts.length - parts.length;
    if (skipped > 0) {
      problems.push(
        `${item.name}: ${skipped === 1 ? 'one part' : `${skipped} parts`} of it this version of the app cannot read, so ${skipped === 1 ? 'that part does' : 'those do'} not count.`,
      );
    }
    const effect: ActiveEffect = { id: item.id, name: item.name, parts };
    if (isStr(item.same)) effect.same = item.same;
    const lasts = readDuration(item.lasts);
    if (lasts !== undefined) effect.lasts = lasts;
    if (Number.isInteger(item.turnsLeft) && (item.turnsLeft as number) >= 0)
      effect.turnsLeft = item.turnsLeft as number;
    if (item.mine === true) effect.mine = true;
    if (item.off === true) effect.off = true;
    effects.push(effect);
  }
  return { effects, problems };
}

/** The named effect a part counts as, for the rule that one name never adds up twice. */
export function namedEffect(effect: ActiveEffect, part: EffectPart): string {
  return part.same ?? effect.same ?? effect.name;
}

const groupKey = (name: string) => name.trim().toLowerCase();

/**
 * The group a part counts in: its named effect, and the weapon it is on when
 * it is on one. The rule is per target, and two weapons are two targets: two
 * Magic Weapons on two swords both count.
 */
function partGroup(effect: ActiveEffect, part: EffectPart): string {
  const weapon = 'weapon' in part ? part.weapon : undefined;
  const name = groupKey(namedEffect(effect, part));
  return weapon === undefined ? name : `${name}\u0000${weapon}`;
}

/**
 * The groups an effect's parts count in, for asking whether another already
 * on would count instead (a Potion of Heroism's d4 meets Bless).
 */
export function countsAs(effect: ActiveEffect): Set<string> {
  return new Set(effect.parts.map((p) => partGroup(effect, p)));
}

/**
 * The field that says how strong a part of each kind is, where two castings of
 * one effect can differ by a number or a die (Aid at two slot levels). Kinds
 * not listed have no strength: two of them are the same or different things.
 */
const MEASURE: Partial<Record<ActivePartKind, string>> = {
  abilityMin: 'min',
  acBonus: 'amount',
  acFormula: 'base',
  acMin: 'min',
  attackBonus: 'amount',
  checkBonus: 'amount',
  critRange: 'min',
  damageBonus: 'amount',
  damageDie: 'dice',
  initiativeBonus: 'amount',
  maxHpBonus: 'amount',
  moveSpeed: 'speed',
  rollDie: 'dice',
  rollOffer: 'dice',
  saveBonus: 'amount',
  sense: 'range',
  spellDcBonus: 'amount',
  speedBonus: 'amount',
  speedMultiplier: 'factor',
  tempHpEachTurn: 'amount',
};

/** A part's measured value, when it has one: a number, or a die's average. */
function measured(part: EffectPart): number | undefined {
  const key = MEASURE[part.kind];
  const v = key === undefined ? undefined : (part as Raw)[key];
  if (isNum(v)) return part.kind === 'critRange' ? -v : v; // a lower crit range is stronger
  if (isDice(v)) {
    const [count, sides] = (v as string).split('d');
    return (Number(count || 1) * (Number(sides) + 1)) / 2;
  }
  return undefined; // a climb speed equal to walking is not a number to compare
}

/**
 * How strong a part is, to pick between two castings of one effect. An amount
 * counts by its size, so of two penalties the larger one is the more potent.
 */
function strength(part: EffectPart): number {
  const v = measured(part) ?? 0;
  return MEASURE[part.kind] === 'amount' ? Math.abs(v) : v;
}

/** Keys in order at every depth, so a filter written in another order is the same filter. */
function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (!isObj(x)) return x;
  return Object.fromEntries(
    Object.keys(x)
      .sort()
      .map((k) => [k, canonical(x[k])]),
  );
}

/** A part's shape: everything but how strong it is. */
function shape(part: EffectPart): string {
  const { same, ...rest } = part as Raw;
  const key = MEASURE[part.kind];
  if (key !== undefined && measured(part) !== undefined) delete rest[key];
  return JSON.stringify(canonical(rest));
}

/** The parts one effect brings to a named group, and its shape and strength there. */
interface Entry {
  effect: ActiveEffect;
  parts: EffectPart[];
}

function sameShape(a: Entry, b: Entry): boolean {
  if (a.parts.length !== b.parts.length) return false;
  const sa = a.parts.map(shape).sort();
  const sb = b.parts.map(shape).sort();
  return sa.every((s, i) => s === sb[i]);
}

const total = (e: Entry) => e.parts.reduce((n, p) => n + strength(p), 0);

export interface CountingEffects {
  /** The parts that count, as effects with an `active` origin, in the order they were added. */
  inputs: EffectInput[];
  notCounted: NotCounted[];
}

/**
 * What the effects in play add, under the rule both editions state once:
 * effects of the same name do not combine, the most potent one counts. Parts
 * are grouped by the named effect they are (`namedEffect`), so a Potion of
 * Speed's parts meet Haste's and a Potion of Heroism's d4 meets Bless's, and
 * by the weapon a part is on (`partGroup`), since the rule is per target. In a
 * group one effect counts: the strongest when every effect there does the same
 * things by different amounts (Aid at two slot levels), otherwise the first
 * added. The rest stay in play, counting for nothing until it ends. An effect
 * switched off counts for nothing and blocks nothing.
 */
export function countingEffects(effects: readonly ActiveEffect[]): CountingEffects {
  const groups = new Map<string, Entry[]>();
  for (const effect of effects) {
    if (effect.off === true) continue;
    for (const part of effect.parts) {
      const key = partGroup(effect, part);
      const entries = groups.get(key) ?? [];
      if (entries.length === 0) groups.set(key, entries);
      const entry = entries.find((x) => x.effect === effect);
      if (entry !== undefined) entry.parts.push(part);
      else entries.push({ effect, parts: [part] });
    }
  }

  const counted = new Set<EffectPart>();
  const notCounted: NotCounted[] = [];
  for (const entries of groups.values()) {
    let winner = entries[0] as Entry;
    if (entries.every((e) => sameShape(e, winner))) {
      for (const e of entries) if (total(e) > total(winner)) winner = e;
    }
    for (const p of winner.parts) counted.add(p);
    for (const e of entries) {
      if (e === winner) continue;
      notCounted.push({
        effectId: e.effect.id,
        effectName: e.effect.name,
        same: namedEffect(e.effect, e.parts[0] as EffectPart),
        countedFrom: winner.effect.name,
      });
    }
  }

  const inputs: EffectInput[] = [];
  for (const effect of effects) {
    for (const part of effect.parts) {
      if (!counted.has(part)) continue;
      const { same, ...rest } = part;
      inputs.push({
        ...rest,
        origin: { type: 'active', label: effect.name, uid: effect.id },
      } as EffectInput);
    }
  }
  return { inputs, notCounted };
}
