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
 *    links; an item's magic fields. A built-in rule set's row (`RULE_SET_TYPE`)
 *    under the subject's `ruleKeys` is its curated row.
 *
 * Last, what layer 3 gave takes the player's prices (`amend`): the entry's own,
 * then each pack patch's, on inherited actions only, so never on an action the
 * entry's author or a pack wrote.
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
  type AmendedAmount,
  clip,
  EARLY_KINDS,
  EFFECT_EDITIONS,
  formulaNamesFor,
  guidanceVersion,
  isRecord,
  CAST_GUIDANCE_LIMITS as L,
  own,
  RULE_PACK_TYPE,
  RULE_SET_EDITIONS,
  RULE_SET_LIMITS,
  RULE_SET_PARTS,
  RULE_SET_SCANS,
  RULE_SET_TYPE,
  type StoredItemSpellLists,
  WORN_TAG_KINDS,
} from '../castGuidance';
import { type Formula, readAmount } from '../formula';
import { SPELL_SCHOOLS } from '../spellQuery';
import {
  type Ability,
  ACTIVE_PART_KINDS,
  type ActionBuyBack,
  type ActionCost,
  type ActionEconomy,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EntityRef,
  type FormulaField,
  HIT_DIE_COST,
  refUid,
  SKILLS,
  SLOT_COST,
  type WhileState,
} from '../types';
import { countedSpells } from './additionalSpells';
import type { Collector } from './base';
import {
  askPick,
  CODE_PICK_IDS,
  DAMAGE_TYPES,
  IN_PLACE_ASKS,
  PICK_ASKS,
  type PickAsk,
  type PickCount,
  type PickFill,
  type PickGives,
  type PickOption,
  type PickRule,
} from './picks';
import { printingOf, reskinOf } from './reskin';

type Kind = EffectInput['kind'];
/** A stored effect's kind: the engine's, or a pick (`picks.ts`), which asks before it gives. */
type StoredKind = Kind | 'pick';

/**
 * Words a stored effect gives by class level (`byLevelWords`): the effect's
 * `field`, as the rows say at the highest level reached, filled when the effect
 * is emitted. Below the first row's level a field the kind needs keeps the
 * first row's words and any other is left out.
 */
export interface LevelWords {
  field: string;
  rows: ReadonlyArray<readonly [number, string]>;
  needed?: true;
}

/**
 * Words a stored effect gives by another answer of its entry (`byAnswer`: the
 * first answer saved for one of its picks) or by which of some spells the entry
 * granted so far (`byGrant`): the effect's `field`, filled when it is emitted.
 * With none of the table's, a field the kind needs leaves the effect out, and
 * any other is left out.
 */
export interface AnswerWords {
  field: string;
  /** The pick's prompt id after the origin; absent, by the spell granted. */
  of?: string;
  /** Each answer, or spell name, trimmed and lowercase, with its words. */
  values: ReadonlyArray<readonly [string, string]>;
  needed?: true;
}

/** One stored effect, read: the engine's fields, its formulas and its states. */
export interface EffectTemplate {
  /** The effect without `origin`, which the collector adds. A pick's is its kind, id and ask. */
  effect: Readonly<Record<string, unknown>> & { kind: StoredKind };
  /** A pick, read: asked where the effect would be added, its answers' effects added then. */
  pick?: PickRule<EffectTemplate>;
  formulas?: ReadonlyArray<{ field: FormulaField; formula: Formula }>;
  /** Its words by class level; the effect holds the first row's until it is emitted. */
  byLevel?: readonly LevelWords[];
  /** Its words by an answer or a spell granted; the effect holds the first row's until then. */
  byAnswer?: readonly AnswerWords[];
  while?: readonly WhileState[];
  /** The rules version it counts under alone; `emit` leaves it out under the other. */
  edition?: (typeof EFFECT_EDITIONS)[number];
}

/** `t`'s words by level filled in on `e`, a fresh copy of its effect, at `classLevel`. */
function fillLevelWords(e: Record<string, unknown>, t: EffectTemplate, classLevel: number): void {
  for (const { field, rows, needed } of t.byLevel ?? []) {
    let at: string | undefined;
    for (const [level, words] of rows) if (level <= classLevel) at = words;
    if (at !== undefined) e[field] = at;
    else if (needed !== true) delete e[field];
  }
}

/**
 * `t`'s words by an answer or a spell granted filled in on `e`, a fresh copy of
 * its effect. False when a field the kind needs has none of its table's, so the
 * effect is not given.
 */
function fillAnswerWords(
  col: Collector,
  e: Record<string, unknown>,
  t: EffectTemplate,
  origin: EffectOrigin,
  pickBase: string | undefined,
): boolean {
  for (const { field, of, values, needed } of t.byAnswer ?? []) {
    const key =
      of === undefined ? grantedOf(col, origin, values) : answerTo(col, of, origin, pickBase);
    const words = key === undefined ? undefined : values.find(([k]) => k === key)?.[1];
    if (words !== undefined) e[field] = words;
    else if (needed === true) return false;
    else delete e[field];
  }
  return true;
}

/** The first answer saved for the entry's pick `of`, filed as `askPick` files it, trimmed and lowercase. */
function answerTo(
  col: Collector,
  of: string,
  origin: EffectOrigin,
  pickBase: string | undefined,
): string | undefined {
  const base =
    pickBase !== undefined && of.startsWith('pick-') ? pickBase : `${origin.type}:${origin.uid}`;
  // Functions, so a `$` in a name is the name's, not a replacement pattern.
  const id = `${base}:${of.replace('{feature}', () => origin.label.toLowerCase())}`;
  const picked = col.doc.choices[id];
  const first = Array.isArray(picked) ? picked[0] : undefined;
  return first === undefined ? undefined : String(first).trim().toLowerCase();
}

/** Of the spells `values` names, the first the entry granted so far, lowercase. */
function grantedOf(
  col: Collector,
  origin: EffectOrigin,
  values: AnswerWords['values'],
): string | undefined {
  for (const x of col.effects) {
    if (x.kind !== 'grantSpell' || x.origin.uid !== origin.uid) continue;
    const name = x.spell.name.toLowerCase();
    if (values.some(([k]) => k === name)) return name;
  }
  return undefined;
}

/**
 * The template with its AC formula named `name` when it has no label of its
 * own: what gives it, so a renamed copy shows its own name.
 */
export function namedFor(t: EffectTemplate, name: string): EffectTemplate {
  return t.effect.kind === 'acFormula' && t.effect.label === undefined
    ? { ...t, effect: { ...t.effect, label: name } }
    : t;
}

/** The class that gives an entry (`MechanicsSubject.className`), as `"ownClass": true` reads it. */
interface OwnClass {
  /** Its name, as the character's document has it. */
  name: string;
  /** Its spellcasting ability, which a spell grant of its own is cast with. */
  ability?: string;
  /** The spells its own data counts casts of, by lowercase name (`countedSpells`). */
  counted: ReadonlySet<string>;
}

const ownGrant = (t: EffectTemplate): boolean =>
  t.effect.kind === 'grantSpell' && t.effect.ownClass === true;

/**
 * The class named `className` as `"ownClass"` reads it, or undefined when no
 * class gives the entry. Its data is looked up only for a spell grant of its
 * own, the one reading that needs it.
 */
function ownClassOf(
  col: Collector,
  templates: readonly EffectTemplate[],
  className: string | undefined,
): OwnClass | undefined {
  if (className === undefined) return undefined;
  if (!templates.some(ownGrant)) return { name: className, counted: new Set() };
  const entry = col.doc.classes.find((c) => c.ref.name === className);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  const ability = String(cls?.spellcastingAbility);
  return {
    name: className,
    ...((ABILITY_LIST as readonly string[]).includes(ability) ? { ability } : {}),
    counted: countedSpells(cls?.additionalSpells),
  };
}

/** Whether `v`, an effect or any value inside it, is `key` (a pool it names). */
const namesKey = (v: unknown, key: string): boolean =>
  v === key || (isRecord(v) && Object.values(v).some((x) => namesKey(x, key)));

/**
 * The spell grants of their class's own (`"ownClass"`) whose class's data
 * counts casts of their spell at any level (a Death Knight's Rune Strike), with
 * the pools they spend from the same list that nothing kept there names: that
 * class's own row gives those casts, so these are left out.
 */
function countedByClass(
  templates: readonly EffectTemplate[],
  cls: OwnClass | undefined,
): ReadonlySet<EffectTemplate> {
  const out = new Set<EffectTemplate>();
  if (cls === undefined || cls.counted.size === 0) return out;
  const pools = new Set<string>();
  for (const t of templates) {
    const spell = t.effect.spell as EntityRef | undefined;
    if (!ownGrant(t) || spell === undefined || !cls.counted.has(spell.name.toLowerCase())) continue;
    out.add(t);
    if (typeof t.effect.resourceKey === 'string') pools.add(t.effect.resourceKey);
  }
  for (const t of templates) {
    const key = String(t.effect.key);
    if (t.effect.kind !== 'resource' || !pools.has(key)) continue;
    // Another action or grant may spend it too: then it stays, for that one.
    if (!templates.some((o) => o !== t && !out.has(o) && namesKey(o.effect, key))) out.add(t);
  }
  return out;
}

/**
 * The template with `"ownClass": true` read as `cls`, the class that gives it
 * (`MechanicsSubject.className`). A spell grant is cast with that class's
 * spellcasting ability, or with none when no class gives it (a feat's) or the
 * class casts no spells. A pool is named for it once its words by level are in
 * (`classNamed`), and so is an action. Any other kind takes its `className`, so a
 * reskin's spells (a Mage's) are its own; with no class giving it, it holds for
 * the spells of no class, so it is left out (undefined).
 */
export function forClass(t: EffectTemplate, cls: OwnClass | undefined): EffectTemplate | undefined {
  if (t.effect.ownClass !== true && t.effect.ownClassBeside === undefined) return t;
  const effect: Record<string, unknown> = { ...t.effect };
  delete effect.ownClass;
  delete effect.ownClassBeside;
  if (t.effect.kind === 'grantSpell') {
    if (cls?.ability !== undefined) effect.ability = cls.ability;
  } else if (!CLASS_NAMED.has(t.effect.kind)) {
    if (cls === undefined) return undefined;
    effect.className = cls.name;
  }
  return { ...t, effect: effect as EffectTemplate['effect'] };
}

/** The kinds whose name may say the class that gives them (`classNaming`). */
const CLASS_NAMED: ReadonlySet<string> = new Set(['resource', 'action']);

/**
 * Whether the character has a class besides `giver` (the one that gives the
 * feature) named one of `names`, or reskinning or copying one, as a curated row
 * finds a class by name: a Death Knight stands beside a Cleric as a Paladin.
 */
function besideClass(col: Collector, giver: string, names: readonly string[]): boolean {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return col.doc.classes.some((c) => {
    if (c.ref.name === giver) return false;
    const data = col.ctx.get('class', c.ref.name, c.ref.source);
    return [c.ref, reskinOf(data), basedOn(data)].some(
      (ref) => ref !== undefined && wanted.has(ref.name.toLowerCase()),
    );
  });
}

/**
 * `e`, a fresh copy of `t`'s pool or action with its words by level in, named
 * for `cls`, the class that gives it: always when it says `"ownClass": true`
 * ("Channel Divinity (Death Knight)"), or when the character has another class
 * it names in `"ownClassBeside"` ("Channel Divinity: Harness Divine Power
 * (Cleric)" beside a Paladin), so two classes' features of one name show apart.
 * A pool and the action sharing its name say it alike, so the action still
 * spends a use of the pool. With no class giving it, its own name alone.
 */
function classNamed(
  col: Collector,
  e: Record<string, unknown>,
  t: EffectTemplate,
  cls: OwnClass | undefined,
) {
  if (cls === undefined || !CLASS_NAMED.has(t.effect.kind)) return;
  const beside = t.effect.ownClassBeside as readonly string[] | undefined;
  if (t.effect.ownClass === true || (beside !== undefined && besideClass(col, cls.name, beside))) {
    e.label = `${String(e.label)} (${cls.name})`;
  }
}

/**
 * Why an effect in play cannot hold a stored effect: the proficiency bonus
 * counted once (`"profBonus": true`) is the character's own, and an amount in
 * play is a plain number, worked out on the sheet it came from; and it holds
 * under the rules it is put in play under, so it names no `edition` of its own.
 */
export const inPlayRefusal = (t: EffectTemplate, holder: string): string | undefined =>
  t.effect.kind === 'initiativeBonus' && t.effect.amount === 'profBonus'
    ? `${holder} takes a plain number, not "profBonus"`
    : t.edition !== undefined
      ? `${holder} holds under either rules version, with no "edition" of its own`
      : t.pick !== undefined
        ? `${holder} asks nothing: a pick is made as the character is built`
        : t.effect.kind === 'sense' && t.effect.orMore !== undefined
          ? `${holder} takes a plain range, with no "orMore"`
          : t.byAnswer !== undefined
            ? `${holder} takes words as written, not by an answer or a spell granted`
            : undefined;

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
  /** An item's `charges` effect (`ReadEffects.charges`), read apart from `effects`. */
  charges?: ItemCharges;
  drop: readonly DropRule[];
  /** Prices it puts on the actions it inherits, in order. */
  amend: readonly AmendRule[];
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
  /** The app's own rule sets: they may write what a player's file may not (`weaponProfFilter`). */
  builtIn?: true;
  slots: Array<{ field: FormulaField; formula: Formula }>;
  /** Words by class level, filled when the effect is emitted (`byLevelWords`). */
  words?: LevelWords[];
  /** Words by an answer or a spell granted, filled when the effect is emitted (`byAnswerWords`). */
  answers?: AnswerWords[];
  /**
   * A strict reading (a built-in rule set's): the keys read off each object, so
   * a field the reader does not know is a problem rather than dropped unseen.
   */
  seen?: Map<object, Set<string>>;
}

/** Reads one field's value, or throws `Bad` with what it should be. `undefined` leaves it out. */
type Field = (v: unknown, r: Reading, key: string) => unknown;
type Build = (o: Record<string, unknown>, r: Reading) => Record<string, unknown>;

/** Note that a strict reading read `key` off `o`, whether or not it is there. */
function mark(o: Record<string, unknown>, r: Reading, key: string): void {
  if (r.seen === undefined) return;
  const keys = r.seen.get(o) ?? new Set<string>();
  r.seen.set(o, keys);
  keys.add(key);
}

