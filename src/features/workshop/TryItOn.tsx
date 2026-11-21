/**
 * Try it on (ADR-002 D1, board 3): the entry being made, on a character, before
 * it is saved. The sheet is worked out twice, as the character stands and with
 * the entry (an item worn and attuned, a feat taken, a species, subrace,
 * background or class in place of theirs, a subclass on their levels of its
 * class, a condition put on), and what moved is listed: "Strength 19, was 8".
 * Nothing is saved to the character.
 *
 * The entry reaches the engine through the registry's lookups with the entry in
 * front (`withEntries`), keyed by the name and book Save would store it under,
 * so what is tried on is what Save would write, not the copy's original. A
 * subclass or class goes in front with the features it owns, as its editor's
 * writer writes them, each read against what it copies (`onSheet`).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useTypePacks } from '@/data5e/hooks';
import { type EntityRegistry, identityKey } from '@/data5e/normalize';
import { characterRepo } from '@/db/characterRepo';
import { isRecord } from '@/engine/castGuidance';
import { hasMissingData, missingCharacterData } from '@/engine/dataNeeds';
import { deriveSheet } from '@/engine/derive';
import { needsAttunement } from '@/engine/effects/item';
import {
  ABILITIES,
  type Ability,
  type AttackRow,
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
  SKILLS,
} from '@/engine/types';
import { errorText } from '@/stores/notices';
import { resolveStored } from './copyWriter';
import type { Json } from './editorTypes';
import { Field, Section, Select } from './fields';

/** The kinds a character can be tried in: each is held one way (`wearing`). */
export const TRY_ON_TYPES: ReadonlySet<string> = new Set([
  'item',
  'feat',
  'race',
  'subrace',
  'background',
  'class',
  'subclass',
  'condition',
]);

/** The type of the entries a type owns, which Save writes beside it. */
const OWNED_TYPE: Readonly<Record<string, string>> = {
  subclass: 'subclassFeature',
  class: 'classFeature',
};

const lower = (v: unknown) => String(v ?? '').toLowerCase();

/** One entry put in front of the registry's, with its type. */
export interface InFront {
  type: string;
  entry: Json;
}

/**
 * The engine's lookups with `entries` in front for their types: each found by
 * its name and book before anything the registry holds, and first in its
 * type's list (a homebrew condition is found by name in that list, a feature
 * by its class, level and name). The registry's entry of the same identity is
 * left out of the list: a class's Ability Score Improvements share a name and
 * book, so the identity has their class and level too. Rules, rule sets and
 * packs come through as they are.
 */
export function withEntries(ctx: EngineContext, entries: readonly InFront[]): EngineContext {
  const types = new Set(entries.map((e) => e.type));
  const lists = new Map<string, readonly DataEntity[]>();
  return {
    ...ctx,
    get: (t, n, s) =>
      entries.find(
        ({ type, entry }) =>
          t === type &&
          lower(n) === lower(entry.name) &&
          (s === undefined || lower(s) === lower(entry.source)),
      )?.entry ?? ctx.get(t, n, s),
    byType: (t) => {
      if (!types.has(t)) return ctx.byType(t);
      let list = lists.get(t);
      if (list === undefined) {
        const mine = entries.filter((e) => e.type === t).map((e) => e.entry);
        const ids = new Set(mine.map((e) => identityKey(t, e as Entity)));
        list = [...mine, ...ctx.byType(t).filter((e) => !ids.has(identityKey(t, e as Entity)))];
        lists.set(t, list);
      }
      return list;
    },
  };
}

/** The engine's lookups with `entry` in front for its type (see `withEntries`). */
export function withEntry(ctx: EngineContext, type: string, entry: Json): EngineContext {
  return withEntries(ctx, [{ type, entry }]);
}

