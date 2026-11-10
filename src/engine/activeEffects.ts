/**
 * Effects on the character during play (`PlayState.activeEffects`): reading
 * them back from a stored document, and the rule that effects of one name
 * never add up. Pure: derive folds what counts in beside the build's own.
 */
import { CAST_GUIDANCE_LIMITS } from './castGuidance';
import { readStoredEffects } from './effects/mechanics';
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
  speedBonus: (p) =>
    isNum(p.amount) && (p.unless === undefined || oneOf('heavyArmor', 'armorOrShield')(p.unless)),
  speedMultiplier: (p) => isNum(p.factor) && p.factor > 0,
  tempHpEachTurn: (p) => isNum(p.amount) && p.amount >= 0,
  vulnerable: (p) => isStr(p.damageType),
};

/** A field the object holds itself: an inherited one is never read. */
const own = (o: Raw, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);

/**
 * Each kind's fields besides `kind` and `same`. A part is built from these
 * alone, so a key this version does not know never rides into derive.
 */
const FIELDS: Record<ActivePartKind, readonly string[]> = {
  abilityMin: ['ability', 'min'],
  acBonus: ['amount'],
  acFormula: ['label', 'base', 'addAbilities', 'dexMax'],
  acMin: ['min'],
  attackBonus: ['scope', 'amount', 'attack', 'ability', 'weapon'],
  checkBonus: ['amount', 'skills', 'ability', 'every'],
  conditionImmune: ['condition', 'note'],
  critRange: ['min'],
  cue: ['tone', 'text'],
  damageBonus: ['scope', 'amount', 'ability', 'weapon'],
  damageDie: ['scope', 'dice', 'damageType', 'weapon'],
  extraAction: ['label', 'note'],
  immune: ['damageType', 'note'],
  initiativeBonus: ['amount'],
  maxHpBonus: ['amount'],
  moveSpeed: ['mode', 'speed'],
  resist: ['damageType', 'note'],
  rollAdvantage: ['mode', 'on'],
  rollDie: ['dice', 'on'],
  rollOffer: ['dice', 'on', 'once', 'ifFailed'],
  saveBonus: ['amount', 'abilities'],
  sense: ['sense', 'range'],
  spellDcBonus: ['amount', 'className'],
  speedBonus: ['amount', 'unless'],
  speedMultiplier: ['factor'],
  tempHpEachTurn: ['amount'],
  vulnerable: ['damageType'],
};

/** A roll filter's fields (`RollFilter`). */
const FILTER_FIELDS: ReadonlySet<string> = new Set([
  'rolls',
  'abilities',
  'skills',
  'skilled',
  'attack',
  'range',
  'className',
]);

/** Each kind's own fields, with `kind` and `same`, as a set to look keys up in. */
const KNOWN: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(FIELDS).map(([kind, fields]) => [kind, new Set(['kind', 'same', ...fields])]),
);

/**
 * The object's own fields that `known` has, in the order it holds them (so a
 * part reads back as it was stored), each copied by `copy`.
 */
function knownFields(
  o: Raw,
  known: ReadonlySet<string>,
  copy: (key: string, v: unknown) => unknown,
): Raw {
  const out: Raw = {};
  for (const key of Object.keys(o)) {
    if (!known.has(key)) continue;
    const v = o[key];
    if (v !== undefined) out[key] = copy(key, v);
  }
  return out;
}

/**
 * A field's value, copied: a list as a new list (a gap in it reads as a
 * missing value, which fails its check), a filter from its own known fields.
 * Anything else is kept as it is, and its kind's check refuses what is not a
 * plain value, so a valid part holds no object but its filter.
 */
function copyValue(key: string, v: unknown): unknown {
  if (Array.isArray(v)) return Array.from(v);
  if (key !== 'on' || !isObj(v)) return v;
  return knownFields(v, FILTER_FIELDS, (_, x) => (Array.isArray(x) ? Array.from(x) : x));
}

function readPart(raw: unknown): EffectPart | undefined {
  if (!isObj(raw)) return undefined;
  const kind = own(raw, 'kind');
  const known = typeof kind === 'string' ? KNOWN.get(kind) : undefined;
  if (known === undefined) return undefined;
  const part = knownFields(raw, known, copyValue);
  if (!optStr(part.same) || !VALID[kind as ActivePartKind](part)) return undefined;
  return part as EffectPart;
}