/** In a strict reading, throw for the first of `o`'s keys that is not among `known`. */
function onlyKnown(
  o: Record<string, unknown>,
  r: Reading,
  known: (key: string) => boolean,
  what: string,
): void {
  if (r.seen === undefined) return;
  const extra = Object.keys(o).find((k) => !known(k));
  if (extra !== undefined) throw new Bad(`"${clip(extra)}" is not a field ${what} reads`);
}

function req(o: Record<string, unknown>, r: Reading, key: string, read: Field): unknown {
  mark(o, r, key);
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
  mark(o, r, key);
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
/** True or false, each kept: where false says something of its own (a reaction never taken). */
const bool: Field = (v) => {
  if (typeof v !== 'boolean') throw new Bad('is true or false');
  return v;
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

/**
 * The data's weapon filter words, as attacks and the weapon options read them:
 * clauses `key=value;value` joined by `|` ("type=martial weapon|property=!heavy").
 */
/**
 * A weapon pick's base weapons: `type=` and the kinds it offers, any of them
 * (`weaponFilterOptions` reads that clause alone).
 */
const weaponTypes: Field = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const kind = '(simple|martial|melee|ranged) weapon';
  if (!new RegExp(`^type=${kind}(;${kind})*$`).test(s)) {
    throw new Bad(
      'is "type=" and simple, martial, melee or ranged weapon, like "type=melee weapon"',
    );
  }
  return s;
};

const weaponFilter: Field = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > 120 || !/^[a-z]+=[^|=]+(\|[a-z]+=[^|=]+)*$/i.test(s)) {
    throw new Bad('is filter words, like "type=martial weapon|property=light"');
  }
  return s;
};

/** One die, as a pool's die is: what one use rolls (a superiority die). */
const oneDie: Field = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^1d[1-9]\d{0,2}$/.test(s)) throw new Bad('is one die, like 1d6');
  return s;
};

/**
 * Words that may change with the class level: as written, or a level table of
 * them (`{ "byLevel": { "1": "1d8", "10": "1d10" } }`), each read by `read`.
 * The words at the highest level reached are filled in when the effect is
 * emitted, from the level its call site passes, as an amount's table is. Below
 * the first level the field is left out, so the table of a field the kind
 * needs (`needed`) starts at level 1. `as` names the effect's field where it
 * is not the stored one (`reset` is `resetOn`).
 */
const byLevelWords =
  (read: Field, how: { needed?: true; as?: string } = {}): Field =>
  (v, r, key) => {
    if (!isRecord(v)) return read(v, r, key);
    onlyKnown(v, r, (k) => k === 'byLevel', 'a level table');
    const table = own(v, 'byLevel');
    if (!isRecord(table)) throw new Bad('is words or a level table ({ "byLevel": ... })');
    const entries = Object.entries(table);
    if (entries.length === 0) throw new Bad('byLevel needs at least one level');
    if (entries.length > L.byLevelRows) {
      throw new Bad(`byLevel has at most ${L.byLevelRows} levels`);
    }
    const rows = entries
      .map(([level, words]): readonly [number, string] => {
        if (!/^\d{1,2}$/.test(level)) throw new Bad(`byLevel: "${clip(level)}" is not a level`);
        try {
          return [Number(level), read(words, r, key) as string];
        } catch (err) {
          if (err instanceof Bad) throw new Bad(`byLevel: level ${level} ${err.message}`);
          throw err;
        }
      })
      .sort((x, y) => x[0] - y[0]);
    const [first] = rows;
    if (first === undefined) throw new Bad('byLevel needs at least one level');
    if (how.needed === true && first[0] > 1) {
      throw new Bad('byLevel starts at level 1, since the effect needs it');
    }
    r.words = [
      ...(r.words ?? []),
      { field: how.as ?? key, rows, ...(how.needed === true ? { needed: true as const } : {}) },
    ];
    return first[1];
  };

/**
 * The prompts a built-in row may read beside its picks': the spell option an
 * entry's `additionalSpells` asks (`branch`), filed under the class's or
 * subclass's own id. A player's file reads only its own picks.
 */
const READ_ONLY_PICKS: ReadonlySet<string> = new Set(['branch']);

/**
 * Words chosen by another answer of the entry, or else read by `other`:
 * `{ "byAnswer": "<pick id>", "values": { "<answer>": "<words>" } }` by the first
 * answer saved for one of its picks (named by the pick's `id`), or
 * `{ "byGrant": { "<spell>": "<words>" } }` by the first of those spells it
 * granted so far. Each row's words are read by `read`. The effect holds the
 * first row's until it is emitted; with none of the table's then, a field the
 * kind needs (`needed`) leaves the effect out, and any other is left out.
 */
const byAnswerWords =
  (read: Field, how: { needed?: true } = {}, other: Field = read): Field =>
  (v, r, key) => {
    if (!isRecord(v) || (own(v, 'byAnswer') === undefined && own(v, 'byGrant') === undefined)) {
      return other(v, r, key);
    }
    const granted = own(v, 'byGrant') !== undefined;
    if (granted && own(v, 'byAnswer') !== undefined) {
      throw new Bad('is by an answer or by a spell granted, not both');
    }
    onlyKnown(
      v,
      r,
      (k) => (granted ? k === 'byGrant' : k === 'byAnswer' || k === 'values'),
      granted ? 'a table by the spell granted' : 'a table by an answer',
    );
    let of: string | undefined;
    if (!granted) {
      const id = own(v, 'byAnswer');
      try {
        of =
          r.builtIn === true && typeof id === 'string' && READ_ONLY_PICKS.has(id)
            ? id
            : (pickId(r.builtIn === true)(id, r, 'byAnswer') as string);
      } catch (err) {
        if (err instanceof Bad) throw new Bad(`"byAnswer" ${err.message}`);
        throw err;
      }
    }
    const table = own(v, granted ? 'byGrant' : 'values');
    if (!isRecord(table)) {
      throw new Bad(
        granted
          ? '"byGrant" is a table of spells and words'
          : '"values" is a table of answers and words',
      );
    }
    const entries = Object.entries(table);
    if (entries.length > L.answerRows) throw new Bad(`names at most ${L.answerRows} answers`);
    const names = new Set<string>();
    const values = entries.map(([answer, words]): readonly [string, string] => {
      const name = answer.trim().toLowerCase();
      if (name === '' || name.length > L.labelLength) {
        throw new Bad(`"${clip(answer)}" is not an answer`);
      }
      if (names.has(name)) throw new Bad(`names "${clip(answer)}" twice`);
      names.add(name);
      try {
        return [name, read(words, r, key) as string];
      } catch (err) {
        if (err instanceof Bad) throw new Bad(`"${clip(answer)}" ${err.message}`);
        throw err;
      }
    });
    const [first] = values;
    if (first === undefined) throw new Bad('names no answer');
    r.answers = [
      ...(r.answers ?? []),
      {
        field: key,
        ...(of === undefined ? {} : { of }),
        values,
        ...(how.needed === true ? { needed: true as const } : {}),
      },
    ];
    return first[1];
  };

