/**
 * One place decides an entry's mechanics (ADR-001, D2 and hook H1). Every
 * feature, feat, optional feature, species trait, class, subclass and item the
 * collectors meet comes through `mechanicsOf`, in this order:
 *
 * 1. a rule pack's patch for that entry, from packs applied to this character
 *    or to every character: `effects` replaces everything below, `add` adds to it;
 * 2. the entry's own `castGuidance.effects`, which add to what it inherits, less
 *    what its `drop` leaves out, or replace it when it says `replace`;
 * 3. what it inherits, which each call site knows: the curated row for its key
 *    or for the entry it copies (`basedOn`), else the prose scan, then its spend
 *    links; an item's magic fields.
 *
 * Data without `castGuidance`, and a character no pack applies to, reaches only
 * layer 3, exactly as the call sites did before this seam.
 *
 * `readMechanics` reads a stored `castGuidance` once per object it is given (the
 * registry's own, so once per registry build) into effect templates, checking
 * each field and never spreading the raw object. A bad value is a problem shown
 * as a sheet warning, and that effect does not count; nothing here throws.
 */
import {
  clip,
  EARLY_KINDS,
  formulaNamesFor,
  guidanceVersion,
  isRecord,
  CAST_GUIDANCE_LIMITS as L,
  own,
  RULE_PACK_TYPE,
} from '../castGuidance';
import { type Formula, readAmount } from '../formula';
import {
  ACTIVE_PART_KINDS,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EntityRef,
  type FormulaField,
  refUid,
  SKILLS,
  type WhileState,
} from '../types';
import type { Collector } from './base';
import { printingOf } from './reskin';

type Kind = EffectInput['kind'];

/** One stored effect, read: the engine's fields, its formulas and its states. */
export interface EffectTemplate {
  /** The effect without `origin`, which the collector adds. */
  effect: Readonly<Record<string, unknown>> & { kind: Kind };
  formulas?: ReadonlyArray<{ field: FormulaField; formula: Formula }>;
  while?: readonly WhileState[];
}

/** An inherited effect an entry leaves out: of this kind, and this label when given. */
export interface DropRule {
  kind: Kind;
  label?: string;
}

/** An entry's own `castGuidance`, read. */
export interface ReadMechanics {
  /** False when it cannot be read at all (no version, a newer one): none of it counts. */
  readable: boolean;
  effects: readonly EffectTemplate[];
  drop: readonly DropRule[];
  /** "Start from nothing": it inherits no curated row, prose scan or spend link. */
  replace: boolean;
  /** The official entry it copies, whose curated row and spend links it inherits. */
  basedOn?: EntityRef;
  /** What does not count and why, worded for the player. */
  problems: readonly string[];
}

// ---------------------------------------------------------------------------
// Reading stored effects
// ---------------------------------------------------------------------------

/** A value that keeps its effect from counting, and why. */
class Bad extends Error {}

interface Reading {
  kind: Kind;
  slots: Array<{ field: FormulaField; formula: Formula }>;
}

/** Reads one field's value, or throws `Bad` with what it should be. `undefined` leaves it out. */
type Field = (v: unknown, r: Reading, key: string) => unknown;
type Build = (o: Record<string, unknown>, r: Reading) => Record<string, unknown>;

function req(o: Record<string, unknown>, r: Reading, key: string, read: Field): unknown {
  const v = own(o, key);
  if (v === undefined) throw new Bad(`"${key}" is missing`);
  const out = field(v, r, key, read);
  if (out === undefined) throw new Bad(`"${key}" is missing`);
  return out;
}

function opt(
  o: Record<string, unknown>,
  r: Reading,
  key: string,
  read: Field,
): Record<string, unknown> {
  const v = own(o, key);
  if (v === undefined) return {};
  const out = field(v, r, key, read);
  return out === undefined ? {} : { [key]: out };
}