/** What Try it on is given: the entry, and what it owns, as Save would store them. */
export interface Trying {
  entry: Json;
  /** The entries it owns, as its editor's writer writes them: a subclass's or class's features. */
  owned?: readonly Json[];
  /** What the entry is written against, when it is a copy saved as changes. */
  original?: Json;
  /** Why it cannot be written as it stands, when it cannot. */
  failed?: string;
}

/** The registry's lookups `onSheet` reads a copy against. */
export type CopyLookup = Pick<EntityRegistry, 'byType' | 'changeOf'>;

/**
 * `e` as the sheet would read it once saved: a copy saved as changes read
 * against `original`, else against the registry's entry of the identity its
 * `_copy` names, below any change to it, as the writer writes it against that
 * one. A copy whose original is not found is read as it stands, as the merge
 * reads it.
 */
function asRead(registry: CopyLookup, type: string, e: Json, original?: Json): Json {
  const copy = e._copy;
  if (!isRecord(copy)) return e;
  const keys = Object.keys(copy).filter((k) => !k.startsWith('_'));
  const found =
    original ??
    (registry
      .byType(type as never)
      .find((x) => keys.every((k) => lower(x[k]) === lower(copy[k]))) as Json | undefined);
  if (found === undefined) {
    const { _copy: _, ...rest } = e;
    return rest;
  }
  const below = (registry.changeOf(found as Entity)?.base as Json | undefined) ?? found;
  return resolveStored(e, below);
}

/**
 * What goes in front of the registry for `trying`: the entry, then each entry
 * it owns under its own type, each read as the sheet would read it saved.
 */
export function onSheet(registry: CopyLookup, type: string, trying: Trying): InFront[] {
  const ownedType = OWNED_TYPE[type];
  const owned =
    ownedType === undefined
      ? []
      : (trying.owned ?? []).map((f) => ({
          type: ownedType,
          entry: asRead(registry, ownedType, f),
        }));
  return [{ type, entry: asRead(registry, type, trying.entry, trying.original) }, ...owned];
}

const sameRef = (a: EntityRef | undefined, b: EntityRef) =>
  a !== undefined && lower(a.name) === lower(b.name) && lower(a.source) === lower(b.source);

/** The species a subrace belongs to, from its own fields; undefined before one is picked. */
function speciesOf(entry: Json): EntityRef | undefined {
  const { raceName, raceSource } = entry;
  return typeof raceName === 'string' && raceName !== ''
    ? { name: raceName, source: String(raceSource ?? '') }
    : undefined;
}

/** A class row of the class a subclass is for: by name, as the sheet finds a subclass on it. */
const ofClass = (entry: Json) => (row: CharacterDoc['classes'][number]) =>
  lower(row.ref.name) === lower(entry.className);

const totalLevel = (doc: CharacterDoc) => doc.classes.reduce((n, r) => n + r.levels, 0);

/**
 * `doc` holding `entry` as a character holds one of its kind; undefined for a
 * kind it cannot, or when this character cannot (a subclass on one with no
 * levels in its class). A class is taken in place of their classes, at
 * `level` or else their total level, hit points at the average; one who has a
 * row of it keeps theirs.
 */