/** A number that may be a formula or a level table, filled at fold time. */
const amount: Field = (v, r, key) => {
  if (isRecord(v)) {
    onlyKnown(v, r, (k) => k === 'f' || k === 'byLevel', 'an amount');
    // One of the two would be read and the other dropped, so a strict reading names both.
    if (r.seen !== undefined && own(v, 'f') !== undefined && own(v, 'byLevel') !== undefined) {
      throw new Bad('is a formula or a level table, not both');
    }
  }
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

/**
 * A spell by name, which is how a cast is matched. "name|source", as other spell
 * fields take, is read as its name, since a bonus counts every printing.
 */
const spellName: Field = (v, r, k) => {
  const name = (text()(v, r, k) as string).split('|')[0]?.trim() ?? '';
  if (name === '') throw new Bad('needs a spell name');
  return name;
};

/** A nested object, by its known keys only. `true` marks a key it needs. */
const record =
  (spec: Record<string, readonly [Field, boolean?]>): Field =>
  (v, r) => {
    if (!isRecord(v)) throw new Bad('is not an object');
    onlyKnown(v, r, (k) => Object.hasOwn(spec, k), 'this kind');
    let out: Record<string, unknown> = {};
    for (const [key, [read, need]] of Object.entries(spec)) {
      out = { ...out, ...(need === true ? { [key]: req(v, r, key, read) } : opt(v, r, key, read)) };
    }
    return out;
  };

const rollFilterFields = record({
  rolls: [list(oneOf('attack', 'save', 'check'), 3), true],
  abilities: [list(ability, 6)],
  skills: [list(skill, 18)],
  skilled: [flag],
  attack: [oneOf('weapon', 'spell')],
  range: [oneOf('melee', 'ranged')],
  className: [text()],
  proficient: [flag],
  initiative: [flag],
  save: [oneOf('death', 'concentration')],
});

/**
 * A roll filter. One for initiative or a kind of save names that kind of roll
 * too, and narrows it only as that roll can be narrowed (`filterReaches`):
 * initiative is a Dexterity check with no skill, a death save has no ability,
 * and a concentration save is a Constitution save. Either reaches no other
 * roll, so its "rolls" names that kind alone. A proficient skill, like skills,
 * narrows checks alone, so it needs one.
 */
const rollFilter: Field = (v, r, k) => {
  const f = rollFilterFields(v, r, k) as {
    rolls: string[];
    abilities?: string[];
    skills?: string[];
    skilled?: true;
    proficient?: true;
    initiative?: true;
    save?: string;
  };
  if (f.initiative === true) {
    if (f.rolls.length !== 1 || f.rolls[0] !== 'check') {
      throw new Bad('"initiative" is a check: "rolls" lists "check" alone');
    }
    if (f.skills !== undefined || f.skilled === true || f.proficient === true) {
      throw new Bad('"initiative" uses no skill: leave out "skills", "skilled" and "proficient"');
    }
    if (f.abilities !== undefined && !f.abilities.includes('dex')) {
      throw new Bad('"initiative" is a Dexterity check: "abilities" lists "dex"');
    }
  }
  if (f.proficient === true && !f.rolls.includes('check')) {
    throw new Bad('"proficient" narrows checks: "rolls" lists "check"');
  }
  if (f.save !== undefined) {
    if (f.rolls.length !== 1 || f.rolls[0] !== 'save') {
      throw new Bad('"save" is a kind of save: "rolls" lists "save" alone');
    }
    if (f.save === 'death' && f.abilities !== undefined) {
      throw new Bad('"abilities" reach no death save, which uses no ability: leave them out');
    }
    if (f.save === 'concentration' && f.abilities !== undefined && !f.abilities.includes('con')) {
      throw new Bad('"abilities" reach no concentration save without "con", a Constitution save');
    }
  }
  return f;
};

const scope = (o: Record<string, unknown>, r: Reading) =>
  own(o, 'scope') === undefined
    ? { scope: 'all' }
    : { scope: req(o, r, 'scope', oneOf('melee', 'ranged', 'all')) };

const named: Build = (o, r) => ({ name: req(o, r, 'name', text()) });
const amountOnly: Build = (o, r) => ({ amount: req(o, r, 'amount', amount) });

/**
 * The proficiency bonus itself, `"profBonus": true`, goes on initiative once
 * however many features add it (2024 Alert beside Hare-Trigger); an amount
 * that only comes to it, `{ "f": "prof" }`, adds every time.
 */
const initiativeBonus: Build = (o, r) => {
  // A false flag is the same as none.
  if (Object.keys(opt(o, r, 'profBonus', flag)).length === 0) return amountOnly(o, r);
  mark(o, r, 'amount');
  if (own(o, 'amount') !== undefined) throw new Bad('names "amount" or "profBonus", not both');
  return { amount: 'profBonus' };
};
const defense: Build = (o, r) => ({
  damageType: req(o, r, 'damageType', byAnswerWords(text(), { needed: true })),
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

/**
 * A pool's or an action's name with the class that gives it (`classNamed`):
 * always (`"ownClass": true`), or only beside another class of these names
 * (`"ownClassBeside"`), so two classes' features of one name show apart.
 */
const classNaming: Build = (o, r) => {
  const always = opt(o, r, 'ownClass', flag);
  const beside = opt(o, r, 'ownClassBeside', list(text(), 12));
  if (always.ownClass === true && beside.ownClassBeside !== undefined) {
    throw new Bad('names "ownClass" or "ownClassBeside", not both');
  }
  return { ...always, ...beside };
};

/**
 * The fields that hold only for one way of paying: a spell slot's
 * (`"resource": "spell-slot"`), or a Hit Point Die's (`"hit-die"`).
 */
const PAID_WITH: ReadonlyArray<readonly [string, readonly string[], string]> = [
  [SLOT_COST, ['minLevel', 'pactOnly', 'slotDice', 'slotRefills'], 'a spell slot'],
  [HIT_DIE_COST, ['hitDieHeals', 'hitDieAtLeast'], 'a Hit Point Die'],
];

function paidWith(out: Record<string, unknown>): Record<string, unknown> {
  for (const [resource, fields, words] of PAID_WITH) {
    const wrong = out.resource === resource ? undefined : fields.find((k) => k in out);
    if (wrong !== undefined) throw new Bad(`"${wrong}" is for a price paid with ${words}`);
  }
  return out;
}

/**
 * A slot cost's dice by the slot's level (`SlotDice`): `base` plus one a slot
 * level, of `die`, up to `maxDice` (Divine Smite: 1, d8, 5).
 */
const slotDice: Field = (v, r, key) => {
  const out = record({
    die: [int(2, 100), true],
    base: [int(0, 20), true],
    maxDice: [int(1, 40)],
    heals: [flag],
    plain: [flag],
    plus: [text()],
  })(v, r, key) as Record<string, unknown>;
  if (out.heals === true && out.plain === true) throw new Bad('"plain" or "heals", not both');
  return out;
};

/**
 * What using an action spends (`ActionCost`): a pool's uses by its key, a spell
 * slot (`"spell-slot"`, of the level the player picks as they pay), or a Hit
 * Point Die (`"hit-die"`, which heals as it is spent).
 */
// A cost's fields come out in the order the link tables wrote them, before rule
// pack port 3b to 3d moved every price into `spend.json`, so the moves changed
// no sheet. A buy-back's keep 3a's order (`own` before the slot fields).
const costAmount: Field = (x, r, k) => (x === 'varies' ? x : int(0, 999)(x, r, k));
const actionCost: Field = (v, r, key) =>
  paidWith(
    record({
      resource: [text(), true],
      amount: [costAmount, true],
      optional: [flag],
      minLevel: [int(1, 9)],
      pactOnly: [flag],
      slotDice: [slotDice],
      slotRefills: [text()],
      hitDieHeals: [oneOf('roll', 'rollPlusCon')],
      hitDieAtLeast: [int(1, 99)],
      ownUseToo: [flag],
    })(v, r, key) as Record<string, unknown>,
  );

/**
 * What buys a use of an action back once none are left (`ActionBuyBack`): a
 * pool's uses or a spell slot. `own` names the use it gives back, when that use
 * does not share the action's name.
 */
const actionBuyBack: Field = (v, r, key) => {
  const out = record({
    resource: [text(), true],
    amount: [int(1, 999), true],
    own: [text()],
    minLevel: [int(1, 9)],
    pactOnly: [flag],
  })(v, r, key) as Record<string, unknown>;
  if (out.resource === HIT_DIE_COST) throw new Bad('"resource" is a pool or a spell slot');
  return paidWith(out);
};

const action: Build = (o, r) => ({
  economy: req(o, r, 'economy', oneOf('action', 'bonus', 'reaction', 'none')),
  label: req(o, r, 'label', byLevelWords(text(), { needed: true })),
  ...classNaming(o, r),
  ...opt(o, r, 'roll', byLevelWords(dice)),
  ...opt(o, r, 'heals', flag),
  ...opt(o, r, 'plainDice', flag),
  ...opt(o, r, 'note', byAnswerWords(text(L.textLength), {}, byLevelWords(text(L.textLength)))),
  ...opt(
    o,
    r,
    'save',
    // `strOrDex`: the higher of Strength and Dexterity, a maneuver's DC.
    record({
      targetAbility: [ability, true],
      dcAbility: [oneOf(...ABILITY_LIST, 'strOrDex', 'spell')],
    }),
  ),
  ...opt(o, r, 'cost', actionCost),
  ...opt(o, r, 'buyBack', actionBuyBack),
  ...opt(o, r, 'regains', record({ resource: [text(), true], amount: [int(0, 999), true] })),
  ...opt(o, r, 'spendsNoUse', flag),
});

/** A player's price on an inherited action (`StoredAmend`), read. */
export interface AmendRule {
  /** The action's name as the sheet shows it, in any case. Absent: its first inherited action. */
  label?: string;
  cost?: ActionCost | AmendedAmount;
  buyBack?: ActionBuyBack;
}

/** A `cost` with no `resource`: how many of what the action spends now. */
const amendedAmount = record({ amount: [costAmount, true] });

/** What an amend reads. A field it does not is a problem: a misspelt `label` would price another action. */
const AMEND_FIELDS = new Set(['label', 'cost', 'buyBack']);

function readAmend(raw: unknown): AmendRule {
  if (!isRecord(raw)) throw new Bad('is not a price');
  const unknown = Object.keys(raw).find((k) => !AMEND_FIELDS.has(k));
  if (unknown !== undefined) throw new Bad(`"${clip(unknown)}" is not a field an amend reads`);
  const cost = own(raw, 'cost');
  const keeps = isRecord(cost) && !Object.hasOwn(cost, 'resource');
  const extra = keeps ? Object.keys(cost).find((k) => k !== 'amount') : undefined;
  if (extra !== undefined) {
    throw new Bad(`"cost" with no "resource" changes only "amount", not "${clip(extra)}"`);
  }
  const r: Reading = { kind: 'action', slots: [] };
  const read = record({
    label: [text()],
    cost: [keeps ? amendedAmount : actionCost],
    buyBack: [actionBuyBack],
  })(raw, r, 'amend') as AmendRule;
  if (read.cost === undefined && read.buyBack === undefined) {
    throw new Bad('changes a "cost" or a "buyBack"');
  }
  return read;
}

/** An entry's or a patch's `amend`, each read on its own: a bad one is a problem and is left out. */
function readAmends(raw: unknown, problems: string[]): AmendRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push('"amend" is not a list');
    return [];
  }
  if (raw.length > L.amendsPerEntry)
    problems.push(`only the first ${L.amendsPerEntry} of "amend" count`);
  const out: AmendRule[] = [];
  raw.slice(0, L.amendsPerEntry).forEach((x, i) => {
    try {
      out.push(readAmend(x));
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      problems.push(`amend ${i + 1}: ${err.message}`);
    }
  });
  return out;
}

/** One price a built-in `spend` row puts on a feature's action, read (`StoredSpendLink`). */
export type SpendLinkRow =
  | { cost: ActionCost; economy?: ActionEconomy; label?: string; note?: string }
  | {
      buyBack: ActionBuyBack;
      onAction?: string;
      ownSpell?: string;
      uses?: { key: string; max: number; resetOn: 'short' | 'long' };
    };

const costLink = record({
  cost: [actionCost, true],
  economy: [oneOf('action', 'bonus', 'reaction', 'none')],
  label: [text()],
  note: [text(L.textLength)],
});
const buyBackLink = record({
  buyBack: [actionBuyBack, true],
  onAction: [text()],
  ownSpell: [text()],
  uses: [
    record({
      key: [text(), true],
      max: [int(1, 99), true],
      resetOn: [oneOf('short', 'long'), true],
    }),
  ],
});

/** One link, read strictly as the app's own files are: a field it does not read is a problem. */
function readSpendLink(raw: unknown): SpendLinkRow {
  if (!isRecord(raw)) throw new Bad('is not a price');
  if (Object.hasOwn(raw, 'cost') === Object.hasOwn(raw, 'buyBack')) {
    throw new Bad('has a "cost" or a "buyBack", one of them');
  }
  const r: Reading = { kind: 'action', slots: [], seen: new Map() };
  const read = (Object.hasOwn(raw, 'cost') ? costLink : buyBackLink)(raw, r, 'link');
  const link = read as Record<string, unknown>;
  if (link.ownSpell !== undefined && isRecord(link.buyBack) && link.buyBack.own !== undefined) {
    throw new Bad('"buyBack.own" or "ownSpell", not both');
  }
  return link as SpendLinkRow;
}

/** A `spend` row's links, each read on its own: a bad one is a problem and is left out. */
function readSpendLinks(raw: unknown): { links: SpendLinkRow[]; problems: string[] } {
  const links: SpendLinkRow[] = [];
  const problems: string[] = [];
  raw = Array.isArray(raw) ? raw : [];
  if ((raw as unknown[]).length > L.effectsPerEntry) {
    problems.push(`only the first ${L.effectsPerEntry} of "links" count`);
  }
  (raw as unknown[]).slice(0, L.effectsPerEntry).forEach((x, i) => {
    try {
      links.push(readSpendLink(x));
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      problems.push(`link ${i + 1}: ${err.message}`);
    }
  });
  return { links, problems };
}

const INSPIRATION_ALONE = '"inspiration" is the whole price: "reaction" is not true beside it';

/**
 * What a feature of the character's own adds to a roll, paid as its Use is
 * (`PaidRoll`): one of a die (`dice`), the paying pool's own die (`poolDie`), a
 * flat bonus or advantage. A bonus is added once the d20 shows, so it is always
 * `after`. Advantage is claimed before the d20, so it waits on no failure, and a
 * use given back on a roll that still failed (`spentOnSuccess`) needs one.
 * Inspiration pays alone: no reaction beside it, and no pool's die to add.
 */
const rollPaid: Build = (o, r) => {
  const on = req(o, r, 'on', rollFilter);
  const adds = {
    ...opt(o, r, 'dice', dice),
    ...opt(o, r, 'poolDie', flag),
    ...opt(o, r, 'bonus', amount),
    ...opt(o, r, 'advantage', flag),
  };
  if (Object.keys(adds).length !== 1) {
    throw new Bad('names one of "dice", "poolDie", "bonus" or "advantage"');
  }
  const rest = {
    ...opt(o, r, 'after', flag),
    ...opt(o, r, 'ifFailed', flag),
    ...opt(o, r, 'spentOnSuccess', flag),
    ...opt(o, r, 'reaction', bool),
    ...opt(o, r, 'when', text(L.textLength)),
    ...opt(o, r, 'inspiration', flag),
  };
  if ('advantage' in adds && ('after' in rest || 'ifFailed' in rest)) {
    throw new Bad('"advantage" is claimed before the d20: leave out "after" and "ifFailed"');
  }
  if ('spentOnSuccess' in rest && !('ifFailed' in rest)) {
    throw new Bad(
      '"spentOnSuccess" gives the use back on a roll that still failed: "ifFailed" is true',
    );
  }
  if ('poolDie' in adds && 'inspiration' in rest) {
    throw new Bad(
      '"poolDie" adds the die of the pool that pays, and Inspiration has none: leave out "inspiration"',
    );
  }
  if ('inspiration' in rest && rest.reaction === true) throw new Bad(INSPIRATION_ALONE);
  return { on, ...adds, ...('bonus' in adds ? { after: true } : {}), ...rest };
};

/**
 * A reroll a feature of the character's own gives (`Reroll`), or a number set
 * in place of the d20 (`to`), or a floor at an ability's score
 * (`floorScore`). One made as the d20 lands (`auto`) costs nothing, waits on
 * nothing and never makes the roll worse: the lower die of advantage, a 1, a
 * number set or a floor. The prompt offers a lower die and a floor only so. A
 * number set or a floor adds no bonus, and a free reroll is not paid with Inspiration.
 */
const rollReroll: Build = (o, r) => {
  const out: Record<string, unknown> = {
    on: req(o, r, 'on', rollFilter),
    ...opt(o, r, 'die', oneOf('all', 'one', 'low', 'extra')),
    ...opt(o, r, 'atMost', int(1, 19)),
    ...opt(o, r, 'to', int(2, 20)),
    ...opt(o, r, 'floorScore', ability),
    ...opt(o, r, 'auto', flag),
    ...opt(o, r, 'free', flag),
    ...opt(o, r, 'reaction', bool),
    ...opt(o, r, 'ifFailed', flag),
    ...opt(o, r, 'bonus', amount),
    ...opt(o, r, 'when', text(L.textLength)),
    ...opt(o, r, 'inspiration', flag),
  };
  const sets = out.to !== undefined || out.floorScore !== undefined;
  if (out.to !== undefined && out.floorScore !== undefined) {
    throw new Bad('sets the d20 ("to") or a floor ("floorScore"), not both');
  }
  if (sets && (out.die !== undefined || out.atMost !== undefined)) {
    throw new Bad('"to" and "floorScore" reroll nothing: leave out "die" and "atMost"');
  }
  if (sets && out.bonus !== undefined) {
    throw new Bad('a number set or a floor adds no "bonus": leave it out');
  }
  if ((out.atMost !== undefined) !== (out.die === 'one')) {
    throw new Bad('"die": "one" rerolls a die showing "atMost" or less, and "atMost" needs it');
  }
  if ((out.floorScore !== undefined || out.die === 'low') && out.auto !== true) {
    throw new Bad('a floor and the lower die are made as the d20 lands: "auto" is true');
  }
  if (out.auto === true) {
    if (out.free !== true) throw new Bad('"auto" is made with nothing paid: "free" is true');
    const waits = ['ifFailed', 'when', 'reaction', 'inspiration'].find((k) => k in out);
    if (waits !== undefined) throw new Bad(`"auto" waits on nothing: leave out "${waits}"`);
    if (!(sets || out.die === 'low' || (out.die === 'one' && out.atMost === 1))) {
      throw new Bad(
        '"auto" never makes the roll worse: a 1, the lower die, a number set or a floor',
      );
    }
  }
  if (out.free === true && 'inspiration' in out) {
    throw new Bad('"free" pays nothing: leave out "inspiration"');
  }
  if ('inspiration' in out && out.reaction === true) throw new Bad(INSPIRATION_ALONE);
  return out;
};

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
  [
    'spellListAdd',
    // Spells by name, any printing. Never "filters": the data's own spell
    // filter syntax, which a file names spells in place of.
    (o, r) => {
      if (own(o, 'filters') !== undefined) throw new Bad('names its spells, not "filters"');
      return {
        spells: req(o, r, 'spells', list(spellName, 50)),
        filters: [],
        ...opt(o, r, 'className', text()),
      };
    },
  ],
  ['toolProf', named],
  ['armorProf', named],
  ['weaponProf', named],
  ['language', named],
  [
    'acFormula',
    // With no label, the AC shows the name of what gives it (`namedFor`), so
    // a renamed copy shows its own.
    (o, r) => ({
      ...opt(o, r, 'label', text()),
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
  ['initiativeBonus', initiativeBonus],
  [
    'speedBonus',
    (o, r) => ({
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'unless', oneOf('heavyArmor', 'armorOrShield')),
    }),
  ],
  [
    'armorPenaltyLift',
    (o, r) => ({
      penalty: req(o, r, 'penalty', oneOf('strength', 'stealth')),
      ...opt(o, r, 'armor', oneOf('light', 'medium', 'heavy')),
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
      ...opt(o, r, 'weaponsOnly', flag),
      ...opt(o, r, 'weapons', list(text(), 20)),
      ...opt(o, r, 'className', text()),
    }),
  ],
  [
    'damageBonus',
    (o, r) => ({
      ...scope(o, r),
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'ability', ability),
      ...opt(o, r, 'weaponsOnly', flag),
      ...opt(o, r, 'weapons', list(text(), 20)),
    }),
  ],
  [
    'damageDie',
    (o, r) => ({
      ...scope(o, r),
      dice: req(o, r, 'dice', dice),
      ...opt(o, r, 'damageType', text()),
      ...opt(o, r, 'weaponsOnly', flag),
    }),
  ],
  [
    'spellDcBonus',
    (o, r) => ({
      amount: req(o, r, 'amount', amount),
      ...opt(o, r, 'className', text()),
      ...opt(o, r, 'ability', ability),
    }),
  ],
  [
    'spellDamageBonus',
    (o, r) => {
      // "ownClass": the spells of the class that gives it (`forClass`).
      const ofOwnClass = opt(o, r, 'ownClass', flag);
      if (ofOwnClass.ownClass === true && own(o, 'className') !== undefined) {
        throw new Bad('names "className" or "ownClass", not both');
      }
      return {
        amount: req(o, r, 'amount', amount),
        ...opt(o, r, 'spells', list(spellName, 50)),
        ...opt(o, r, 'className', text()),
        ...ofOwnClass,
        ...opt(o, r, 'cantrips', flag),
        ...opt(o, r, 'school', oneOf(...Object.keys(SPELL_SCHOOLS))),
        ...opt(o, r, 'oneRoll', flag),
      };
    },
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
  [
    'sense',
    (o, r) => {
      const out = { sense: req(o, r, 'sense', text()), range: req(o, r, 'range', amount) };
      // "orMore": that much more than the same sense held so far, else `range` (`moreSense`).
      const more = opt(o, r, 'orMore', int(1, 300));
      const from = opt(o, r, 'orMoreFrom', oneOf('race'));
      if (from.orMoreFrom !== undefined && more.orMore === undefined) {
        throw new Bad('"orMoreFrom" goes with "orMore"');
      }
      if (more.orMore !== undefined && r.slots.length > 0) {
        throw new Bad('"orMore" needs a plain "range", not a formula');
      }
      return { ...out, ...more, ...from };
    },
  ],
  ['resist', defense],
  ['immune', defense],
  [
    'vulnerable',
    (o, r) => ({ damageType: req(o, r, 'damageType', byAnswerWords(text(), { needed: true })) }),
  ],
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
    (o, r) => {
      const mode = req(o, r, 'mode', oneOf('adv', 'dis'));
      const when = opt(o, r, 'when', text(L.textLength));
      // The roll prompt offers only advantage to claim (`rollEffects`).
      if (mode === 'dis' && when.when !== undefined) {
        throw new Bad('"when" goes with "mode": "adv" alone');
      }
      return { mode, on: req(o, r, 'on', rollFilter), ...when };
    },
  ],
  ['rollPaid', rollPaid],
  ['rollReroll', rollReroll],
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
      label: req(o, r, 'label', byLevelWords(text(), { needed: true })),
      max: req(o, r, 'max', amount),
      ...opt(o, r, 'min', amount),
      resetOn: req(
        o,
        r,
        'reset',
        byLevelWords(oneOf('short', 'long'), { needed: true, as: 'resetOn' }),
      ),
      ...opt(o, r, 'stack', flag),
      ...opt(o, r, 'regainOnShort', amount),
      ...opt(o, r, 'noSlotConversion', int(1, 20)),
      ...opt(o, r, 'die', byLevelWords(oneDie)),
      ...opt(o, r, 'foretell', flag),
      ...classNaming(o, r),
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
    (o, r) => {
      // "ownClass": cast with the ability of the class that gives it (`forClass`).
      const ofOwnClass = opt(o, r, 'ownClass', flag);
      if (ofOwnClass.ownClass === true && own(o, 'ability') !== undefined) {
        throw new Bad('names "ability" or "ownClass", not both');
      }
      return {
        spell: req(o, r, 'spell', spellRef),
        ...opt(o, r, 'ability', ability),
        ...ofOwnClass,
        ...opt(o, r, 'usage', byLevelWords(text())),
        ...opt(o, r, 'resourceKey', text()),
        ...opt(o, r, 'slotsOnly', flag),
      };
    },
  ],
  ['note', (o, r) => ({ text: req(o, r, 'text', text(L.textLength)) })],
  ['weaponMastery', named],
  [
    'weaponProfFilter',
    (o, r) => {
      // The data's own filter words, which a player's file has no reason to write.
      if (r.builtIn !== true) throw new Bad("is read in the app's own rule sets only");
      return { filter: req(o, r, 'filter', weaponFilter) };
    },
  ],
]);