/** Read one value, naming its key (and a nested key under it) in what goes wrong. */
function field(v: unknown, r: Reading, key: string, read: Field): unknown {
  try {
    return read(v, r, key);
  } catch (err) {
    if (!(err instanceof Bad)) throw err;
    const nested = /^"([^"]*)" ([\s\S]*)$/.exec(err.message);
    throw new Bad(nested ? `"${key}.${nested[1]}" ${nested[2]}` : `"${key}" ${err.message}`);
  }
}

const text =
  (max: number = L.labelLength): Field =>
  (v) => {
    if (typeof v !== 'string' || v.trim() === '') throw new Bad('needs words');
    if (v.length > max) throw new Bad(`is at most ${max} characters`);
    return v.trim();
  };

const oneOf =
  (...values: ReadonlyArray<string | number | boolean>): Field =>
  (v) => {
    if (!values.includes(v as string)) throw new Bad(`is one of ${values.join(', ')}`);
    return v;
  };

const ABILITY_LIST = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ability = oneOf(...ABILITY_LIST);
/** True, or left out: a false flag is the same as none. */
const flag: Field = (v) => {
  if (typeof v !== 'boolean') throw new Bad('is true or false');
  return v ? true : undefined;
};

const int =
  (min: number, max: number): Field =>
  (v) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new Bad(`is a whole number from ${min} to ${max}`);
    }
    return v;
  };

const list =
  (read: Field, max: number): Field =>
  (v, r, key) => {
    if (!Array.isArray(v) || v.length === 0) throw new Bad('is a list');
    if (v.length > max) throw new Bad(`lists at most ${max}`);
    return [...new Set(v.map((x) => read(x, r, key)))];
  };

const DICE = /^\d{0,3}d\d{1,3}(\s*[+-]\s*(\d{0,3}d\d{1,3}|\d{1,4}))*$/;
const dice: Field = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > 40 || !DICE.test(s)) throw new Bad('is dice, like 1d6 or 2d8 + 2');
  return s;
};

/** A number that may be a formula or a level table, filled at fold time. */
const amount: Field = (v, r, key) => {
  const { names, why } = formulaNamesFor(r.kind);
  const read = readAmount(v, names, why);
  if ('problem' in read) throw new Bad(read.problem);
  if ('value' in read) {
    // As a formula's result is: rounded down, and only an amount below 0.
    if (!Number.isInteger(read.value)) throw new Bad('is a whole number');
    if (key !== 'amount' && read.value < 0) throw new Bad('is 0 or more');
    return read.value;
  }
  r.slots.push({ field: key as FormulaField, formula: read.formula });
  return 0;
};

/** A skill, spelled as the sheet spells it when it is one of the 18; a homebrew one as written. */
const skill: Field = (v, r, k) => {
  const name = text()(v, r, k) as string;
  return SKILLS.find((s) => s.name.toLowerCase() === name.toLowerCase())?.name ?? name;
};

const spellRef: Field = (v) => {
  const ref = typeof v === 'string' ? readRef(v) : undefined;
  if (ref === undefined) throw new Bad('is "name|source"');
  return ref;
};

/** A nested object, by its known keys only. `true` marks a key it needs. */
const record =
  (spec: Record<string, readonly [Field, boolean?]>): Field =>
  (v, r) => {
    if (!isRecord(v)) throw new Bad('is not an object');
    let out: Record<string, unknown> = {};
    for (const [key, [read, need]] of Object.entries(spec)) {
      out = { ...out, ...(need === true ? { [key]: req(v, r, key, read) } : opt(v, r, key, read)) };
    }
    return out;
  };

const rollFilter = record({
  rolls: [list(oneOf('attack', 'save', 'check'), 3), true],
  abilities: [list(ability, 6)],
  skills: [list(skill, 18)],
  skilled: [flag],
  attack: [oneOf('weapon', 'spell')],
  range: [oneOf('melee', 'ranged')],
  className: [text()],
});