export function wearing(
  doc: CharacterDoc,
  type: string,
  entry: Json,
  level?: number,
): CharacterDoc | undefined {
  const ref = { name: String(entry.name ?? ''), source: String(entry.source ?? '') };
  const next = structuredClone(doc);
  switch (type) {
    case 'item': {
      const attune = needsAttunement(entry);
      const held = next.equipment.find((e) => sameRef(e.ref, ref));
      if (held !== undefined) {
        held.equipped = true;
        held.attuned = held.attuned || attune;
      } else {
        next.equipment.push({ id: 'try-it-on', ref, qty: 1, equipped: true, attuned: attune });
      }
      return next;
    }
    case 'feat':
      if (!next.feats.some((f) => sameRef(f.ref, ref)))
        next.feats.push({ ref, instanceId: 'try-it-on' });
      return next;
    case 'race':
      // Their own species keeps its subrace; another one starts without.
      if (!sameRef(next.race, ref)) delete next.subrace;
      next.race = ref;
      return next;
    case 'subrace': {
      const species = speciesOf(entry);
      if (species === undefined) return undefined;
      next.race = species;
      next.subrace = ref;
      return next;
    }
    case 'background':
      next.background = ref;
      return next;
    case 'class': {
      if (next.classes.some((r) => sameRef(r.ref, ref))) return next;
      const levels = Math.min(20, Math.max(1, level ?? totalLevel(next)));
      next.classes = [{ ref, levels, hp: Array<'avg'>(levels).fill('avg') }];
      return next;
    }
    case 'subclass': {
      const rows = next.classes.filter(ofClass(entry));
      if (rows.length === 0) return undefined;
      for (const row of rows) row.subclass = ref;
      return next;
    }
    case 'condition':
      if (!next.play.conditions.some((c) => lower(c.id) === lower(ref.name)))
        next.play.conditions.push({ id: ref.name });
      return next;
    default:
      return undefined;
  }
}

/**
 * `doc` already holds an entry by this name and book: the sheet before is
 * worked out with the saved one, so the result is what the changes do.
 */
export function holds(doc: CharacterDoc, type: string, entry: Json): boolean {
  const ref = { name: String(entry.name ?? ''), source: String(entry.source ?? '') };
  switch (type) {
    case 'item':
      return doc.equipment.some((e) => sameRef(e.ref, ref));
    case 'feat':
      return doc.feats.some((f) => sameRef(f.ref, ref));
    case 'race':
      return sameRef(doc.race, ref);
    case 'subrace': {
      const species = speciesOf(entry);
      return species !== undefined && sameRef(doc.race, species) && sameRef(doc.subrace, ref);
    }
    case 'background':
      return sameRef(doc.background, ref);
    case 'class':
      return doc.classes.some((r) => sameRef(r.ref, ref));
    case 'subclass':
      return doc.classes.some((r) => ofClass(entry)(r) && sameRef(r.subclass, ref));
    case 'condition':
      return doc.play.conditions.some((c) => lower(c.id) === lower(ref.name));
    default:
      return false;
  }
}

/** How the entry is held, as the result says it. */
const HELD: Readonly<Record<string, (entry: Json) => string>> = {
  item: (e) => (needsAttunement(e) ? 'Worn and attuned.' : 'Worn.'),
  feat: () => 'Taken as a feat.',
  race: () => 'As their species, in place of their own.',
  subrace: (e) =>
    `As their species, ${String(e.raceName)}, with this subrace, in place of their own.`,
  background: () => 'As their background, in place of their own.',
  class: () =>
    'As their class, in place of theirs, at the same total level with hit points at the average. One who has it keeps their levels.',
  subclass: (e) => `As the subclass of their ${String(e.className)} levels, in place of their own.`,
  condition: () => 'With the condition on.',
};

/** One number, list or line of the sheet that the entry moves. */
export interface Change {
  label: string;
  now: string;
  /** What it was; absent for one new on the sheet (an attack, a pool, spells). */
  was?: string;
  /** Up or down, for a number; absent for a list. */
  way?: 'up' | 'down';
  /**
   * It moved only because an ability modifier did (a save, a skill, an attack
   * with that ability): with many rows, the result lists the rest first.
   */
  follows?: true;
}

const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const plain = (n: number) => String(n);
const listed = (xs: readonly string[]) => (xs.length === 0 ? 'none' : xs.join(', '));
const skillName = (key: string) =>
  SKILLS.find((s) => s.name.toLowerCase() === key.toLowerCase())?.name ?? key;

/** An attack's damage and what rides on it: "1d8+4 slashing plus 1d6 fire, versatile 1d10+4". */
function damageLine(a: AttackRow, flat: (d: string) => string = (d) => d): string {
  const damage = [flat(a.damage), a.damageType].filter(Boolean).join(' ');
  const riders = a.extraDamage.map((r) => [r.dice, r.damageType].filter(Boolean).join(' '));
  const both = a.versatileDamage === undefined ? '' : `, versatile ${flat(a.versatileDamage)}`;
  return `${[damage, ...riders].join(' plus ')}${both}`;
}