/**
 * The kinds that may hold `while` a state lasts: those an effect in play may
 * carry, and a feature's paid extras and rerolls, which never go in play
 * (Fanatical Focus, while raging).
 */
const ACTIVE: ReadonlySet<string> = new Set([...ACTIVE_PART_KINDS, 'rollPaid', 'rollReroll']);
const PLAIN_STATES: ReadonlySet<string> = new Set([
  'bloodied',
  'zeroHp',
  'concentrating',
  'noArmor',
  'shield',
]);

function readState(s: unknown, r: Reading): WhileState {
  const { kind } = r;
  if (typeof s === 'string' && PLAIN_STATES.has(s)) {
    if (s === 'bloodied' && EARLY_KINDS.has(kind)) {
      throw new Bad('bloodied cannot hold for a score or the hit point maximum');
    }
    return { state: s as 'bloodied' };
  }
  if (isRecord(s)) {
    onlyKnown(s, r, (k) => k === 'effect' || k === 'condition', 'a state');
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
  return states.map((s) => readState(s, r));
};

/** How a list of stored effects is read: strictly, as the app's own, or as what a pick gives. */
interface HowRead {
  strict: boolean;
  builtIn: boolean;
  /** What a pick gives: no pick of its own. */
  inPick: boolean;
  /**
   * An entry's own effects or a pack's patch of them, where an item's
   * `charges` effect is read (`ReadEffects.charges`). Anywhere else it is a problem.
   */
  holdsCharges?: boolean;
}

/** How an entry's own effects and a pack's patches are read: a player's file, which may hold an item's charges. */
const OWN_EFFECTS: HowRead = { strict: false, builtIn: false, inPick: false, holdsCharges: true };

/** `{pick}` and the rest filled into stored words, `{picks}` standing alone as the list of them. */
function filled(v: unknown, f: PickFill): unknown {
  if (typeof v === 'string') {
    if (v === '{picks}' && f.picks !== undefined) return [...f.picks];
    // Functions, so a `$` in an answer is the answer's, not a replacement pattern.
    return v
      .replaceAll('{pick.slug}', () => f.slug ?? f.pick)
      .replaceAll('{pick.title}', () => f.title ?? f.pick)
      .replaceAll('{pick}', () => f.pick);
  }
  if (Array.isArray(v)) return v.map((x) => filled(x, f));
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, filled(x, f)]));
  return v;
}

/** A spell a pick's stored effects are checked with, as a spell answer fills them. */
const SAMPLE_SPELL: PickFill = {
  pick: 'Fire Bolt|XPHB',
  slug: 'fire-bolt',
  title: 'Fire Bolt',
  picks: ['fire bolt'],
};

/** An answer of each ask, to check a pick's stored effects read with one filled in. */
function sampleFills(ask: PickAsk): PickFill[] {
  switch (ask) {
    case 'skill':
      return [{ pick: 'Athletics' }];
    case 'tool':
      return [{ pick: "Smith's Tools" }];
    case 'weapon':
    case 'weaponMastery':
      return [{ pick: 'longsword' }];
    case 'save':
      return [{ pick: 'str' }];
    case 'damage':
      return [{ pick: 'fire' }];
    case 'option':
      return [{ pick: 'option' }];
    case 'spell':
      return [SAMPLE_SPELL];
  }
}

/**
 * The answers what a pick gives is checked with: each option's id (else an
 * answer of the ask), and each name it takes in place of. The reader and the
 * Workshop's cards check with these alike.
 */
export function pickSamples(
  ask: PickAsk,
  optionIds: readonly string[],
  inPlaceOf: readonly string[] = [],
): PickFill[] {
  return [
    ...(ask === 'option' ? optionIds.map((pick) => ({ pick })) : sampleFills(ask)),
    ...inPlaceOf.map((pick) => ({ pick })),
  ];
}

/**
 * A pick's stored effects (`gives`, `givesAll`), checked with each sample
 * filled in, and read again with each answer. Answers repeat across derives,
 * so each fill is read once.
 */
function pickGives(
  raw: unknown,
  name: string,
  samples: readonly PickFill[],
  how: HowRead,
): PickGives<EffectTemplate> {
  const inner: HowRead = { ...how, inPick: true, holdsCharges: false };
  for (const sample of samples) {
    const read = readStoredEffects(filled(raw, sample), name, inner);
    const [problem] = read.problems;
    if (problem !== undefined) throw new Bad(`"${name}": ${problem}`);
  }
  const seen = new Map<string, { effects: EffectTemplate[]; problems: string[] }>();
  return (f) => {
    const key = JSON.stringify(f);
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const read = readStoredEffects(filled(raw, f), name, inner);
    seen.set(key, read);
    return read;
  };
}

/**
 * The problems what a player's pick gives (`gives`, an option's `gives`) has
 * with each of these answers filled in, each once: as the pick's reader finds
 * them, effect by effect, for the Workshop's cards of what a pick gives.
 */
export function pickGivesProblems(raw: unknown, fills: readonly PickFill[]): string[] {
  const how: HowRead = { strict: false, builtIn: false, inPick: true };
  return [
    ...new Set(
      // `{picks}` is filled in what the picks give together alone, as the reader fills it.
      fills.flatMap(
        ({ picks: _, ...f }) => readStoredEffects(filled(raw, f), 'gives', how).problems,
      ),
    ),
  ];
}

/** A pick's count: a number, a level table of numbers, or a class table's column. */
const pickCount: Field = (v, r, key) => {
  if (typeof v === 'number') return int(1, 20)(v, r, key);
  if (!isRecord(v)) throw new Bad('is a number, a level table or a table column');
  if (own(v, 'byLevel') !== undefined) {
    onlyKnown(v, r, (k) => k === 'byLevel', 'a level table');
    const table = own(v, 'byLevel');
    if (!isRecord(table) || Object.keys(table).length === 0) {
      throw new Bad('byLevel needs at least one level');
    }
    if (Object.keys(table).length > L.byLevelRows) {
      throw new Bad(`byLevel has at most ${L.byLevelRows} levels`);
    }
    const rows = Object.entries(table).map(([level, n]): readonly [number, number] => {
      if (!/^\d{1,2}$/.test(level)) throw new Bad(`byLevel: "${clip(level)}" is not a level`);
      return [Number(level), int(0, 20)(n, r, key) as number];
    });
    return { byLevel: rows.sort((x, y) => x[0] - y[0]) };
  }
  onlyKnown(v, r, (k) => k === 'tableColumn' || k === 'else', 'a table column');
  return {
    tableColumn: req(v, r, 'tableColumn', text()),
    else: req(v, r, 'else', int(1, 20)),
  };
};

const pickId =
  (builtIn: boolean): Field =>
  (v) => {
    // The ids the code rows asked under stay as they were, so saved answers read.
    if (builtIn && typeof v === 'string' && CODE_PICK_IDS.has(v)) return v;
    if (typeof v !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(v)) {
      throw new Bad(
        'is a short name of lowercase letters, digits and hyphens, like "favoured-tool"',
      );
    }
    return `pick-${v}`;
  };

/** What a pick's `from` lists, by what it asks: spelled as its answers are. */
function fromOf(ask: PickAsk): Field {
  switch (ask) {
    case 'skill':
      return list(skill, 40);
    case 'save':
      return list(ability, 6);
    case 'damage':
      return list(oneOf(...DAMAGE_TYPES), 13);
    default:
      return list(text(), 40);
  }
}

/** Fields only some asks read, and the asks that read them. */
const PICK_ONLY: ReadonlyArray<readonly [string, readonly PickAsk[]]> = [
  ['classSkills', ['skill']],
  ['orLanguage', ['skill']],
  ['options', ['option']],
  ['melee', ['weaponMastery']],
  ['proficient', ['weaponMastery']],
  ['weapons', ['weapon']],
  ['spells', ['spell']],
  ['inPlaceOf', [...IN_PLACE_ASKS]],
  ['from', ['skill', 'tool', 'weapon', 'save', 'damage']],
];

/**
 * A stored pick (`picks.ts`): the prompt it asks and what each answer gives,
 * checked once with a sample answer filled in. A pick gives no pick, and holds
 * no `while`, since it is asked as the character is built.
 */