const scope = (o: Record<string, unknown>, r: Reading) =>
  own(o, 'scope') === undefined
    ? { scope: 'all' }
    : { scope: req(o, r, 'scope', oneOf('melee', 'ranged', 'all')) };

const named: Build = (o, r) => ({ name: req(o, r, 'name', text()) });
const amountOnly: Build = (o, r) => ({ amount: req(o, r, 'amount', amount) });
const defense: Build = (o, r) => ({
  damageType: req(o, r, 'damageType', text()),
  ...opt(o, r, 'note', text(L.textLength)),
});

const checkBonus: Build = (o, r) => {
  const amountOut = req(o, r, 'amount', amount);
  const picked = [
    opt(o, r, 'skills', list(skill, 18)),
    opt(o, r, 'ability', ability),
    opt(o, r, 'every', oneOf(true)),
  ].filter((x) => Object.keys(x).length > 0);
  if (picked.length !== 1) throw new Bad('names one of "skills", "ability" or "every"');
  return { amount: amountOut, ...picked[0] };
};

const action: Build = (o, r) => ({
  economy: req(o, r, 'economy', oneOf('action', 'bonus', 'reaction', 'none')),
  label: req(o, r, 'label', text()),
  ...opt(o, r, 'roll', dice),
  ...opt(o, r, 'heals', flag),
  ...opt(o, r, 'plainDice', flag),
  ...opt(o, r, 'note', text(L.textLength)),
  ...opt(
    o,
    r,
    'save',
    record({ targetAbility: [ability, true], dcAbility: [oneOf(...ABILITY_LIST, 'spell')] }),
  ),
  ...opt(
    o,
    r,
    'cost',
    record({
      resource: [text(), true],
      amount: [(v, rr, k) => (v === 'varies' ? v : int(0, 999)(v, rr, k)), true],
      optional: [flag],
      ownUseToo: [flag],
    }),
  ),
  ...opt(o, r, 'regains', record({ resource: [text(), true], amount: [int(0, 999), true] })),
  ...opt(o, r, 'spendsNoUse', flag),
});

/**
 * Version 1's kinds: the engine's `EffectInput` kinds, each field read on its
 * own. The one kind left out, `weaponProfFilter`, takes the data's internal
 * filter syntax, which a homebrew file has no reason to write.
 */