/** An attack as one line: "+7 to hit, 1d8+4 slashing plus 1d6 fire". */
const attackLine = (a: AttackRow) => `${signed(a.toHit.value)} to hit, ${damageLine(a)}`;

/** Damage without the number added to its dice, which an ability modifier moves. */
const withoutFlat = (d: string) => d.replace(/(^|[+−-])\d+$/, '');

/** Each attack by its name and what it attacks with. */
const attacksByKey = (attacks: readonly AttackRow[]) =>
  new Map(attacks.map((a) => [lower(`${a.label}|${a.weaponId ?? a.origin}`), a]));

/** What moved from `was` to `now`, in the order the sheet shows it. */
export function changesOn(was: DerivedSheet, now: DerivedSheet): Change[] {
  const out: Change[] = [];
  const modMoved = (ab: Ability | undefined) =>
    ab === undefined ? 0 : now.abilities[ab].mod - was.abilities[ab].mod;
  // Moved by just what the modifier did, and nothing else of the entry's.
  const follows = (ab: Ability | undefined, by: number) =>
    modMoved(ab) !== 0 && by === modMoved(ab) ? { follows: true as const } : {};
  const number = (label: string, a: number, b: number, show = plain, of?: Ability) => {
    if (a !== b)
      out.push({
        label,
        now: show(b),
        was: show(a),
        way: b > a ? 'up' : 'down',
        ...follows(of, b - a),
      });
  };
  const list = (label: string, a: readonly string[], b: readonly string[]) => {
    const x = [...new Set(a)].sort();
    const y = [...new Set(b)].sort();
    if (x.join('|') !== y.join('|')) out.push({ label, now: listed(y), was: listed(x) });
  };
  for (const ab of ABILITIES)
    number(ABILITY_NAMES[ab], was.abilities[ab].value, now.abilities[ab].value);
  number('Armor Class', was.ac.value, now.ac.value);
  number('Hit point maximum', was.maxHp.value, now.maxHp.value);
  number('Speed', was.speedWalk.value, now.speedWalk.value, (n) => `${n} ft.`);
  number('Initiative', was.initiative.value, now.initiative.value, signed, 'dex');
  number('Proficiency bonus', was.profBonus.value, now.profBonus.value, signed);
  for (const ab of ABILITIES)
    number(
      `${ABILITY_NAMES[ab]} saves`,
      was.saves[ab].total.value,
      now.saves[ab].total.value,
      signed,
      ab,
    );
  for (const key of Object.keys(now.skills)) {
    const a = was.skills[key]?.total.value;
    const b = now.skills[key];
    if (a !== undefined && b !== undefined)
      number(skillName(key), a, b.total.value, signed, b.ability);
  }
  number(
    'Passive Perception',
    was.passivePerception.value,
    now.passivePerception.value,
    plain,
    'wis',
  );
  for (const block of now.spellcasting) {
    const before = was.spellcasting.find((b) => b.classUid === block.classUid);
    if (before === undefined) continue;
    number(
      `${block.className} spell save DC`,
      before.saveDc.value,
      block.saveDc.value,
      plain,
      block.ability,
    );
    number(
      `${block.className} spell attacks`,
      before.attackMod.value,
      block.attackMod.value,
      signed,
      block.ability,
    );
  }
  // Attacks, new, changed or gone: to hit, damage and what rides on it.
  const wasAttacks = attacksByKey(was.attacks);
  const nowAttacks = attacksByKey(now.attacks);
  for (const [key, a] of nowAttacks) {
    const before = wasAttacks.get(key);
    if (before === undefined) out.push({ label: a.label, now: attackLine(a) });
    else if (attackLine(before) !== attackLine(a))
      out.push({
        label: a.label,
        now: attackLine(a),
        was: attackLine(before),
        // Only its modifier moved: the same dice and riders, to hit by as much.
        ...(damageLine(a, withoutFlat) === damageLine(before, withoutFlat)
          ? follows(a.ability, a.toHit.value - before.toHit.value)
          : {}),
      });
  }
  for (const [key, a] of wasAttacks)
    if (!nowAttacks.has(key)) out.push({ label: a.label, now: 'gone', was: attackLine(a) });
  // Pools, by their key: how many uses each has.
  const wasPools = new Map(was.resources.map((r) => [r.key, r]));
  for (const r of now.resources) {
    const before = wasPools.get(r.key);
    if (before === undefined) out.push({ label: r.label, now: plain(r.max) });
    else number(r.label, before.max, r.max);
  }
  const nowPools = new Set(now.resources.map((r) => r.key));
  for (const r of was.resources)
    if (!nowPools.has(r.key)) out.push({ label: r.label, now: 'gone', was: plain(r.max) });
  // The spells it grants, by name: those new, and those gone.
  const spellNames = (s: DerivedSheet) => [...new Set(s.grantedSpells.map((g) => g.name))];
  const wasSpells = new Set(spellNames(was).map(lower));
  const nowSpells = new Set(spellNames(now).map(lower));
  const gained = spellNames(now).filter((n) => !wasSpells.has(lower(n)));
  const lost = spellNames(was).filter((n) => !nowSpells.has(lower(n)));
  if (gained.length > 0) out.push({ label: 'Spells', now: gained.join(', ') });
  if (lost.length > 0) out.push({ label: 'Spells lost', now: 'gone', was: lost.join(', ') });
  const speeds = (s: DerivedSheet) => s.otherSpeeds.map((x) => `${x.mode} ${x.value} ft.`);
  list('Other speeds', speeds(was), speeds(now));
  const senses = (s: DerivedSheet) => s.senses.map((x) => `${x.sense} ${x.range} ft.`);
  list('Senses', senses(was), senses(now));
  list(
    'Resistances',
    was.resists.map((r) => r.damageType),
    now.resists.map((r) => r.damageType),
  );
  list(
    'Immunities',
    was.immunities.map((r) => r.damageType),
    now.immunities.map((r) => r.damageType),
  );
  list(
    'Condition immunities',
    was.conditionImmunities.map((r) => r.condition),
    now.conditionImmunities.map((r) => r.condition),
  );
  list('Languages', was.languages, now.languages);
  list('Armor', was.armorProfs, now.armorProfs);
  list('Weapons', was.weaponProfs, now.weaponProfs);
  list('Tools', was.toolProfs, now.toolProfs);
  // Two attacks of one name (two daggers) are told apart by a number.
  const seen = new Map<string, number>();
  return out.map((c) => {
    const n = (seen.get(c.label) ?? 0) + 1;
    seen.set(c.label, n);
    return n === 1 ? c : { ...c, label: `${c.label} ${n}` };
  });
}