function readPick(raw: Record<string, unknown>, how: HowRead): EffectTemplate {
  if (how.inPick) throw new Bad('a pick gives no pick of its own');
  const r: Reading = { kind: 'note', slots: [], ...(how.strict ? { seen: new Map() } : {}) };
  const ask = req(raw, r, 'ask', oneOf(...PICK_ASKS)) as PickAsk;
  for (const [key, asks] of PICK_ONLY) {
    if (own(raw, key) !== undefined && !asks.includes(ask)) {
      throw new Bad(`"${key}" goes with a pick that asks for ${asks.join(' or ')}`);
    }
  }
  const id = req(raw, r, 'id', pickId(how.builtIn)) as string;
  const count = (opt(raw, r, 'count', pickCount).count ?? 1) as PickCount;
  const label = opt(raw, r, 'label', text()).label as string | undefined;
  const from = opt(raw, r, 'from', fromOf(ask)).from as string[] | undefined;
  const flags = {
    ...opt(raw, r, 'classSkills', flag),
    ...opt(raw, r, 'orLanguage', flag),
    ...opt(raw, r, 'afterBuild', flag),
    ...opt(raw, r, 'melee', flag),
    ...opt(raw, r, 'proficient', flag),
  } as Pick<
    PickRule<EffectTemplate>,
    'classSkills' | 'orLanguage' | 'afterBuild' | 'melee' | 'proficient'
  >;
  const weapons = opt(
    raw,
    r,
    'weapons',
    record({ filter: [weaponTypes, true], without: [list(text(), 10)] }),
  ).weapons as PickRule<EffectTemplate>['weapons'];
  if (ask === 'weapon' && (weapons === undefined) === (from === undefined)) {
    throw new Bad('a weapon pick names its weapons in "from" or "weapons", one of them');
  }
  const spells = opt(
    raw,
    r,
    'spells',
    record({ levels: [list(int(0, 9), 10), true], classes: [list(text(), 10)] }),
  ).spells as PickRule<EffectTemplate>['spells'];
  if (ask === 'spell' && spells === undefined) throw new Bad('"spells" is missing');
  let options: PickOption<EffectTemplate>[] | undefined;
  if (ask === 'option') {
    mark(raw, r, 'options');
    const rawOptions = own(raw, 'options');
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      throw new Bad('"options" lists what it offers');
    }
    if (rawOptions.length > 20) throw new Bad('"options" lists at most 20');
    options = rawOptions.map((o, i) => {
      if (!isRecord(o)) throw new Bad(`"options": option ${i + 1} is not an option`);
      onlyKnown(o, r, (k) => k === 'id' || k === 'label' || k === 'gives', 'an option');
      const optionId = field(own(o, 'id'), r, `options.${i + 1}.id`, text(40)) as string;
      // Saved answers match without case, so two ids that differ only in case are one.
      const same = (p: unknown) =>
        isRecord(p) && String(own(p, 'id')).trim().toLowerCase() === optionId.toLowerCase();
      if (rawOptions.slice(0, i).some(same)) {
        throw new Bad(`"options": "${clip(optionId)}" is offered twice`);
      }
      const optionLabel = field(own(o, 'label'), r, `options.${i + 1}.label`, text()) as string;
      const rawGives = own(o, 'gives');
      const gives =
        rawGives === undefined
          ? undefined
          : pickGives(
              rawGives,
              `options.${i + 1}.gives`,
              [{ pick: optionId }],
              how,
            )({
              pick: optionId,
            }).effects;
      return { id: optionId, label: optionLabel, ...(gives === undefined ? {} : { gives }) };
    });
  }
  let inPlaceOf: string[] | undefined;
  if (own(raw, 'inPlaceOf') !== undefined) {
    inPlaceOf = req(raw, r, 'inPlaceOf', fromOf(ask)) as string[];
  }
  mark(raw, r, 'gives');
  mark(raw, r, 'givesAll');
  mark(raw, r, 'always');
  const samples = pickSamples(
    ask,
    (options ?? []).map((o) => o.id),
    inPlaceOf,
  );
  // `{picks}` is filled in what the picks give together alone.
  const gives =
    own(raw, 'gives') === undefined
      ? undefined
      : pickGives(
          own(raw, 'gives'),
          'gives',
          samples.map(({ picks: _, ...s }) => s),
          how,
        );
  const givesAll =
    own(raw, 'givesAll') === undefined
      ? undefined
      : pickGives(
          own(raw, 'givesAll'),
          'givesAll',
          samples.map((s) => ({ ...s, picks: s.picks ?? [s.pick] })),
          how,
        );
  let always: EffectTemplate[] | undefined;
  if (own(raw, 'always') !== undefined) {
    if (inPlaceOf === undefined) throw new Bad('"always" goes with "inPlaceOf"');
    always = [
      ...pickGives(own(raw, 'always'), 'always', [{ pick: '' }], how)({ pick: '' }).effects,
    ];
  }
  if (gives === undefined && givesAll === undefined && options?.some((o) => o.gives) !== true) {
    if (ask !== 'option') throw new Bad('"gives" says what each pick gives');
  }
  if (own(raw, 'while') !== undefined) {
    throw new Bad('is asked as the character is built, so it holds no "while"');
  }
  const edition = opt(raw, r, 'edition', oneOf(...EFFECT_EDITIONS)) as {
    edition?: (typeof EFFECT_EDITIONS)[number];
  };
  const read = r.seen?.get(raw);
  onlyKnown(raw, r, (k) => k === 'kind' || read?.has(k) === true, 'a pick');
  const rule: PickRule<EffectTemplate> = {
    id,
    ask,
    count,
    ...(label === undefined ? {} : { label }),
    ...(from === undefined ? {} : { from }),
    ...flags,
    ...(weapons === undefined ? {} : { weapons }),
    ...(spells === undefined ? {} : { spells }),
    ...(options === undefined ? {} : { options }),
    ...(inPlaceOf === undefined ? {} : { inPlaceOf }),
    ...(gives === undefined ? {} : { gives }),
    ...(givesAll === undefined ? {} : { givesAll }),
    ...(always === undefined ? {} : { always }),
  };
  return { effect: { kind: 'pick', id, ask }, pick: rule, ...edition };
}

function readEffect(raw: unknown, how: HowRead): EffectTemplate {
  if (!isRecord(raw)) throw new Bad('is not an effect');
  const kind = own(raw, 'kind');
  if (kind === 'pick') return readPick(raw, how);
  const build = typeof kind === 'string' ? KINDS.get(kind as Kind) : undefined;
  if (build === undefined) throw new Bad(`has no kind "${clip(kind)}"`);
  const r: Reading = {
    kind: kind as Kind,
    slots: [],
    ...(how.strict ? { seen: new Map() } : {}),
    ...(how.builtIn ? { builtIn: true as const } : {}),
  };
  const effect = { kind: kind as Kind, ...build(raw, r) };
  const states = opt(raw, r, 'while', readWhile) as { while?: WhileState[] };
  const edition = opt(raw, r, 'edition', oneOf(...EFFECT_EDITIONS)) as {
    edition?: (typeof EFFECT_EDITIONS)[number];
  };
  const read = r.seen?.get(raw);
  onlyKnown(raw, r, (k) => k === 'kind' || read?.has(k) === true, 'this kind');
  return {
    effect,
    ...(r.slots.length > 0 ? { formulas: r.slots } : {}),
    ...(r.words === undefined ? {} : { byLevel: r.words }),
    ...(r.answers === undefined ? {} : { byAnswer: r.answers }),
    ...states,
    ...edition,
  };
}

/** A stored list of effects, read (`readStoredEffects`). */
export interface ReadEffects {
  effects: EffectTemplate[];
  problems: string[];
  /** Where each of `effects` sits in the list, from 1: the reader leaves bad ones out. */
  places: number[];
  /**
   * An item's `charges` effect, read apart from the others: it says what the
   * item's charges hold, regain and cast (`itemChargesOf`), and emits nothing.
   */
  charges?: ItemCharges;
}

/**
 * A stored list of effects (an entry's, a patch's, a moment's), each read on its
 * own: a bad one is a problem and is left out, the rest count. `strict` (the
 * app's own rule sets) also makes a field the reader does not read a problem,
 * which a player's file may carry for a newer version of the format.
 */
export function readStoredEffects(
  raw: unknown,
  name = 'effects',
  strictOrHow: boolean | HowRead = false,
): ReadEffects {
  const how: HowRead =
    typeof strictOrHow === 'boolean'
      ? { strict: strictOrHow, builtIn: false, inPick: false }
      : strictOrHow;
  const effects: EffectTemplate[] = [];
  const problems: string[] = [];
  // Where each effect read sits in the list, from 1: the reader leaves bad ones out.
  const places: number[] = [];
  if (raw === undefined) return { effects, problems, places };
  if (!Array.isArray(raw)) return { effects, problems: [`"${name}" is not a list`], places };
  if (raw.length > L.effectsPerEntry) {
    problems.push(`only the first ${L.effectsPerEntry} of "${name}" count`);
  }
  // Two picks under one id would share one answer, each applying it: unless each
  // counts under its own rules version, so only one is ever asked.
  const pickIds = new Map<string, Array<string | undefined>>();
  const read: Array<{ t: EffectTemplate; i: number }> = [];
  const said = (x: unknown, i: number, err: Bad) => {
    const kind =
      isRecord(x) && typeof own(x, 'kind') === 'string' ? ` (${clip(own(x, 'kind'))})` : '';
    problems.push(`effect ${i + 1}${kind}: ${err.message}`);
  };
  let charges: ItemCharges | undefined;
  // Where the list first says the item's charges, from 0: a second says them again.
  let chargesAt: number | undefined;
  raw.slice(0, L.effectsPerEntry).forEach((x, i) => {
    try {
      if (isRecord(x) && own(x, 'kind') === 'charges') {
        if (how.holdsCharges !== true) {
          throw new Bad("is an item's own, in its effects or a pack's patch of them");
        }
        if (own(x, 'while') !== undefined || own(x, 'edition') !== undefined) {
          throw new Bad('holds its charges always: no "while" or "edition"');
        }
        if (chargesAt !== undefined) {
          throw new Bad(`says the item's charges again: effect ${chargesAt + 1} says them`);
        }
        chargesAt = i;
        const held = readCharges(x, true);
        for (const problem of held.problems) said(x, i, new Bad(problem));
        charges = held.charges;
        return;
      }
      const t = readEffect(x, how);
      if (t.pick !== undefined) {
        const editions = pickIds.get(t.pick.id) ?? [];
        if (editions.some((ed) => ed === undefined || t.edition === undefined || ed === t.edition))
          throw new Bad(`asks "${clip(t.pick.id)}" again: give each pick its own "id"`);
        pickIds.set(t.pick.id, [...editions, t.edition]);
      }
      read.push({ t, i });
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      said(x, i, err);
    }
  });
  // A pick of the entry's own is read where it is asked, in this list: one it
  // does not ask has no answer to read. The engine's own ids are asked elsewhere.
  for (const { t, i } of read) {
    const missing = t.byAnswer?.find((a) => a.of?.startsWith('pick-') && !pickIds.has(a.of));
    if (missing?.of === undefined) {
      effects.push(t);
      places.push(i + 1);
    } else {
      said(
        raw[i],
        i,
        new Bad(
          `reads the answer to "${clip(missing.of.slice(5))}", a pick this list does not ask`,
        ),
      );
    }
  }
  return { effects, problems, places, ...(charges === undefined ? {} : { charges }) };
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
  amend: [],
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
    const { effects, problems, charges } = readStoredEffects(
      own(raw, 'effects'),
      'effects',
      OWN_EFFECTS,
    );
    const drop = readDrops(own(raw, 'drop'), problems);
    const amend = readAmends(own(raw, 'amend'), problems);
    const replace = own(raw, 'replace');
    if (replace !== undefined && typeof replace !== 'boolean')
      problems.push('"replace" is true or false');
    const based = own(raw, 'basedOn');
    const basedOn = typeof based === 'string' ? readRef(based) : undefined;
    if (based !== undefined && basedOn === undefined) problems.push('"basedOn" is "name|source"');
    read = {
      readable: true,
      effects,
      ...(charges !== undefined ? { charges } : {}),
      drop,
      amend,
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

/**
 * The keys a class or subclass feature's built-in rows are found under: each of
 * `keys` (`roving|ranger`) for one printing first (`roving|ranger|xphb`), then
 * alone, the row for every printing. The printings are the feature's own
 * (`printing`, the official one's for a copy), then that of the class or
 * subclass whose uid is `uid`, so a 2014 subclass under a 2024 class reads its
 * own.
 */
export function printingKeys(keys: readonly string[], printing: string, uid: string): string[] {
  const at = uid.lastIndexOf('|');
  const printings = [
    ...new Set([printing, at < 0 ? '' : uid.slice(at + 1)].map((p) => p.toLowerCase())),
  ].filter((p) => p !== '');
  return keys.flatMap((k) => [...printings.map((p) => `${k}|${p}`), k]);
}

// ---------------------------------------------------------------------------
// Rule packs
// ---------------------------------------------------------------------------

interface PackChange {
  pack: string;
  effects: readonly EffectTemplate[];
  /** An item's charges, which the patch says (`ReadEffects.charges`). */
  charges?: ItemCharges | undefined;
}

interface PackPatches {
  /** Each pack's replacement, in the player's order: the last that counts wins. */
  replaces: PackChange[];
  add: PackChange[];
  /** Prices on what the entry inherits, in the player's order of packs. */
  amend: Array<{ pack: string; rules: readonly AmendRule[] }>;
}

/** A pack's patches, read: each target lowercased, and what does not count. */
export interface ReadPack {
  name: string;
  patches: Array<{
    target: string;
    replace?: EffectTemplate[];
    add?: EffectTemplate[];
    /** The item's charges its `effects` say, in place of the item's own. */
    replaceCharges?: ItemCharges;
    /** The item's charges its `add` says. */
    addCharges?: ItemCharges;
    amend?: AmendRule[];
  }>;
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
    const replace = readOwnEffects(rawReplace, 'effects');
    const add = readOwnEffects(own(p as Record<string, unknown>, 'add'), 'add');
    const amendProblems: string[] = [];
    const amend = readAmends(own(p as Record<string, unknown>, 'amend'), amendProblems);
    for (const problem of [...replace.problems, ...add.problems, ...amendProblems])
      read.problems.push(`${where}: ${problem}`);
    const replaces = patchReplaces(rawReplace, replace);
    // A replacement inherits nothing, so there is no action for a price to land on.
    // Charges alone replace an item's own and nothing on another entry, which this
    // cannot see: the sheet says it (`unpriced`) when its price finds nothing.
    const priced = !replaces || (replace.effects.length === 0 && replace.charges !== undefined);
    if (!priced && amend.length > 0) {
      read.problems.push(
        `${where}: "amend" changes nothing beside "effects", which inherit nothing`,
      );
    }
    read.patches.push({
      target: target.trim().toLowerCase(),
      ...(replaces ? { replace: replace.effects } : {}),
      ...(add.effects.length > 0 ? { add: add.effects } : {}),
      ...(replaces && replace.charges !== undefined ? { replaceCharges: replace.charges } : {}),
      ...(add.charges !== undefined ? { addCharges: add.charges } : {}),
      // Said once above; the sheet would say it again for each price.
      ...(amend.length > 0 && priced ? { amend } : {}),
    });
  });
  return read;
}

/**
 * A list read as an entry's own effects (`effects`, or a pack's patch's
 * `effects` or `add`): an item's charges among them, which a Workshop item's
 * list holds too.
 */
export function readOwnEffects(raw: unknown, field: 'effects' | 'add'): ReadEffects {
  return readStoredEffects(raw, field, OWN_EFFECTS);
}

/**
 * Whether a patch's `effects`, read (`readOwnEffects`), replace the entry's
 * own. An empty list replaces them with nothing, on purpose; a list none of
 * which can be read (no effect, no charges) replaces nothing, so the entry
 * keeps its own.
 */
export function patchReplaces(raw: unknown, read: ReadEffects): boolean {
  return (
    Array.isArray(raw) &&
    (raw.length === 0 || read.effects.length > 0 || read.charges !== undefined)
  );
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
      const slot = index.get(patch.target) ?? { replaces: [], add: [], amend: [] };
      index.set(patch.target, slot);
      if (patch.replace !== undefined) {
        slot.replaces.push({
          pack: pack.name,
          effects: patch.replace,
          charges: patch.replaceCharges,
        });
      }
      if (patch.add !== undefined || patch.addCharges !== undefined) {
        slot.add.push({ pack: pack.name, effects: patch.add ?? [], charges: patch.addCharges });
      }
      if (patch.amend !== undefined) slot.amend.push({ pack: pack.name, rules: patch.amend });
    }
  }
  return index;
}

/**
 * The charges the packs applied to a character say for the entry under
 * `target` (an item's `name|source`), as `mechanicsOf` applies their patches:
 * the replacement's (a later pack's wins), else the last addition's that says
 * them. `replaced`: a pack replaces the entry's own effects, its own charges
 * among them. Read outside a derive too (`itemChargesOf`), so it says no problem.
 */