const KINDS = new Map<Kind, Build>([
  [
    'abilityMin',
    (o, r) => ({ ability: req(o, r, 'ability', ability), min: req(o, r, 'min', amount) }),
  ],
  [
    'abilityBonus',
    (o, r) => ({
      ability: req(o, r, 'ability', ability),
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'max', int(1, 30)),
    }),
  ],
  [
    'skillProf',
    (o, r) => ({
      skill: req(o, r, 'skill', skill),
      level: own(o, 'level') === undefined ? 1 : req(o, r, 'level', oneOf(1, 2)),
    }),
  ],
  ['saveProf', (o, r) => ({ ability: req(o, r, 'ability', ability) })],
  ['toolProf', named],
  ['armorProf', named],
  ['weaponProf', named],
  ['language', named],
  [
    'acFormula',
    (o, r) => ({
      label: req(o, r, 'label', text()),
      base: req(o, r, 'base', amount),
      addAbilities:
        own(o, 'addAbilities') === undefined ? [] : req(o, r, 'addAbilities', list(ability, 6)),
      ...opt(o, r, 'dexMax', int(0, 20)),
    }),
  ],
  ['acBonus', amountOnly],
  ['acMin', (o, r) => ({ min: req(o, r, 'min', amount) })],
  ['hpPerLevel', amountOnly],
  ['maxHpBonus', amountOnly],
  ['initiativeBonus', amountOnly],
  [
    'speedBonus',
    (o, r) => ({
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'unless', oneOf('heavyArmor', 'armorOrShield')),
    }),
  ],
  [
    'speedMultiplier',
    (o, r) => ({
      factor: req(o, r, 'factor', (v) => {
        if (typeof v !== 'number' || !(v > 0 && v <= 10))
          throw new Bad('is a number above 0, at most 10');
        return v;
      }),
    }),
  ],
  [
    'moveSpeed',
    (o, r) => ({
      mode: req(o, r, 'mode', oneOf('fly', 'climb', 'swim')),
      speed: req(o, r, 'speed', (v, rr, k) => (v === 'walk' ? v : amount(v, rr, k))),
    }),
  ],
  [
    'attackBonus',
    (o, r) => ({
      ...scope(o, r),
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'attack', oneOf('weapon', 'spell', 'any')),
      ...opt(o, r, 'ability', ability),
    }),
  ],
  [
    'damageBonus',
    (o, r) => ({
      ...scope(o, r),
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'ability', ability),
    }),
  ],
  [
    'damageDie',
    (o, r) => ({
      ...scope(o, r),
      dice: req(o, r, 'dice', dice),
      ...opt(o, r, 'damageType', text()),
    }),
  ],
  [
    'spellDcBonus',
    (o, r) => ({ amount: req(o, r, 'amount', amount), ...opt(o, r, 'className', text()) }),
  ],
  [
    'saveBonus',
    (o, r) => ({
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'abilities', list(ability, 6)),
    }),
  ],
  [
    'halfProf',
    (o, r) => ({
      round: own(o, 'round') === undefined ? 'down' : req(o, r, 'round', oneOf('down', 'up')),
      ...opt(o, r, 'abilities', list(ability, 6)),
      ...opt(o, r, 'skillsOnly', flag),
    }),
  ],
  ['checkBonus', checkBonus],
  ['passivePerceptionBonus', amountOnly],
  ['sense', (o, r) => ({ sense: req(o, r, 'sense', text()), range: req(o, r, 'range', amount) })],
  ['resist', defense],
  ['immune', defense],
  ['vulnerable', (o, r) => ({ damageType: req(o, r, 'damageType', text()) })],
  [
    'conditionImmune',
    (o, r) => ({
      condition: req(o, r, 'condition', text()),
      ...opt(o, r, 'note', text(L.textLength)),
    }),
  ],
  ['rollDie', (o, r) => ({ dice: req(o, r, 'dice', dice), on: req(o, r, 'on', rollFilter) })],
  [
    'rollOffer',
    (o, r) => ({
      dice: req(o, r, 'dice', dice),
      on: req(o, r, 'on', rollFilter),
      ...opt(o, r, 'once', flag),
      ...opt(o, r, 'ifFailed', flag),
    }),
  ],
  [
    'rollAdvantage',
    (o, r) => ({ mode: req(o, r, 'mode', oneOf('adv', 'dis')), on: req(o, r, 'on', rollFilter) }),
  ],
  ['tempHpEachTurn', amountOnly],
  [
    'extraAction',
    (o, r) => ({ label: req(o, r, 'label', text()), ...opt(o, r, 'note', text(L.textLength)) }),
  ],
  ['critRange', (o, r) => ({ min: req(o, r, 'min', amount) })],
  [
    'cue',
    (o, r) => ({
      tone:
        own(o, 'tone') === undefined
          ? 'info'
          : req(o, r, 'tone', oneOf('help', 'ward', 'warn', 'info')),
      text: req(o, r, 'text', text(L.textLength)),
    }),
  ],
  [
    'resource',
    (o, r) => ({
      key: req(o, r, 'key', text()),
      label: req(o, r, 'label', text()),
      max: req(o, r, 'max', amount),
      ...opt(o, r, 'min', amount),
      resetOn: req(o, r, 'reset', oneOf('short', 'long')),
      ...opt(o, r, 'stack', flag),
      ...opt(o, r, 'regainOnShort', amount),
    }),
  ],
  [
    'resourceRegain',
    (o, r) => ({ key: req(o, r, 'key', text()), amount: req(o, r, 'amount', amount) }),
  ],
  ['action', action],
  [
    'naturalWeapon',
    (o, r) => ({
      label: req(o, r, 'label', text()),
      dice: req(o, r, 'dice', dice),
      damageType: req(o, r, 'damageType', text()),
      ability: own(o, 'ability') === undefined ? 'str' : req(o, r, 'ability', ability),
    }),
  ],
  [
    'unarmedDamage',
    (o, r) => ({ label: req(o, r, 'label', text()), dice: req(o, r, 'dice', dice) }),
  ],
  [
    'grantSpell',
    (o, r) => ({
      spell: req(o, r, 'spell', spellRef),
      ...opt(o, r, 'ability', ability),
      ...opt(o, r, 'usage', text()),
      ...opt(o, r, 'resourceKey', text()),
    }),
  ],
  ['note', (o, r) => ({ text: req(o, r, 'text', text(L.textLength)) })],
]);

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_PART_KINDS);
const PLAIN_STATES: ReadonlySet<string> = new Set([
  'bloodied',
  'zeroHp',
  'concentrating',
  'noArmor',
  'shield',
]);