/** The most rows the result lists before it says how many more there are. */
const SHOWN = 8;

/**
 * The rows the result lists, in the sheet's order. With more than `n`, those
 * that only follow an ability modifier make room for the rest first, so an
 * item that sets Strength still shows its attack, its pool and its spell.
 */
export function firstShown(changes: readonly Change[], n = SHOWN): Change[] {
  if (changes.length <= n) return [...changes];
  const room = Math.max(0, n - changes.filter((c) => c.follows !== true).length);
  let followers = 0;
  return changes.filter((c) => c.follows !== true || followers++ < room).slice(0, n);
}

/** Someone to try the entry on: a sample, or one of the player's characters. */
export interface Wearer {
  key: string;
  label: string;
  /** What the result says about them. */
  note: string;
  doc: CharacterDoc;
  /** The level a class is taken at, for a sample made without one. */
  level?: number;
}

const SAMPLE_SCORES = {
  martial: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  // Strength 8, so an item that sets a score shows what it does.
  caster: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
} as const;

/** The class a sample is made of: one by these names first (the 2024 printing first), else `fits`. */
function pickClass(
  classes: readonly DataEntity[],
  names: readonly string[],
  fits: (c: DataEntity) => boolean,
): DataEntity | undefined {
  for (const name of names) {
    const named = classes.filter((c) => lower(c.name) === name);
    const found = named.find((c) => lower(c.source) === 'xphb') ?? named[0];
    if (found !== undefined) return found;
  }
  return classes.find(fits);
}