export function packChargesOf(
  packs: readonly DataEntity[],
  characterId: string,
  target: string,
): { charges?: ItemCharges; replaced: boolean } {
  const key = target.toLowerCase();
  let replaced = false;
  let replace: ItemCharges | undefined;
  let add: ItemCharges | undefined;
  for (const entry of packs) {
    if (!appliesTo(entry, characterId)) continue;
    for (const patch of readPack(entry).patches) {
      if (patch.target !== key) continue;
      if (patch.replace !== undefined) {
        replaced = true;
        replace = patch.replaceCharges;
      }
      if (patch.addCharges !== undefined) add = patch.addCharges;
    }
  }
  const charges = replace ?? add;
  return { ...(charges === undefined ? {} : { charges }), replaced };
}

// ---------------------------------------------------------------------------
// Built-in rule sets
// ---------------------------------------------------------------------------

/** The part a built-in row belongs to (`RULE_SET_PARTS`). */
export type RulePart = (typeof RULE_SET_PARTS)[number];

/** Whether a built-in row turns the prose scan off for its entry (`replace`) or runs beside it. */
export type RuleScan = (typeof RULE_SET_SCANS)[number];

/** One built-in row, read. */
export interface RuleRow {
  part: RulePart;
  /** Lowercased, as the part's call sites look rows up. */
  keys: readonly string[];
  /** Only a `curated` row may turn the scan off; every other part's runs beside it: `keep`. */
  scan: RuleScan;
  /** Every part but `curated`: the feature level it counts at alone. */
  level?: number;
  /** Every part but `spend`, `charges` and `spellRest`, whose rows emit none. */
  effects: readonly EffectTemplate[];
  /** `spend` rows only: the prices it puts on the feature's actions, in order. */
  links?: readonly SpendLinkRow[];
  /** `wornTags` rows only: the kinds of the item's data tags its effects stand in for. */
  replaces?: readonly WornTagKind[];
  /** `charges` rows only: the charges the item casts spells with. */
  charges?: ItemCharges;
  /** `spellRest` rows only: the origin's spell pools that come back on a short rest. */
  shortRest?: ShortRestSpells;
  /** `itemDc` rows only: what the item's spells cast with. */
  itemDc?: FixedCast;
  /** `itemSpells` rows only: what the item casts without its charges, as its data writes it. */
  itemSpells?: StoredItemSpellLists;
}

/**
 * The save DC and spell attack bonus an item's text fixes for every spell it
 * casts (an `itemDc` row, a `charges` effect's), each absent where it fixes none.
 */
export interface FixedCast {
  dc?: number;
  attack?: number;
}

/**
 * A `spellRest` row, read: the spells whose pool from the origin comes back on
 * a short rest, each by its name in lower case, once, or `every` pool it grants.
 */
export interface ShortRestSpells {
  spells: 'every' | readonly string[];
}

/** A kind of what an item's data tags give while worn (`WORN_TAG_KINDS`). */
export type WornTagKind = (typeof WORN_TAG_KINDS)[number];

/**
 * What a carried item's charges hold, regain and cast, read: a built-in
 * `charges` row, or an item's own `charges` effect (`ReadEffects.charges`).
 */
export interface ItemCharges {
  charges: number;
  /**
   * What comes back at dawn (a long rest): dice or a whole number, rolled;
   * `all`; or `none`, never. With `rest`, what a short rest gives back: `all`,
   * a whole number (and all of them on a long rest) or `none`.
   */
  regain: string;
  /** An item's own effect, or its fields, only: they come back on a short rest (`StoredItemCharges.rest`). */
  rest?: 'short';
  /** Each spell by its name in lower case, once. */
  spells: readonly ChargeSpell[];
  /** An item's own effect only: the ability the spells it grants cast with. */
  ability?: Ability;
  /**
   * The save DC and attack bonus its spells cast with: an item's own effect's,
   * or for a built-in row's or the fields' charges the item's `itemDc` row's.
   */
  dc?: number;
  attack?: number;
}

/** One spell an item's charges cast (`StoredChargeSpell`), read. */
export interface ChargeSpell {
  /** Its name in lower case: any printing of it casts from the item. */
  spell: string;
  cost: number;
  upTo?: number;
  /** The one level it casts at for `cost`, in place of its own (`StoredChargeSpell.at`). */
  at?: number;
  /**
   * The spell the item grants: by name and book (an item's own effect's, a
   * field naming one), or by name with no book (`source` empty), which the
   * sheet finds in the character's rules version.
   */
  ref?: EntityRef;
}

/** A built-in rule set (`RULE_SET_TYPE` entry), read. */
export interface ReadRuleSet {
  name: string;
  edition?: (typeof RULE_SET_EDITIONS)[number];
  rows: RuleRow[];
  problems: string[];
}

const RULE_SETS = new WeakMap<object, ReadRuleSet>();

/** A built-in rule set, read once per object. Never throws. */
export function readRuleSet(raw: unknown): ReadRuleSet {
  if (!isRecord(raw)) return { name: 'A rule set', rows: [], problems: ['is not a rule set'] };
  const cached = RULE_SETS.get(raw);
  if (cached !== undefined) return cached;
  const read = readRuleSetOnce(raw);
  RULE_SETS.set(raw, read);
  return read;
}

const isOneOf = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);

/**
 * The fields a rule set and each part's rows have. The app's own files are read
 * strictly: a field the reader does not know is a problem, which their tests
 * fail on, so a row written for a field not built yet is never read without it.
 */
const SET_FIELDS: ReadonlySet<string> = new Set(['type', 'v', 'name', 'edition', 'rows']);
const LEVEL_ROW: ReadonlySet<string> = new Set(['part', 'keys', 'level', 'effects']);
const ROW_FIELDS: Record<RulePart, ReadonlySet<string>> = {
  curated: new Set(['part', 'keys', 'scan', 'effects']),
  standing: LEVEL_ROW,
  rollAdvantage: LEVEL_ROW,
  rollExtra: LEVEL_ROW,
  spend: new Set(['part', 'keys', 'links']),
  wornTags: new Set(['part', 'keys', 'replaces', 'effects']),
  charges: new Set(['part', 'keys', 'charges', 'regain', 'spells']),
  spellRest: new Set(['part', 'keys', 'spells']),
  itemDc: new Set(['part', 'keys', 'dc', 'attack']),
  itemSpells: new Set(['part', 'keys', 'spells']),
};

const isFeatureLevel = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= RULE_SET_LIMITS.level;

function readRuleSetOnce(raw: Record<string, unknown>): ReadRuleSet {
  const named = own(raw, 'name');
  const name = typeof named === 'string' && named.trim() !== '' ? clip(named.trim()) : 'A rule set';
  const read: ReadRuleSet = { name, rows: [], problems: [] };
  if (own(raw, 'type') !== RULE_SET_TYPE) {
    read.problems.push(`"type" is "${RULE_SET_TYPE}"`);
    return read;
  }
  const version = guidanceVersion(raw);
  if ('problem' in version) {
    read.problems.push(version.problem);
    return read;
  }
  for (const key of Object.keys(raw)) {
    if (!SET_FIELDS.has(key)) read.problems.push(`"${clip(key)}" is not a field a rule set has`);
  }
  const edition = own(raw, 'edition');
  if (isOneOf(RULE_SET_EDITIONS, edition)) read.edition = edition;
  else if (edition !== undefined) read.problems.push('"edition" is "2014", "2024" or "both"');
  const rows = own(raw, 'rows');
  if (!Array.isArray(rows)) {
    read.problems.push('"rows" is not a list');
    return read;
  }
  if (rows.length > RULE_SET_LIMITS.rowsPerSet) {
    read.problems.push(`only the first ${RULE_SET_LIMITS.rowsPerSet} rows count`);
  }
  // Keys already taken, by part: a second row under one is left out.
  const taken = new Map<RulePart, Set<string>>();
  rows.slice(0, RULE_SET_LIMITS.rowsPerSet).forEach((row, i) => {
    const where = `row ${i + 1}`;
    if (!isRecord(row)) {
      read.problems.push(`${where}: is not a row`);
      return;
    }
    const part = own(row, 'part');
    if (!isOneOf(RULE_SET_PARTS, part)) {
      read.problems.push(`${where}: has no part "${clip(part)}"`);
      return;
    }
    // A field the reader does not know would change what the row means unseen,
    // so the row is left out rather than read without it.
    const extra = Object.keys(row).find((k) => !ROW_FIELDS[part].has(k));
    if (extra !== undefined) {
      read.problems.push(`${where}: "${clip(extra)}" is not a field a ${part} row has`);
      return;
    }
    // Only a curated row has a `scan` field: every other part's always runs beside the scan.
    const scan = part === 'curated' ? (own(row, 'scan') ?? 'replace') : 'keep';
    if (!isOneOf(RULE_SET_SCANS, scan)) {
      read.problems.push(`${where}: "scan" is "replace" or "keep"`);
      return;
    }
    const level = own(row, 'level');
    if (level !== undefined && !isFeatureLevel(level)) {
      read.problems.push(`${where}: "level" is a feature level, 1 to ${RULE_SET_LIMITS.level}`);
      return;
    }
    // A key is taken once per level: rows of one key at other levels are features of one name.
    const slot = (key: string) => (level === undefined ? key : `${key} @${level}`);
    const rawKeys = own(row, 'keys');
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
      read.problems.push(`${where}: "keys" lists the keys it is found under`);
      return;
    }
    if (rawKeys.length > RULE_SET_LIMITS.keysPerRow) {
      read.problems.push(`${where}: only the first ${RULE_SET_LIMITS.keysPerRow} keys count`);
    }
    const inPart = taken.get(part) ?? new Set<string>();
    taken.set(part, inPart);
    const keys: string[] = [];
    for (const k of rawKeys.slice(0, RULE_SET_LIMITS.keysPerRow)) {
      if (typeof k !== 'string' || k.trim() === '' || k.length > L.targetLength) {
        read.problems.push(`${where}: a key is a name, as "stunning strike|monk"`);
        continue;
      }
      const key = k.trim().toLowerCase();
      if (inPart.has(slot(key)) || keys.includes(key)) {
        read.problems.push(`${where}: "${clip(slot(key))}" is already a row`);
        continue;
      }
      keys.push(key);
    }
    if (keys.length === 0) return;
    const at = `${where} (${clip(keys[0])})`;
    if (part === 'spend') {
      const raw = own(row, 'links');
      if (!Array.isArray(raw) || raw.length === 0) {
        read.problems.push(`${at}: "links" lists the prices it puts on the action`);
        return;
      }
      for (const key of keys) inPart.add(slot(key));
      const { links, problems } = readSpendLinks(raw);
      for (const problem of problems) read.problems.push(`${at}: ${problem}`);
      read.rows.push({ part, keys, scan, effects: [], links });
      return;
    }
    if (part === 'charges') {
      const held = readCharges(row, false);
      for (const problem of held.problems) read.problems.push(`${at}: ${problem}`);
      // A row that cannot say what each spell costs would price the item's
      // charges wrong in the cast prompt: it is left out, and its keys stay free.
      if (held.charges === undefined) return;
      for (const key of keys) inPart.add(slot(key));
      read.rows.push({ part, keys, scan, effects: [], charges: held.charges });
      return;
    }
    if (part === 'spellRest') {
      const rest = readRestSpells(own(row, 'spells'));
      for (const problem of rest.problems) read.problems.push(`${at}: ${problem}`);
      // A row that cannot say which pools come back would leave one on a long
      // rest, or bring one back early, unseen: it is left out, and its keys stay free.
      if (rest.spells === undefined) return;
      for (const key of keys) inPart.add(slot(key));
      read.rows.push({ part, keys, scan, effects: [], shortRest: { spells: rest.spells } });
      return;
    }
    if (part === 'itemDc') {
      const fixed = readFixedCast(row);
      for (const problem of fixed.problems) read.problems.push(`${at}: ${problem}`);
      // A row that misreads a number would cast the item's spells at the wrong
      // DC unseen: it is left out, and its keys stay free.
      if (fixed.problems.length > 0) return;
      if (fixed.dc === undefined && fixed.attack === undefined) {
        read.problems.push(`${at}: says a "dc", an "attack", or both`);
        return;
      }
      for (const key of keys) inPart.add(slot(key));
      read.rows.push({ part, keys, scan, effects: [], itemDc: fixedOf(fixed) });
      return;
    }
    if (part === 'itemSpells') {
      const lists = readItemSpellLists(own(row, 'spells'));
      for (const problem of lists.problems) read.problems.push(`${at}: ${problem}`);
      // A row that misreads a list would grant the item's spells wrong unseen:
      // it is left out, and its keys stay free.
      if (lists.spells === undefined) return;
      for (const key of keys) inPart.add(slot(key));
      read.rows.push({ part, keys, scan, effects: [], itemSpells: lists.spells });
      return;
    }
    if (!Array.isArray(own(row, 'effects'))) {
      read.problems.push(`${at}: "effects" is not a list`);
      return;
    }
    // Only a row that counts takes its keys, so a later one may still have them.
    for (const key of keys) inPart.add(slot(key));
    const { effects, problems } = readStoredEffects(own(row, 'effects'), 'effects', {
      strict: true,
      builtIn: true,
      inPick: false,
    });
    for (const problem of problems) read.problems.push(`${at}: ${problem}`);
    if (part === 'wornTags') {
      const written = (own(row, 'effects') as unknown[]).length;
      const replaces = readReplaces(own(row, 'replaces'), effects, written);
      for (const problem of replaces.problems) read.problems.push(`${at}: ${problem}`);
      // A row that cannot say what it stands in for would leave tags in place, or
      // take them out, unseen: it is left out, and its keys stay free.
      if (replaces.kinds === undefined) for (const key of keys) inPart.delete(slot(key));
      else read.rows.push({ part, keys, scan, effects, replaces: replaces.kinds });
      return;
    }
    read.rows.push({
      part,
      keys,
      scan,
      ...(level === undefined ? {} : { level }),
      effects,
    });
  });
  return read;
}

/**
 * A `wornTags` row's `replaces`: a list of distinct `WORN_TAG_KINDS`, which
 * every one of its effects is of. `kinds` is absent when the row cannot count,
 * as when an effect of its `written` ones could not be read: what it gives of a
 * kind would be less than it says, and the item would lose that tag unseen.
 */