function readState(s: unknown, kind: Kind): WhileState {
  if (typeof s === 'string' && PLAIN_STATES.has(s)) {
    if (s === 'bloodied' && EARLY_KINDS.has(kind)) {
      throw new Bad('bloodied cannot hold for a score or the hit point maximum');
    }
    return { state: s as 'bloodied' };
  }
  if (isRecord(s)) {
    const effect = own(s, 'effect');
    const condition = own(s, 'condition');
    const name = (v: unknown) => text()(v, { kind, slots: [] }, 'while') as string;
    if (effect !== undefined && condition === undefined)
      return { state: 'effect', name: name(effect) };
    if (condition !== undefined && effect === undefined) {
      return { state: 'condition', condition: name(condition) };
    }
  }
  throw new Bad(
    typeof s === 'string'
      ? `has no state "${clip(s)}"`
      : 'is a state word, { "effect": name } or { "condition": name }',
  );
}

const readWhile: Field = (raw, r) => {
  if (!ACTIVE.has(r.kind)) throw new Bad('holds only for an effect on numbers or rolls');
  const states = Array.isArray(raw) ? raw : [raw];
  if (states.length === 0 || states.length > L.statesPerEffect) {
    throw new Bad(`lists from 1 to ${L.statesPerEffect} states`);
  }
  return states.map((s) => readState(s, r.kind));
};

function readEffect(raw: unknown): EffectTemplate {
  if (!isRecord(raw)) throw new Bad('is not an effect');
  const kind = own(raw, 'kind');
  const build = typeof kind === 'string' ? KINDS.get(kind as Kind) : undefined;
  if (build === undefined) throw new Bad(`has no kind "${clip(kind)}"`);
  const r: Reading = { kind: kind as Kind, slots: [] };
  const effect = { kind: kind as Kind, ...build(raw, r) };
  const states = opt(raw, r, 'while', readWhile) as { while?: WhileState[] };
  return { effect, ...(r.slots.length > 0 ? { formulas: r.slots } : {}), ...states };
}

/**
 * A stored list of effects (an entry's, a patch's, a moment's), each read on its
 * own: a bad one is a problem and is left out, the rest count.
 */
export function readStoredEffects(
  raw: unknown,
  name = 'effects',
): { effects: EffectTemplate[]; problems: string[] } {
  const effects: EffectTemplate[] = [];
  const problems: string[] = [];
  if (raw === undefined) return { effects, problems };
  if (!Array.isArray(raw)) return { effects, problems: [`"${name}" is not a list`] };
  if (raw.length > L.effectsPerEntry) {
    problems.push(`only the first ${L.effectsPerEntry} of "${name}" count`);
  }
  raw.slice(0, L.effectsPerEntry).forEach((x, i) => {
    try {
      effects.push(readEffect(x));
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      const kind =
        isRecord(x) && typeof own(x, 'kind') === 'string' ? ` (${clip(own(x, 'kind'))})` : '';
      problems.push(`effect ${i + 1}${kind}: ${err.message}`);
    }
  });
  return { effects, problems };
}