function sample(
  key: string,
  cls: DataEntity | undefined,
  scores: CharacterDoc['abilities']['base'],
  level = 5,
): Wearer {
  const doc = newCharacterDoc(`try-it-on-${key}`, 'Sample', '');
  doc.abilities.method = 'manual';
  doc.abilities.base = { ...scores };
  if (cls !== undefined) {
    const ability = cls.spellcastingAbility;
    if (typeof ability === 'string' && ability in doc.abilities.base)
      doc.abilities.base[ability as Ability] = 16;
    doc.rulesVersion = lower(cls.source) === 'xphb' || cls.edition === 'one' ? '2024' : '2014';
    doc.classes = [
      {
        ref: { name: String(cls.name), source: String(cls.source) },
        levels: level,
        hp: Array<'avg'>(level).fill('avg'),
      },
    ];
  }
  const label = cls === undefined ? 'A sample character' : `A level ${level} ${lower(cls.name)}`;
  const base = doc.abilities.base;
  const note = `A sample, with ${ABILITIES.map((a) => `${ABILITY_NAMES[a]} ${base[a]}`).join(', ')}.`;
  return { key, label, note, doc };
}

/** Two sample characters from the classes the data has: a fighter, and a caster with Strength 8. */
export function samplesOf(ctx: Pick<EngineContext, 'byType'>): Wearer[] {
  const classes = ctx.byType('class');
  const casts = (c: DataEntity) => typeof c.spellcastingAbility === 'string';
  const martial = pickClass(classes, ['fighter', 'barbarian', 'warrior'], (c) => !casts(c));
  const caster = pickClass(classes, ['wizard', 'sorcerer'], casts);
  const out = [sample('martial', martial ?? classes[0], SAMPLE_SCORES.martial)];
  if (caster !== undefined && caster !== (martial ?? classes[0]))
    out.push(sample('caster', caster, SAMPLE_SCORES.caster));
  return out;
}

/**
 * The levels in a list of feature refs: "Name|Class|Source|Level" for a
 * class's (`at` 3), two fields more for a subclass's (`at` 5), as a string
 * or under `key` in an object. `only` keeps the objects it holds for.
 */
function refLevels(list: unknown, key: string, at: number, only?: (o: Json) => boolean): number[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (only !== undefined && !(isRecord(item) && only(item))) return [];
    const raw = isRecord(item) ? item[key] : item;
    const level = typeof raw === 'string' ? Number.parseInt(raw.split('|')[at] ?? '', 10) : NaN;
    return Number.isFinite(level) ? [level] : [];
  });
}

const scoresFor = (cls: Json) =>
  typeof cls.spellcastingAbility === 'string' ? SAMPLE_SCORES.caster : SAMPLE_SCORES.martial;

/** Who the entry can be tried on, or why no one can. */
export interface Wearers {
  wearers: Wearer[];
  /** Why there is no one, when there is not. */
  none?: string;
}

const yours = (doc: CharacterDoc): Wearer => ({
  key: doc.id,
  label: doc.name.trim() || 'Unnamed character',
  note: `Your character. Nothing is saved to ${doc.name.trim() || 'them'} by trying it on.`,
  doc,
});