function readReplaces(
  raw: unknown,
  effects: readonly EffectTemplate[],
  written: number,
): { kinds?: WornTagKind[]; problems: string[] } {
  const named = `"replaces" lists kinds of tag: ${WORN_TAG_KINDS.join(', ')}`;
  if (!Array.isArray(raw) || raw.length === 0) return { problems: [named] };
  const kinds: WornTagKind[] = [];
  const problems: string[] = [];
  for (const k of raw) {
    if (!isOneOf(WORN_TAG_KINDS, k))
      problems.push(`"replaces": "${clip(k)}" is not a kind of tag (${WORN_TAG_KINDS.join(', ')})`);
    else if (kinds.includes(k)) problems.push(`"replaces" names "${k}" twice`);
    else kinds.push(k);
  }
  for (const t of effects) {
    const kind = t.effect.kind;
    if (!isOneOf(WORN_TAG_KINDS, kind))
      problems.push(`an effect of kind "${kind}" is not a kind of tag it can replace`);
    else if (!kinds.includes(kind))
      problems.push(`gives a "${kind}" but does not replace that kind`);
  }
  if (effects.length < written) problems.push('an effect it cannot read would take a tag away');
  return problems.length > 0 ? { problems } : { kinds, problems };
}

const CHARGE_SPELL_FIELDS: ReadonlySet<string> = new Set(['spell', 'cost', 'upTo', 'at']);
const isWhole = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * The `dc` and `attack` an `itemDc` row or a `charges` effect says, each a
 * whole number in its range (`RULE_SET_LIMITS`), or absent.
 */
function readFixedCast(raw: Record<string, unknown>): FixedCast & { problems: string[] } {
  const problems: string[] = [];
  const dc = own(raw, 'dc');
  if (dc !== undefined && !isWhole(dc, 1, RULE_SET_LIMITS.dc)) {
    problems.push(`"dc" is the save DC its spells cast with, 1 to ${RULE_SET_LIMITS.dc}`);
  }
  const attack = own(raw, 'attack');
  if (attack !== undefined && !isWhole(attack, 0, RULE_SET_LIMITS.attack)) {
    problems.push(
      `"attack" is the spell attack bonus its spells cast with, 0 to ${RULE_SET_LIMITS.attack}`,
    );
  }
  return {
    problems,
    ...(isWhole(dc, 1, RULE_SET_LIMITS.dc) ? { dc } : {}),
    ...(isWhole(attack, 0, RULE_SET_LIMITS.attack) ? { attack } : {}),
  };
}

/** A `FixedCast` without the reader's problems. */
const fixedOf = ({ dc, attack }: FixedCast): FixedCast => ({
  ...(dc === undefined ? {} : { dc }),
  ...(attack === undefined ? {} : { attack }),
});
const CHARGE_DIE = /^(\d{0,3})d(\d{1,3})$/;

/**
 * Dice a long rest can roll for charges back: a die first, then dice or whole
 * numbers added, or whole numbers taken away while the lowest roll stays at 0
 * or more (a Ring of Puzzler's Wit's 1d4-1), so the roll never gives back
 * less than nothing. Each die has 2 sides or more and a count of 1 to 100,
 * which the roller needs. Spaces and tabs are the only gaps the roller skips,
 * so any other (a non-breaking space) does not read.
 */
function regainDice(s: string): boolean {
  if (s.length > 40 || !/^[\dd+\- \t]+$/.test(s)) return false;
  const [first = '', ...rest] = s.split(/(?=[+-])/).map((t) => t.trim());
  // How many dice it rolls, or undefined when `t` is not a die.
  const dice = (t: string) => {
    const m = CHARGE_DIE.exec(t);
    const count = m === null || m[1] === '' ? 1 : Number(m[1]);
    return m !== null && count >= 1 && count <= 100 && Number(m[2]) >= 2 ? count : undefined;
  };
  const whole = (t: string) => (/^\d{1,4}$/.test(t) ? Number(t) : undefined);
  let lowest = dice(first);
  for (const t of rest) {
    if (lowest === undefined) return false;
    const term = t.slice(1).trim();
    const n = t.startsWith('+') ? (dice(term) ?? whole(term)) : -(whole(term) ?? Number.NaN);
    lowest = n === undefined || Number.isNaN(n) ? undefined : lowest + n;
  }
  return lowest !== undefined && lowest >= 0;
}

/**
 * What comes back at dawn (`ItemCharges.regain`): dice (`regainDice`), a whole
 * number from 1 to `most`, kept as its digits, which the roller rolls as a
 * number, or `all` or `none`, in any case.
 */