function readRef(s: string): EntityRef | undefined {
  if (s.length > 2 * L.labelLength) return undefined;
  const [name, source, ...rest] = s.split('|').map((p) => p.trim());
  if (!name || !source || rest.length > 0) return undefined;
  return { name, source };
}

function readDrops(raw: unknown, problems: string[]): DropRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push('"drop" is not a list');
    return [];
  }
  const out: DropRule[] = [];
  raw.slice(0, L.dropsPerEntry).forEach((d, i) => {
    const kind = isRecord(d) ? own(d, 'kind') : undefined;
    const label = isRecord(d) ? own(d, 'label') : undefined;
    if (typeof kind !== 'string' || !KINDS.has(kind as Kind)) {
      problems.push(`drop ${i + 1}: has no kind "${clip(kind)}"`);
    } else if (label !== undefined && (typeof label !== 'string' || label.length > L.labelLength)) {
      problems.push(`drop ${i + 1}: "label" needs words`);
    } else {
      out.push({
        kind: kind as Kind,
        ...(typeof label === 'string' ? { label: label.trim() } : {}),
      });
    }
  });
  return out;
}

const UNREADABLE = (problem: string): ReadMechanics => ({
  readable: false,
  effects: [],
  drop: [],
  replace: false,
  problems: [problem],
});

/** Read once per stored object: the registry builds new objects when its files change. */
const READ = new WeakMap<object, ReadMechanics>();

/** An entry's stored `castGuidance`, read (`ReadMechanics`). Never throws. */
export function readMechanics(raw: unknown): ReadMechanics {
  if (!isRecord(raw)) return UNREADABLE('its mechanics are not readable');
  const cached = READ.get(raw);
  if (cached !== undefined) return cached;
  const version = guidanceVersion(raw);
  let read: ReadMechanics;
  if ('problem' in version) {
    read = UNREADABLE(version.problem);
  } else {
    const { effects, problems } = readStoredEffects(own(raw, 'effects'));
    const drop = readDrops(own(raw, 'drop'), problems);
    const replace = own(raw, 'replace');
    if (replace !== undefined && typeof replace !== 'boolean')
      problems.push('"replace" is true or false');
    const based = own(raw, 'basedOn');
    const basedOn = typeof based === 'string' ? readRef(based) : undefined;
    if (based !== undefined && basedOn === undefined) problems.push('"basedOn" is "name|source"');
    read = {
      readable: true,
      effects,
      drop,
      replace: replace === true,
      ...(basedOn !== undefined ? { basedOn } : {}),
      problems,
    };
  }
  READ.set(raw, read);
  return read;
}

/** The official entry an entry's `castGuidance` says it copies. */
export function basedOn(e: DataEntity | undefined): EntityRef | undefined {
  const raw = e === undefined ? undefined : own(e, 'castGuidance');
  return raw === undefined ? undefined : readMechanics(raw).basedOn;
}

/**
 * The official entry an entry stands for: the one its `castGuidance` copies,
 * else the one a converted file says it prints (`printingOf`).
 */
export function officialOf(e: DataEntity | undefined): EntityRef | undefined {
  return basedOn(e) ?? printingOf(e);
}

/**
 * The keys a table keyed by `name|source` holds an entry under: its own uid, then
 * the official entry's (`officialOf`), when that is another.
 */
export function entryKeys(e: DataEntity | undefined, uid: string): string[] {
  const official = officialOf(e);
  if (official === undefined) return [uid];
  const key = refUid(official);
  return key === uid ? [uid] : [uid, key];
}

// ---------------------------------------------------------------------------
// Rule packs
// ---------------------------------------------------------------------------

interface PackChange {
  pack: string;
  effects: readonly EffectTemplate[];
}

interface PackPatches {
  replace?: PackChange;
  add: PackChange[];
}

