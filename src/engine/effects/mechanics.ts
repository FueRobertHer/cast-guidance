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
 *    under the subject's `ruleKeys` is its curated row, in place of `CURATED`.
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
} from '../castGuidance';
import { type Formula, readAmount } from '../formula';
import { SPELL_SCHOOLS } from '../spellQuery';
import {
  ACTIVE_PART_KINDS,
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
import { printingOf, reskinOf } from './reskin';

type Kind = EffectInput['kind'];

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

/** One stored effect, read: the engine's fields, its formulas and its states. */
export interface EffectTemplate {
  /** The effect without `origin`, which the collector adds. */
  effect: Readonly<Record<string, unknown>> & { kind: Kind };
  formulas?: ReadonlyArray<{ field: FormulaField; formula: Formula }>;
  /** Its words by class level; the effect holds the first row's until it is emitted. */
  byLevel?: readonly LevelWords[];
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
  /** Words by class level, filled when the effect is emitted (`byLevelWords`). */
  words?: LevelWords[];
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
const actionCost: Field = (v, r, key) =>
  paidWith(
    record({
      resource: [text(), true],
      amount: [(x, rr, k) => (x === 'varies' ? x : int(0, 999)(x, rr, k)), true],
      optional: [flag],
      ownUseToo: [flag],
      minLevel: [int(1, 9)],
      pactOnly: [flag],
      slotDice: [slotDice],
      slotRefills: [text()],
      hitDieHeals: [oneOf('roll', 'rollPlusCon')],
      hitDieAtLeast: [int(1, 99)],
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
  ...opt(o, r, 'note', byLevelWords(text(L.textLength))),
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
      ...opt(o, r, 'weaponsOnly', flag),
    }),
  ],
  [
    'spellDcBonus',
    (o, r) => ({ amount: req(o, r, 'amount', amount), ...opt(o, r, 'className', text()) }),
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
      };
    },
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

function readEffect(raw: unknown, strict: boolean): EffectTemplate {
  if (!isRecord(raw)) throw new Bad('is not an effect');
  const kind = own(raw, 'kind');
  const build = typeof kind === 'string' ? KINDS.get(kind as Kind) : undefined;
  if (build === undefined) throw new Bad(`has no kind "${clip(kind)}"`);
  const r: Reading = { kind: kind as Kind, slots: [], ...(strict ? { seen: new Map() } : {}) };
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
    ...states,
    ...edition,
  };
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
  strict = false,
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
      effects.push(readEffect(x, strict));
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

/**
 * The keys a class or subclass feature's built-in rows are found under: each of
 * `keys` (`roving|ranger`) for one printing first (`roving|ranger|xphb`), then
 * alone, the row for every printing. The printings are the feature's own
 * (`printing`, the official one's for a copy), then that of the class or
 * subclass whose uid is `uid`, so a 2014 subclass under a 2024 class reads its
 * own, as `CURATED` rows test the printing in code.
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
// Built-in rule sets
// ---------------------------------------------------------------------------

/** The code table a built-in row stands in for (`RULE_SET_PARTS`). */
export type RulePart = (typeof RULE_SET_PARTS)[number];

/** Whether a built-in row turns the prose scan off for its entry (`replace`) or runs beside it. */
export type RuleScan = (typeof RULE_SET_SCANS)[number];

/** One built-in row, read. */
export interface RuleRow {
  part: RulePart;
  /** Lowercased, as the part's code table keys its rows. */
  keys: readonly string[];
  /** Only a `curated` row may turn the scan off; every other part's runs beside it: `keep`. */
  scan: RuleScan;
  /** Every part but `curated`: the feature level it counts at alone. */
  level?: number;
  effects: readonly EffectTemplate[];
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
    if (!Array.isArray(own(row, 'effects'))) {
      read.problems.push(`${at}: "effects" is not a list`);
      return;
    }
    // Only a row that counts takes its keys, so a later one may still have them.
    for (const key of keys) inPart.add(slot(key));
    const { effects, problems } = readStoredEffects(own(row, 'effects'), 'effects', true);
    for (const problem of problems) read.problems.push(`${at}: ${problem}`);
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
 * The built-in row of `part` found under the first of `keys` that has one, as
 * the part's code table is tried today: the first key with a row wins. While
 * rows are moving out of code, `inCode` says which keys the code table still
 * has a row under, and the walk stops at the first of those, so a built-in row
 * under a later key never takes the place of a code row under an earlier one.
 * For a part whose rows name no level (`curated`).
 */
export function builtInRuleFor(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
  inCode?: (key: string) => boolean,
): RuleRow | undefined {
  return firstRows(ruleIndexFor(col), part, keys, inCode)?.[0];
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
 * levels is still found, as `STANDING` answers for a feature its row skips, so
 * the call site never goes on to a later key.
 */
export function builtInRowsFor(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
  inCode?: (key: string) => boolean,
): readonly RuleRow[] | undefined {
  return firstRows(ruleIndexFor(col), part, keys, inCode);
}

/**
 * Emit built-in rows where the code table they stand in for runs (`STANDING`,
 * the roll tables): each row with no level, or at `featureLevel`, with `origin`
 * itself. `classLevel` is what their formulas read as the class's level; the
 * character's level when absent, as `mechanicsOf` reads it. `className` is the
 * class that gives them (`MechanicsSubject.className`).
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

/** Where a call site emits a part's built-in rows: the levels and the code table it still reads. */
export interface RuleRowsAt {
  featureLevel?: number;
  classLevel?: number;
  /** The class that gives them (`MechanicsSubject.className`). */
  className?: string;
  /** The keys the part's code table still has a row under (`builtInRowsFor`). */
  inCode?: (key: string) => boolean;
}

/**
 * Emit the built-in rows of `part` under the first of `keys` with any
 * (`builtInRowsFor`), as `emitRuleRows` does. Says whether a key had rows, so
 * the call site reads the code table only when none did.
 */
export function emitBuiltInRows(
  col: Collector,
  part: RulePart,
  keys: readonly string[],
  origin: EffectOrigin,
  at: RuleRowsAt = {},
): boolean {
  const rows = builtInRowsFor(col, part, keys, at.inCode);
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
  inCode?: (key: string) => boolean,
): readonly RuleRow[] | undefined {
  const byKey = index.get(part);
  if (byKey === undefined) return undefined;
  for (const k of keys) {
    const key = k.toLowerCase();
    const rows = byKey.get(key);
    if (rows !== undefined) return rows;
    if (inCode?.(key) === true) return undefined;
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
   * `CURATED`: a built-in rule set's `curated` row under the first of them that
   * has one is its curated row (layer 3). Absent: none is looked for.
   */
  ruleKeys?: readonly string[];
  /**
   * Whether the code table the call site reads (`CURATED`) has a row under a
   * lowercased key: the first of `ruleKeys` with a row in either table wins, as
   * the call site tried them, so a code row under an earlier key is still read.
   */
  inCode?: (key: string) => boolean;
  /**
   * Layer 3: what it inherits, which the call site knows how to collect.
   * `builtIn` is the built-in curated row found for `ruleKeys`, already
   * emitted: the call site then skips `CURATED`, and its prose scan when the row
   * says `replace`.
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
): void {
  // An effect of one rules version alone counts as though it were not there under
  // the other. A character with none, or one this app does not know, plays 2014,
  // as the sheet reads it everywhere (`asWritten`).
  const version = col.doc.rulesVersion === '2024' ? '2024' : '2014';
  const live = templates.filter((t) => t.edition === undefined || t.edition === version);
  const cls = ownClassOf(col, live, className);
  const counted = countedByClass(live, cls);
  for (const t of live) {
    if (counted.has(t)) continue;
    const named = forClass(namedFor(t, origin.label), cls);
    if (named === undefined) continue;
    // A fresh copy each time: fold time fills its numbers in place.
    const e = { ...structuredClone(named.effect), origin } as EffectInput;
    fillLevelWords(e as unknown as Record<string, unknown>, named, classLevel);
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
  const level = s.classLevel ?? characterLevel(col);

  if (patches?.replace !== undefined) {
    emit(
      col,
      patches.replace.effects,
      { ...s.origin, pack: patches.replace.pack },
      level,
      s.className,
    );
  }
  for (const add of patches?.add ?? [])
    emit(col, add.effects, { ...s.origin, pack: add.pack }, level, s.className);
  if (patches?.replace !== undefined) return;

  const self = mine?.readable === true ? mine : undefined;
  if (self !== undefined) emit(col, self.effects, { ...s.origin }, level, s.className);
  if (self?.replace === true) return;
  const from = col.effects.length;
  // The built-in curated row is inherited, as the `CURATED` row it stands in
  // for: after `from`, so the entry's `drop` reaches it, and with the subject's
  // own origin, which spend links find its action by.
  const row =
    s.ruleKeys === undefined ? undefined : builtInRuleFor(col, 'curated', s.ruleKeys, s.inCode);
  if (row !== undefined) emit(col, row.effects, s.origin, level, s.className, true);
  s.inherited?.(row === undefined ? undefined : { scan: row.scan });
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