function readDuration(raw: unknown): EffectDuration | undefined {
  if (!isObj(raw)) return undefined;
  const out: EffectDuration = {};
  const minutes = own(raw, 'minutes');
  if (isNum(minutes) && minutes >= 0) out.minutes = minutes;
  const rest = own(raw, 'rest');
  if (rest === 'short' || rest === 'long') out.rest = rest;
  const concentration = own(raw, 'concentration');
  if (typeof concentration === 'boolean') out.concentration = concentration;
  const endsWhen = own(raw, 'endsWhen');
  if (endsWhen === 'unconscious' || endsWhen === 'incapacitated') out.endsWhen = endsWhen;
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
  for (const item of Array.from(raw as unknown[])) {
    const id = isObj(item) ? own(item, 'id') : undefined;
    const name = isObj(item) ? own(item, 'name') : undefined;
    const stored = isObj(item) ? own(item, 'parts') : undefined;
    if (!isObj(item) || !isStr(id) || !isStr(name) || !Array.isArray(stored)) {
      problems.push('An effect in play could not be read, so it does not count.');
      continue;
    }
    if (ids.has(id)) {
      problems.push(`${name}: it is in play twice under one id, so the second does not count.`);
      continue;
    }
    ids.add(id);
    const parts: EffectPart[] = [];
    // Array.from, so a gap in the list reads as a part that is not there.
    const all = Array.from(stored as unknown[]);
    for (const p of all) {
      const part = readPart(p);
      if (part !== undefined) parts.push(part);
    }
    const skipped = all.length - parts.length;
    if (skipped > 0) {
      problems.push(
        `${name}: ${skipped === 1 ? 'one part' : `${skipped} parts`} of it this version of the app cannot read, so ${skipped === 1 ? 'that part does' : 'those do'} not count.`,
      );
    }
    const effect: ActiveEffect = { id, name, parts };
    const same = own(item, 'same');
    if (isStr(same)) effect.same = same;
    const lasts = readDuration(own(item, 'lasts'));
    if (lasts !== undefined) effect.lasts = lasts;
    const turnsLeft = own(item, 'turnsLeft');
    if (Number.isInteger(turnsLeft) && (turnsLeft as number) >= 0)
      effect.turnsLeft = turnsLeft as number;
    if (own(item, 'mine') === true) effect.mine = true;
    if (own(item, 'off') === true) effect.off = true;
    effects.push(effect);
  }
  return { effects, problems };
}

/** A stored effect that an effect in play cannot hold, and why. */
export interface StoredProblem {
  /** Its place in the stored list, from 1; none when the whole list is at fault. */
  place?: number;
  why: string;
  /** The stored reader refused it, as it would for any entry (not only for an effect in play). */
  unreadable?: true;
}

/** A stored reader's problem without its "effect 3 (kind): " lead. */
const whyOf = (problem: string) => problem.replace(/^effect \d+( \([^)]*\))?: /, '');

/**
 * An entry's stored effects (`castGuidance`, read by the reader every stored
 * effect goes through) as the parts an effect in play holds: numbers and
 * rolls, in plain amounts, holding for as long as the effect does. `holder`
 * names what holds them in the words a problem uses ("a condition"), and
 * `refuse` says why it cannot hold a part it otherwise would. Each one that
 * cannot count is a problem by its place in the list, so an editor can put it
 * on its card; nothing here throws.
 */
export function storedInPlay(
  raw: unknown,
  holder = 'an effect in play',
  refuse?: (part: EffectPart) => string | undefined,
): { parts: EffectPart[]; problems: StoredProblem[] } {
  const parts: EffectPart[] = [];
  const problems: StoredProblem[] = [];
  // The list as a whole (not a list, too long) is said once, with no place.
  for (const p of readStoredEffects(raw).problems) {
    if (!/^effect \d+/.test(p)) problems.push({ why: p });
  }
  if (!Array.isArray(raw)) return { parts, problems };
  Array.from(raw as unknown[])
    .slice(0, CAST_GUIDANCE_LIMITS.effectsPerEntry)
    .forEach((x, i) => {
      const place = i + 1;
      const one = readStoredEffects([x]);
      const t = one.effects[0];
      if (t === undefined) {
        problems.push({
          place,
          why: whyOf(one.problems[0] ?? 'it could not be read'),
          unreadable: true,
        });
        return;
      }
      const why =
        t.while !== undefined
          ? `${holder} does what it does for as long as it lasts, with no "When" of its own`
          : !ACTIVE_PART_KINDS.includes(t.effect.kind as never)
            ? `${holder} changes only numbers and rolls, not proficiencies, uses or actions`
            : t.formulas !== undefined
              ? `${holder} takes a plain number, not a formula`
              : undefined;
      const [held] =
        why === undefined
          ? readActiveEffects([{ id: 'part', name: 'part', parts: [t.effect] }]).effects
          : [];
      const part = held?.parts.length === 1 ? held.parts[0] : undefined;
      if (part === undefined) {
        problems.push({ place, why: why ?? `${holder} cannot hold it as written` });
        return;
      }
      const refused = refuse?.(part);
      if (refused !== undefined) {
        problems.push({ place, why: refused });
        return;
      }
      parts.push(part);
    });
  return { parts, problems };
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

/**
 * How deep `canonical` looks. A part read by `readActiveEffects` is two levels
 * deep at most (a filter's list); one built some other way and nested deeper
 * compares only down to here, rather than running out of stack.
 */
const SHAPE_DEPTH = 8;

/** Keys in order at every depth, so a filter written in another order is the same filter. */
function canonical(x: unknown, depth = 0): unknown {
  if (depth > SHAPE_DEPTH) return '...';
  if (Array.isArray(x)) return x.map((v) => canonical(v, depth + 1));
  if (!isObj(x)) return x;
  return Object.fromEntries(
    Object.keys(x)
      .sort()
      .map((k) => [k, canonical(x[k], depth + 1)]),
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