/** A pack's patches, read: each target lowercased, and what does not count. */
export interface ReadPack {
  name: string;
  patches: Array<{ target: string; replace?: EffectTemplate[]; add?: EffectTemplate[] }>;
  problems: string[];
}

const PACKS = new WeakMap<object, ReadPack>();

/** A rule pack's patches (`RULE_PACK_TYPE` entry), read once per entry. Never throws. */
export function readPack(entry: DataEntity): ReadPack {
  const cached = PACKS.get(entry);
  if (cached !== undefined) return cached;
  const read = readPackOnce(entry);
  PACKS.set(entry, read);
  return read;
}

function readPackOnce(entry: DataEntity): ReadPack {
  const named = own(entry, 'name');
  const name =
    typeof named === 'string' && named.trim() !== '' ? clip(named.trim()) : 'A rule pack';
  const read: ReadPack = { name, patches: [], problems: [] };
  const raw = own(entry, 'castGuidance');
  if (!isRecord(raw)) return read;
  const version = guidanceVersion(raw);
  if ('problem' in version) {
    read.problems.push(version.problem);
    return read;
  }
  const patches = own(raw, 'patches');
  if (patches === undefined) return read;
  if (!Array.isArray(patches)) {
    read.problems.push('"patches" is not a list');
    return read;
  }
  if (patches.length > L.patchesPerPack) {
    read.problems.push(`only the first ${L.patchesPerPack} patches count`);
  }
  patches.slice(0, L.patchesPerPack).forEach((p, i) => {
    const target = isRecord(p) ? own(p, 'target') : undefined;
    if (typeof target !== 'string' || target.trim() === '' || target.length > L.targetLength) {
      read.problems.push(`patch ${i + 1}: "target" is the key of the entry it changes`);
      return;
    }
    const where = `patch ${i + 1} (${clip(target)})`;
    const rawReplace = own(p as Record<string, unknown>, 'effects');
    const replace = readStoredEffects(rawReplace);
    const add = readStoredEffects(own(p as Record<string, unknown>, 'add'), 'add');
    for (const problem of [...replace.problems, ...add.problems])
      read.problems.push(`${where}: ${problem}`);
    // An empty list replaces the entry's mechanics with nothing, on purpose; a
    // list none of which can be read replaces nothing, so the entry keeps its own.
    const replaces =
      Array.isArray(rawReplace) && (rawReplace.length === 0 || replace.effects.length > 0);
    read.patches.push({
      target: target.trim().toLowerCase(),
      ...(replaces ? { replace: replace.effects } : {}),
      ...(add.effects.length > 0 ? { add: add.effects } : {}),
    });
  });
  return read;
}

/** Applied to this character, or to every character (`appliesTo.appDefault`). */
function appliesTo(entry: DataEntity, characterId: string): boolean {
  const to = own(entry, 'appliesTo');
  if (!isRecord(to)) return false;
  if (own(to, 'appDefault') === true) return true;
  const characters = own(to, 'characters');
  return Array.isArray(characters) && characters.includes(characterId);
}

/** This derive's patches by target, from the packs that reach its character, in the player's order. */
const PATCHES = new WeakMap<Collector, Map<string, PackPatches>>();