function readRegain(v: unknown, most: number): string | undefined {
  if (typeof v === 'number') return isWhole(v, 1, most) ? String(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const word = s.toLowerCase();
  if (word === 'all' || word === 'none') return word;
  return regainDice(s) ? s : undefined;
}

/**
 * An item's charges as its own data fields say them (`fieldChargesOf`), read as
 * an item's own `charges` effect is, so both take one grammar. Absent when the
 * effect would say a problem.
 */
export function readItemCharges(raw: Record<string, unknown>): ItemCharges | undefined {
  return readCharges(raw, true).charges;
}

/**
 * A `charges` row's numbers and spells, or an item's own `charges` effect's
 * (`effect`): each of its spells names its book (`name|source`), since the
 * item grants it, and it may name the `ability` they cast with. `charges` is
 * absent when anything in it is a problem: a spell left out, or a cost
 * misread, would offer the item's charges for less, or for nothing, unseen.
 */
function readCharges(
  row: Record<string, unknown>,
  effect: boolean,
): { charges?: ItemCharges; problems: string[] } {
  const problems: string[] = [];
  const most = RULE_SET_LIMITS.charges;
  const charges = own(row, 'charges');
  const counted = isWhole(charges, 1, most);
  if (!counted) problems.push(`"charges" is how many it holds, a whole number from 1 to ${most}`);
  // A row with a `rest` is left out before this reads it (`ROW_FIELDS`): a
  // built-in row's charges come back at dawn.
  const rested = own(row, 'rest');
  const rest = rested === 'short' ? rested : undefined;
  if (rested !== undefined && rest === undefined) {
    problems.push('"rest" is "short", for charges that come back on a short rest');
  }
  const regain = readRegain(own(row, 'regain'), counted ? charges : most);
  // A short rest rolls no dice (`shortRestRecovery`): all of them, a number, or none.
  if (rest !== undefined && (regain === undefined || regainDice(regain))) {
    problems.push(
      '"regain" on a short rest is a whole number up to its charges, "all" or "none": a short rest rolls no dice',
    );
  } else if (regain === undefined) {
    problems.push(
      '"regain" is what comes back at dawn: dice like 1d6+4, a whole number, "all" or "none"',
    );
  }
  // A row with an `ability` is left out before this reads it (`ROW_FIELDS`).
  const named = own(row, 'ability');
  const ability = isOneOf(ABILITY_LIST, named) ? named : undefined;
  if (named !== undefined && ability === undefined) {
    problems.push(`"ability" is the ability its spells cast with: ${ABILITY_LIST.join(', ')}`);
  }
  // A row with a `dc` or `attack` is left out before this reads it (`ROW_FIELDS`):
  // an item's DC is an `itemDc` row's.
  const fixed = readFixedCast(row);
  problems.push(...fixed.problems);
  // Either may cast none: an item's own counts its charges for its actions to
  // spend, and a row stands in for a list of spells cast at random (a Wand of
  // Wonder's). A row says so with an empty list.
  const listed = own(row, 'spells') ?? (effect ? [] : undefined);
  const spells: ChargeSpell[] = [];
  if (!Array.isArray(listed)) {
    problems.push('"spells" lists the spells its charges cast');
  } else if (listed.length > RULE_SET_LIMITS.chargeSpells) {
    problems.push(`"spells" lists at most ${RULE_SET_LIMITS.chargeSpells} spells`);
  } else {
    listed.forEach((x, i) => {
      const at = `spell ${i + 1}`;
      if (!isRecord(x)) {
        problems.push(`${at}: is not a spell its charges cast`);
        return;
      }
      const extra = Object.keys(x).find((k) => !CHARGE_SPELL_FIELDS.has(k));
      if (extra !== undefined) {
        problems.push(`${at}: "${clip(extra)}" is not a field a charged spell has`);
        return;
      }
      const written = own(x, 'spell');
      if (typeof written !== 'string' || written.trim() === '' || written.length > L.targetLength) {
        problems.push(`${at}: "spell" is the spell's name`);
        return;
      }
      // The item grants an effect's spells, so each names the book it is found in.
      const ref = effect ? readRef(written) : undefined;
      if (effect && ref === undefined) {
        problems.push(`${at}: "spell" is "name|source"`);
        return;
      }
      // Lower case, as the cast prompt looks a spell up, before the twice check.
      const spell = (ref?.name ?? written).trim().toLowerCase();
      if (spells.some((s) => s.spell === spell)) {
        problems.push(`${at}: "${clip(spell)}" is named twice`);
        return;
      }
      const cost = own(x, 'cost');
      if (!isWhole(cost, 1, counted ? charges : most)) {
        problems.push(
          `${at}: "cost" is the charges it takes at its own level, 1 to the item's charges`,
        );
        return;
      }
      const upTo = own(x, 'upTo');
      if (upTo !== undefined && !isWhole(upTo, 1, 9)) {
        problems.push(`${at}: "upTo" is a spell level, 1 to 9`);
        return;
      }
      const level = own(x, 'at');
      if (level !== undefined && !isWhole(level, 1, 9)) {
        problems.push(`${at}: "at" is the spell level it casts at, 1 to 9`);
        return;
      }
      // One level for its cost, or one more charge a level above its own: not both.
      if (level !== undefined && upTo !== undefined) {
        problems.push(`${at}: casts at one level ("at") or up to one ("upTo"), not both`);
        return;
      }
      spells.push({
        spell,
        cost,
        ...(upTo === undefined ? {} : { upTo }),
        ...(level === undefined ? {} : { at: level }),
        ...(ref === undefined ? {} : { ref }),
      });
    });
  }
  if (problems.length > 0 || !counted || regain === undefined) return { problems };
  return {
    charges: {
      charges,
      regain,
      ...(rest === undefined ? {} : { rest }),
      spells,
      ...(ability === undefined ? {} : { ability }),
      ...fixedOf(fixed),
    },
    problems,
  };
}

/** A count of casts an `itemSpells` list is keyed by: a number, or a number of each ("1e"). */
const CAST_COUNT = /^[1-9]\d?e?$/;

/**
 * An `itemSpells` row's `spells`: an object of `will`, a list of spell names,
 * and `daily` and `rest`, each a count (`CAST_COUNT`) to a list of names, as
 * the data writes `attachedSpells`; each name a spell (`name` or
 * `name|source`), at most `RULE_SET_LIMITS.chargeSpells` a list. `{}` casts
 * none. `spells` is absent when the row cannot count.
 */
function readItemSpellLists(raw: unknown): { spells?: StoredItemSpellLists; problems: string[] } {
  const said = '"spells" is what it casts without charges: "will", "daily" and "rest" lists';
  if (!isRecord(raw)) return { problems: [said] };
  const problems: string[] = [];
  const names = (v: unknown, where: string): string[] | undefined => {
    const ok =
      Array.isArray(v) &&
      v.length > 0 &&
      v.length <= RULE_SET_LIMITS.chargeSpells &&
      v.every((s) => typeof s === 'string' && s.trim() !== '' && s.length <= L.targetLength);
    if (!ok) {
      problems.push(
        `"${where}" lists 1 to ${RULE_SET_LIMITS.chargeSpells} spells, each by its name`,
      );
    }
    return ok ? (v as string[]) : undefined;
  };
  const spells: StoredItemSpellLists = {};
  for (const [bucket, v] of Object.entries(raw)) {
    if (bucket === 'will') {
      const listed = names(v, 'will');
      if (listed !== undefined) spells.will = listed;
    } else if (bucket === 'daily' || bucket === 'rest') {
      if (!isRecord(v) || Object.keys(v).length === 0) {
        problems.push(`"${bucket}" gives each count of casts, as "1" or "1e", its spells`);
        continue;
      }
      const counts: Record<string, string[]> = {};
      for (const [count, list] of Object.entries(v)) {
        if (!CAST_COUNT.test(count)) {
          problems.push(`"${bucket}": "${clip(count)}" is a count of casts, as "1" or "1e"`);
          continue;
        }
        const listed = names(list, `${bucket}.${count}`);
        if (listed !== undefined) counts[count] = listed;
      }
      spells[bucket] = counts;
    } else problems.push(`"${clip(bucket)}" is not a list it casts from: "will", "daily", "rest"`);
  }
  return problems.length > 0 ? { problems } : { spells, problems };
}

/**
 * A `spellRest` row's `spells`: `every`, or a list of distinct spell names, in
 * lower case as the grant compares them. `spells` is absent when the row cannot count.
 */
function readRestSpells(raw: unknown): { spells?: 'every' | string[]; problems: string[] } {
  if (raw === 'every') return { spells: 'every', problems: [] };
  if (!Array.isArray(raw) || raw.length === 0) {
    return { problems: ['"spells" is "every", or lists the spells whose pools come back'] };
  }
  if (raw.length > RULE_SET_LIMITS.restSpells) {
    return { problems: [`"spells" lists at most ${RULE_SET_LIMITS.restSpells} spells`] };
  }
  const spells: string[] = [];
  const problems: string[] = [];
  raw.forEach((named, i) => {
    if (typeof named !== 'string' || named.trim() === '' || named.length > L.targetLength) {
      problems.push(`spell ${i + 1}: is the spell's name`);
      return;
    }
    const spell = named.trim().toLowerCase();
    // `every` in a list would be read as a spell of that name, which no pool has.
    if (spell === 'every') problems.push(`spell ${i + 1}: "every" stands alone, not in a list`);
    else if (spells.includes(spell)) {
      problems.push(`spell ${i + 1}: "${clip(spell)}" is named twice`);
    } else spells.push(spell);
  });
  return problems.length > 0 ? { problems } : { spells, problems };
}

/** Rows by part, then by key: one row, or a `standing` key's rows at each level. */
type RuleIndex = Map<RulePart, Map<string, readonly RuleRow[]>>;

/** Per rule set list: the registry hands out the same list until it rebuilds. */
const RULE_INDEX = new WeakMap<object, RuleIndex>();
/** Per derive, so a context that makes a new list per call still reads it once. */
const RULE_INDEX_OF = new WeakMap<Collector, RuleIndex>();
/** Rule set objects whose problems were logged. */
const LOGGED = new WeakSet<object>();

function ruleIndexFor(col: Collector): RuleIndex {
  const known = RULE_INDEX_OF.get(col);
  if (known !== undefined) return known;
  const index = ruleIndexOf(col.ctx.byType(RULE_SET_TYPE));
  RULE_INDEX_OF.set(col, index);
  return index;
}

function ruleIndexOf(sets: readonly DataEntity[]): RuleIndex {
  const index = RULE_INDEX.get(sets) ?? buildRuleIndex(sets);
  RULE_INDEX.set(sets, index);
  return index;
}

function buildRuleIndex(sets: readonly DataEntity[]): RuleIndex {
  const index: RuleIndex = new Map();
  for (const entry of sets) {
    const set = readRuleSet(entry);
    // The app's own files: a problem is a bug in them, found by their tests, not
    // something a player can fix, so it goes to the console rather than the sheet.
    const raw: unknown = entry;
    const once = typeof raw === 'object' && raw !== null;
    if (set.problems.length > 0 && !(once && LOGGED.has(raw))) {
      if (once) LOGGED.add(raw);
      console.warn(`${set.name}: ${set.problems.join('; ')}`);
    }
    for (const row of set.rows) {
      const byKey = index.get(row.part) ?? new Map<string, readonly RuleRow[]>();
      index.set(row.part, byKey);
      // A later set's row wins over an earlier one's for the same part, key and level.
      for (const key of row.keys) {
        byKey.set(key, [...(byKey.get(key) ?? []).filter((r) => r.level !== row.level), row]);
      }
    }
  }
  return index;
}

/**
 * The built-in row of `part` found under the first of `keys` that has one: the
 * first key with a row wins. For a part whose rows name no level (`curated`).
 */
export function builtInRuleFor(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
): RuleRow | undefined {
  return firstRows(ruleIndexFor(col), part, keys)?.[0];
}

/**
 * `builtInRuleFor` over a list of rule sets rather than a derive's context: for
 * the audit, which asks whether a row stands in for an entry's prose scan.
 */
export function builtInRuleIn(
  sets: readonly DataEntity[],
  part: RulePart,
  keys: readonly string[],
): RuleRow | undefined {
  return firstRows(ruleIndexOf(sets), part, keys)?.[0];
}

/**
 * Every built-in row of `part` under the first of `keys` that has any, at any
 * level, found as `builtInRuleFor` finds one. A key whose rows are all at other
 * levels is still found, so a feature its row skips gets none, and the call
 * site never goes on to a later key.
 */
export function builtInRowsFor(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
): readonly RuleRow[] | undefined {
  return firstRows(ruleIndexFor(col), part, keys);
}

/**
 * Emit built-in rows of a part that adds beside the prose scan (`standing`,
 * `rollAdvantage`, `rollExtra`): each row with no level, or at `featureLevel`,
 * with `origin` itself. `classLevel` is what their
 * formulas read as the class's level; the character's level when absent, as
 * `mechanicsOf` reads it. `className` is the class that gives them
 * (`MechanicsSubject.className`).
 */
export function emitRuleRows(
  col: Collector,
  rows: readonly RuleRow[],
  origin: EffectOrigin,
  featureLevel?: number,
  classLevel?: number,
  className?: string,
): void {
  for (const row of rows) {
    if (row.level === undefined || row.level === featureLevel) {
      emit(col, row.effects, origin, classLevel ?? characterLevel(col), className, true);
    }
  }
}

/** Where a call site emits a part's built-in rows: the levels, and the class that gives them. */
export interface RuleRowsAt {
  featureLevel?: number;
  classLevel?: number;
  /** The class that gives them (`MechanicsSubject.className`). */
  className?: string;
}

/**
 * Emit the built-in rows of `part` under the first of `keys` with any
 * (`builtInRowsFor`), as `emitRuleRows` does. Says whether a key had rows.
 */
export function emitBuiltInRows(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
  origin: EffectOrigin,
  at: RuleRowsAt = {},
): boolean {
  const rows = builtInRowsFor(col, part, keys);
  if (rows === undefined) return false;
  emitRuleRows(col, rows, origin, at.featureLevel, at.classLevel, at.className);
  return true;
}

const characterLevel = (col: Collector): number =>
  col.doc.classes.reduce((sum, c) => sum + c.levels, 0);

function firstRows(
  index: RuleIndex,
  part: RulePart,
  keys: readonly string[],
): readonly RuleRow[] | undefined {
  const byKey = index.get(part);
  if (byKey === undefined) return undefined;
  for (const k of keys) {
    const rows = byKey.get(k.toLowerCase());
    if (rows !== undefined) return rows;
  }
  return undefined;
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
  /**
   * The class that gives it, by the character's name for it: the class walked
   * for a class's or subclass's feature, the host class for an optional
   * feature it offers. What `"ownClass": true` reads (`forClass`). Absent for
   * anything else (a feat, a species trait, an item).
   */
  className?: string;
  /**
   * The keys its curated row is found under, in the order the call site tries
   * them: a built-in rule set's `curated` row under the first of them that has
   * one is its curated row (layer 3). Absent: none is looked for.
   */
  ruleKeys?: readonly string[];
  /**
   * What a `pick-` pick's id starts with in place of `<origin type>:<origin
   * uid>`: a feat's instance (`feat:<uid>:<instance>`), so each copy of a
   * repeatable feat asks its own, and removing a feat clears its answers.
   */
  pickBase?: string;
  /**
   * Layer 3: what it inherits, which the call site knows how to collect.
   * `builtIn` is the built-in curated row found for `ruleKeys`, already
   * emitted: the call site then skips its prose scan when the row says
   * `replace`.
   */
  inherited?: (builtIn: BuiltInHit | undefined) => void;
}

/** What a call site needs to know of the built-in row `mechanicsOf` emitted for it. */
export interface BuiltInHit {
  scan: RuleScan;
}

const labelOf = (e: EffectInput): string | undefined =>
  'label' in e && typeof e.label === 'string' ? e.label.toLowerCase() : undefined;

function emit(
  col: Collector,
  templates: readonly EffectTemplate[],
  origin: EffectOrigin,
  classLevel: number,
  className: string | undefined,
  builtIn = false,
  pickBase?: string,
): void {
  // An effect of one rules version alone counts as though it were not there under
  // the other. A character with none, or one this app does not know, plays 2014,
  // as the sheet reads it everywhere (`asWritten`).
  const version = col.doc.rulesVersion === '2024' ? '2024' : '2014';
  const live = templates.filter((t) => t.edition === undefined || t.edition === version);
  const cls = ownClassOf(col, live, className);
  const counted = countedByClass(live, cls);
  for (const t of live) {
    if (t.pick !== undefined) {
      // Asked here, in the order the effects are written; its answers' effects follow.
      const emitGiven = (given: readonly EffectTemplate[]) =>
        emit(col, given, origin, classLevel, className, builtIn, pickBase);
      askPick(
        col,
        t.pick,
        {
          origin,
          classLevel,
          className,
          emit: emitGiven,
          ...(pickBase === undefined ? {} : { base: pickBase }),
        },
        basedOn,
      );
      continue;
    }
    if (counted.has(t)) continue;
    const named = forClass(namedFor(t, origin.label), cls);
    if (named === undefined) continue;
    // A fresh copy each time: fold time fills its numbers in place.
    const e = { ...structuredClone(named.effect), origin } as EffectInput;
    fillLevelWords(e as unknown as Record<string, unknown>, named, classLevel);
    if (!fillAnswerWords(col, e as unknown as Record<string, unknown>, named, origin, pickBase)) {
      continue;
    }
    classNamed(col, e as unknown as Record<string, unknown>, t, cls);
    if (t.formulas !== undefined) {
      e.formulas = t.formulas.map((f) => ({
        field: f.field,
        formula: f.formula,
        classLevel,
        ...(builtIn ? { builtIn: true } : {}),
      }));
    }
    if (t.while !== undefined) e.while = t.while;
    if (e.kind === 'sense') moreSense(col, e);
    col.add(e);
  }
}

/**
 * A sense that is `orMore` than the same sense held so far (Umbral Sight:
 * darkvision 60, or 60 more than you have), from any origin or, with
 * `orMoreFrom`, from the species alone. The fields go; the range stays.
 */
function moreSense(col: Collector, e: Extract<EffectInput, { kind: 'sense' }>): void {
  const stored = e as unknown as Record<string, unknown>;
  const more = stored.orMore;
  const from = stored.orMoreFrom;
  delete stored.orMore;
  delete stored.orMoreFrom;
  if (typeof more !== 'number') return;
  let had = 0;
  for (const x of col.effects) {
    if (x.kind !== 'sense' || x.sense.toLowerCase() !== e.sense.toLowerCase()) continue;
    if (from !== undefined && x.origin.type !== from) continue;
    had = Math.max(had, x.range);
  }
  if (had > 0) e.range = had + more;
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
  // An item's charges are read where its pool is made (`itemChargesOf`), never here.
  const holds = s.origin.type === 'item';
  if (!holds) {
    const why = 'only an item holds charges, so its "charges" effect counts for nothing';
    if (mine?.charges !== undefined) col.warn(`${s.label}: ${why}`);
    for (const change of [...(patches?.replaces ?? []), ...(patches?.add ?? [])]) {
      if (change.charges !== undefined) col.warn(`${change.pack}: ${s.label}: ${why}`);
    }
  }
  // A later pack's replacement wins over an earlier one's. On what holds no
  // charges, a list of charges alone is a list none of whose effects counts,
  // so it replaces nothing.
  const replace = patches?.replaces.findLast(
    (c) => holds || c.effects.length > 0 || c.charges === undefined,
  );
  const level = s.classLevel ?? characterLevel(col);

  if (replace !== undefined) {
    emit(
      col,
      replace.effects,
      { ...s.origin, pack: replace.pack },
      level,
      s.className,
      false,
      s.pickBase,
    );
  }
  for (const add of patches?.add ?? [])
    emit(col, add.effects, { ...s.origin, pack: add.pack }, level, s.className, false, s.pickBase);
  const self = mine?.readable === true ? mine : undefined;
  if (replace !== undefined) {
    unpriced(col, s, self, patches);
    return;
  }

  if (self !== undefined) {
    emit(col, self.effects, { ...s.origin }, level, s.className, false, s.pickBase);
  }
  if (self?.replace === true) {
    unpriced(col, s, self, patches);
    return;
  }
  const from = col.effects.length;
  // The built-in curated row is inherited: after `from`, so the entry's `drop`
  // reaches it, and with the subject's own origin, which spend links find its
  // action by.
  const row = s.ruleKeys === undefined ? undefined : builtInRuleFor(col, 'curated', s.ruleKeys);
  if (row !== undefined) emit(col, row.effects, s.origin, level, s.className, true, s.pickBase);
  s.inherited?.(row === undefined ? undefined : { scan: row.scan });
  if (self !== undefined && self.drop.length > 0) {
    for (let i = col.effects.length - 1; i >= from; i--) {
      const e = col.effects[i] as EffectInput;
      const label = labelOf(e);
      const dropped = self.drop.some(
        (d) => d.kind === e.kind && (d.label === undefined || d.label.toLowerCase() === label),
      );
      if (dropped) col.effects.splice(i, 1);
    }
  }
  // What is left of what it inherits takes the player's prices: the entry's
  // own, then each pack's in the player's order, so a later one wins.
  for (const rule of self?.amend ?? []) amendInherited(col, from, rule, s.label);
  for (const { pack, rules } of patches?.amend ?? [])
    for (const rule of rules) amendInherited(col, from, rule, `${pack}: ${s.label}`);
}

/**
 * An entry whose inherited mechanics are replaced (a pack's `effects`, its own
 * `replace`) has no action for a price to land on: each `amend` says so. A
 * pack's own `effects` beside its `amend` is said once, as the pack is read.
 */
function unpriced(
  col: Collector,
  s: MechanicsSubject,
  self: ReadMechanics | undefined,
  patches: PackPatches | undefined,
): void {
  const why = '"amend" finds no action it inherits: what it inherits is replaced';
  for (const _ of self?.amend ?? []) col.warn(`${s.label}: ${why}`);
  for (const { pack, rules } of patches?.amend ?? [])
    for (const _ of rules) col.warn(`${pack}: ${s.label}: ${why}`);
}

/** Actions whose buy-back a player set (`amend`), which a later feature's link leaves alone. */
const PLAYER_BUY_BACK = new WeakSet<object>();

/** Whether a player's `amend` set this action's buy-back. */
export function playerBuyBack(e: object): boolean {
  return PLAYER_BUY_BACK.has(e);
}

/**
 * One player's price on the actions an entry inherits: those collected from
 * `from` on, so never an action its author or a pack wrote, which come before.
 * Without a label, its first; with one, each of that name. Says so on the
 * sheet when there is none, or when a new amount has no pool price to change
 * (a spell slot's, a Hit Point Die's, or none: a scanned chip spending its own use).
 */
function amendInherited(col: Collector, from: number, rule: AmendRule, who: string): void {
  const name = rule.label?.toLowerCase();
  let found = false;
  for (let i = from; i < col.effects.length; i++) {
    const e = col.effects[i] as EffectInput;
    if (e.kind !== 'action' || (name !== undefined && labelOf(e) !== name)) continue;
    found = true;
    const cost = rule.cost;
    if (cost !== undefined && 'resource' in cost) e.cost = structuredClone(cost);
    else if (cost !== undefined) {
      const now = e.cost;
      if (now !== undefined && now.resource !== SLOT_COST && now.resource !== HIT_DIE_COST)
        e.cost = { ...now, amount: cost.amount };
      else
        col.warn(
          `${who}: "amend" sets how many uses of its pool it spends, and ${e.label} has no pool price`,
        );
    }
    if (rule.buyBack !== undefined) {
      e.buyBack = structuredClone(rule.buyBack);
      PLAYER_BUY_BACK.add(e);
    }
    if (name === undefined) break;
  }
  if (!found) {
    const named = rule.label === undefined ? '' : ` named "${rule.label}"`;
    col.warn(`${who}: "amend" finds no action it inherits${named}`);
  }
}