/**
 * Who `entry` of `type` can be tried on: samples, then the player's characters.
 * - A subclass: a sample of its class at its last feature's level (at least
 *   the level its class takes one, at most 20), and the characters with
 *   levels in its class.
 * - A class: a sample made without a class, who takes it at its last
 *   feature's level (at most 20), and every character.
 * - Anything else: the two samples (`samplesOf`), and every character.
 */
export function wearersFor(
  ctx: Pick<EngineContext, 'get' | 'byType'>,
  type: string,
  entry: Json,
  roster: readonly CharacterDoc[],
): Wearers {
  if (type === 'subrace' && speciesOf(entry) === undefined)
    return { wearers: [], none: 'Pick the species it belongs to, and it can be tried on.' };
  if (type === 'subclass') {
    const className = String(entry.className ?? '');
    if (className === '')
      return { wearers: [], none: 'Pick the class it is for, and it can be tried on.' };
    const cls =
      ctx.get('class', className, String(entry.classSource ?? '')) ??
      ctx.byType('class').find((c) => lower(c.name) === lower(className));
    const theirs = roster.filter((d) => d.classes.some(ofClass(entry))).map(yours);
    if (cls === undefined)
      return theirs.length > 0
        ? { wearers: theirs }
        : {
            wearers: [],
            none: `No one to try it on: ${className} is not in your data, and none of your characters has a level in it.`,
          };
    const takes = refLevels(
      cls.classFeatures,
      'classFeature',
      3,
      (o) => o.gainSubclassFeature === true,
    );
    const floor = takes.length > 0 ? Math.min(...takes) : 3;
    const last = Math.max(0, ...refLevels(entry.subclassFeatures, 'subclassFeature', 5));
    const level = Math.min(20, Math.max(floor, last));
    const one = sample('subclass', cls, scoresFor(cls), level);
    const why = last >= floor ? 'its last feature' : 'its class takes a subclass';
    return {
      wearers: [{ ...one, note: `${one.note} At level ${level}, where ${why}.` }, ...theirs],
    };
  }
  if (type === 'class') {
    const last = Math.max(0, ...refLevels(entry.classFeatures, 'classFeature', 3));
    const level = Math.min(20, Math.max(1, last));
    const one = sample('class', entry, scoresFor(entry), level);
    one.doc.classes = [];
    const why = last >= 1 ? `level ${level}, its last feature's` : 'level 1';
    return {
      wearers: [
        {
          ...one,
          level,
          note: `${one.note} With no class before, then this one at ${why}.`,
        },
        ...roster.map(yours),
      ],
    };
  }
  return { wearers: [...samplesOf(ctx), ...roster.map(yours)] };
}

/** What trying `entry` on `doc` shows. */
export type Tried =
  | { state: 'changed'; changes: Change[]; missing: boolean; already: boolean }
  | { state: 'none'; missing: boolean; already: boolean }
  | { state: 'failed'; text: string };

/**
 * `also` goes in front with the entry: the features a subclass or class owns
 * (`onSheet`). `level` is the level a class is taken at (`Wearer.level`).
 */
export function tryOn(
  ctx: EngineContext,
  doc: CharacterDoc,
  type: string,
  entry: Json,
  { also = [], level }: { also?: readonly InFront[]; level?: number } = {},
): Tried {
  try {
    const on = wearing(doc, type, entry, level);
    if (on === undefined) return { state: 'failed', text: 'this kind cannot be tried on yet' };
    // One they already hold is worn the same way before and after, so the
    // result is the saved one against the changes alone.
    const already = holds(doc, type, entry);
    const was = deriveSheet(already ? on : doc, ctx);
    const withIt = withEntries(ctx, [{ type, entry }, ...also]);
    const now = deriveSheet(on, withIt);
    const missing = hasMissingData(missingCharacterData(on, withIt));
    const changes = changesOn(was, now);
    return changes.length === 0
      ? { state: 'none', missing, already }
      : { state: 'changed', changes, missing, already };
  } catch (err) {
    return { state: 'failed', text: errorText(err) };
  }
}