function patchesFor(col: Collector): Map<string, PackPatches> {
  const known = PATCHES.get(col);
  if (known !== undefined) return known;
  const index = new Map<string, PackPatches>();
  PATCHES.set(col, index);
  for (const entry of col.ctx.byType(RULE_PACK_TYPE)) {
    if (!appliesTo(entry, col.doc.id)) continue;
    const pack = readPack(entry);
    for (const problem of pack.problems) col.warn(`${pack.name}: ${problem}`);
    for (const patch of pack.patches) {
      const slot = index.get(patch.target) ?? { add: [] };
      index.set(patch.target, slot);
      // A later pack's replacement wins over an earlier one's.
      if (patch.replace !== undefined) slot.replace = { pack: pack.name, effects: patch.replace };
      if (patch.add !== undefined) slot.add.push({ pack: pack.name, effects: patch.add });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export interface MechanicsSubject {
  /** The entry whose `castGuidance` is read: a feature, a feat, an option, a trait, a class, an item. */
  entry: DataEntity;
  /** Its name on the sheet, for problems. */
  label: string;
  /**
   * The origin its effects carry. What it inherits carries this object, which
   * spend links find its action by; its own effects and a pack's carry copies,
   * so a spend link never rewrites the cost an author gave an action.
   */
  origin: EffectOrigin;
  /** The key a pack's patch names it by (`StoredPatch.target`). */
  target: string;
  /** What `classLevel` and level tables read in its formulas; the character's level when absent. */
  classLevel?: number;
  /** Layer 3: what it inherits, which the call site knows how to collect. */
  inherited?: () => void;
}

const labelOf = (e: EffectInput): string | undefined =>
  'label' in e && typeof e.label === 'string' ? e.label.toLowerCase() : undefined;

function emit(
  col: Collector,
  templates: readonly EffectTemplate[],
  origin: EffectOrigin,
  classLevel: number,
): void {
  for (const t of templates) {
    // A fresh copy each time: fold time fills its numbers in place.
    const e = { ...structuredClone(t.effect), origin } as EffectInput;
    if (t.formulas !== undefined) {
      e.formulas = t.formulas.map((f) => ({ field: f.field, formula: f.formula, classLevel }));
    }
    if (t.while !== undefined) e.while = t.while;
    col.add(e);
  }
}

/** Each derive's entries whose `castGuidance` holds moments, once each, first visit kept. */
const WITH_MOMENTS = new WeakMap<Collector, Map<DataEntity, MechanicsSubject>>();

/**
 * The entries this derive met whose own `castGuidance` holds moments (H9), for
 * `moments.ts` to read. A pack's patch changes an entry's effects, never its
 * moments, so these count whatever a pack does.
 */
export function subjectsWithMoments(col: Collector): MechanicsSubject[] {
  return [...(WITH_MOMENTS.get(col)?.values() ?? [])];
}

/** Collect one entry's mechanics, layer by layer (see the top of this file). */
export function mechanicsOf(col: Collector, s: MechanicsSubject): void {
  const raw = own(s.entry, 'castGuidance');
  if (isRecord(raw) && own(raw, 'moments') !== undefined) {
    const met = WITH_MOMENTS.get(col) ?? new Map<DataEntity, MechanicsSubject>();
    WITH_MOMENTS.set(col, met);
    if (!met.has(s.entry)) met.set(s.entry, s);
  }
  const mine = raw === undefined ? undefined : readMechanics(raw);
  for (const problem of mine?.problems ?? []) col.warn(`${s.label}: ${problem}`);
  const patches = patchesFor(col).get(s.target.toLowerCase());
  const level = s.classLevel ?? col.doc.classes.reduce((sum, c) => sum + c.levels, 0);

  if (patches?.replace !== undefined) {
    emit(col, patches.replace.effects, { ...s.origin, pack: patches.replace.pack }, level);
  }
  for (const add of patches?.add ?? [])
    emit(col, add.effects, { ...s.origin, pack: add.pack }, level);
  if (patches?.replace !== undefined) return;

  const self = mine?.readable === true ? mine : undefined;
  if (self !== undefined) emit(col, self.effects, { ...s.origin }, level);
  if (self?.replace === true) return;
  const from = col.effects.length;
  s.inherited?.();
  if (self === undefined || self.drop.length === 0) return;
  for (let i = col.effects.length - 1; i >= from; i--) {
    const e = col.effects[i] as EffectInput;
    const label = labelOf(e);
    const dropped = self.drop.some(
      (d) => d.kind === e.kind && (d.label === undefined || d.label.toLowerCase() === label),
    );
    if (dropped) col.effects.splice(i, 1);
  }
}