export function TryItOn({
  type,
  trying,
  registry,
}: {
  /** The registry type: `race` for a species. */
  type: string;
  /** The entry as Save would store it, under the name and book it would have, and what it owns. */
  trying: Trying;
  registry: EntityRegistry;
}) {
  // A sample's class may not have downloaded yet on this page.
  useTypePacks('class');
  const roster = useLiveQuery(
    () =>
      characterRepo
        .listSafe()
        .then((r) => r.characters)
        .catch(() => [] as CharacterDoc[]),
    [],
  );
  const ctx = useMemo(() => engineContextFor(registry), [registry]);
  // The sheet is worked out twice for every key typed; the result may lag.
  const seen = useDeferredValue(trying);
  const front = useMemo(() => onSheet(registry, type, seen), [registry, type, seen]);
  const entry = front[0]?.entry ?? seen.entry;
  const { wearers, none } = useMemo(
    () => wearersFor(ctx, type, entry, roster ?? []),
    [ctx, type, entry, roster],
  );
  const [pick, setPick] = useState<string>();
  const who = wearers.find((w) => w.key === pick) ?? wearers[0];
  const tried = useMemo<Tried | undefined>(() => {
    if (who === undefined) return undefined;
    if (seen.failed !== undefined) return { state: 'failed', text: seen.failed };
    return tryOn(ctx, who.doc, type, entry, { also: front.slice(1), level: who.level });
  }, [ctx, who, type, entry, front, seen.failed]);
  if (!TRY_ON_TYPES.has(type)) return null;
  if (who === undefined || tried === undefined)
    return none === undefined ? null : (
      <Section title="Try it on">
        <p className="text-body text-ink-muted">{none}</p>
      </Section>
    );
  const name = who.doc.id.startsWith('try-it-on') ? 'the sample' : who.label;
  const changes = tried.state === 'changed' ? tried.changes : [];
  return (
    <Section title="Try it on">
      <Field label="Try it on">
        <Select value={who.key} onChange={(e) => setPick(e.target.value)}>
          {wearers.map((w) => (
            <option key={w.key} value={w.key}>
              {w.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2 rounded-card bg-surface p-3 ring-1 ring-line ring-inset">
        <p className="text-caption text-ink-muted">
          {HELD[type]?.(entry)} {who.note}
          {tried.state !== 'failed' &&
            tried.already &&
            ` ${name} already has it as saved: this is what your changes since do.`}
        </p>
        {tried.state === 'failed' && (
          <p className="text-body">The sheet could not be worked out with it: {tried.text}.</p>
        )}
        {tried.state === 'none' && (
          <p className="text-body">
            {tried.already
              ? `Your changes move nothing on ${name}’s sheet.`
              : `Nothing on ${name}’s sheet changes.`}{' '}
            An effect that counts only at some times (Only while, Counts when) shows on the sheet
            then.
          </p>
        )}
        {changes.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-2">
            {firstShown(changes).map((c) => (
              <li
                key={c.label}
                className="flex min-w-0 flex-col rounded-control bg-surface-raised px-3 py-2"
              >
                <span className="text-label text-ink-muted">{c.label}</span>
                <span className="flex items-center gap-1 text-body-strong wrap-anywhere">
                  {c.way === 'up' && <ArrowUp size={14} aria-hidden className="shrink-0" />}
                  {c.way === 'down' && <ArrowDown size={14} aria-hidden className="shrink-0" />}
                  {c.now}
                </span>
                <span className="text-caption text-ink-muted wrap-anywhere">
                  {c.was === undefined ? 'new' : `was ${c.was}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {changes.length > SHOWN && (
          <p className="text-caption text-ink-muted">
            And {changes.length - SHOWN} more on the sheet.
          </p>
        )}
        {tried.state !== 'failed' && tried.missing && (
          <p className="text-caption text-ink-muted">
            Some of {name}&rsquo;s data has not downloaded yet, so a number here may be off.
          </p>
        )}
      </div>
    </Section>
  );
}
