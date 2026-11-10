/**
 * Moments (ADR-001, hook H9): at a moment the app already sees, an entry the
 * character has or a rule pack applied to them may act. "Dropping to 0 HP
 * gives a level of exhaustion" is
 * `{ "at": "zeroHp", "do": [{ "kind": "addCondition", "condition": "Exhaustion" }] }`.
 *
 * This module reads moments (`StoredEntryGuidance.moments`, a pack's
 * `castGuidance.moments`) by known keys only, never spreading the raw object,
 * finds the ones a moment sets off, and works out their amounts when it
 * happens. Changing the play state is `effectLife.ts`'s, which fires them.
 *
 * Nothing here throws: a bad moment or outcome is a problem, and it does not
 * count. Data with no moments reaches none of this.
 */
import { randomId } from '@/lib/randomId';
import { readActiveEffects } from './activeEffects';
import {
  type CueTone,
  clip,
  formulaNamesFor,
  guidanceVersion,
  isRecord,
  CAST_GUIDANCE_LIMITS as L,
  MOMENTS,
  type MomentId,
  own,
  RULE_PACK_TYPE,
} from './castGuidance';
import { type EffectTemplate, readStoredEffects } from './effects/mechanics';
import { type Formula, readAmount } from './formula';
import {
  ACTIVE_PART_KINDS,
  type ActiveEffect,
  type DataEntity,
  type DerivedSheet,
  type EffectDuration,
  type EngineContext,
  type FormulaScope,
  type RollFilter,
} from './types';

// ---------------------------------------------------------------------------
// Read moments
// ---------------------------------------------------------------------------

/** A stored amount, read: a number now, or a formula worked out when the moment happens. */
type Amount = { value: number } | { formula: Formula };

/** One outcome, read (`MomentOutcome`). */
export type ReadOutcome =
  | { kind: 'addCondition'; condition: string; level: number }
  | {
      kind: 'addEffect';
      name: string;
      effects: readonly EffectTemplate[];
      /** Each effect's place in the stored list (1 for the first), for problems to name. */
      places: readonly number[];
      lasts?: EffectDuration;
    }
  | { kind: 'regain' | 'spend'; resource: string; amount: Amount }
  | { kind: 'tempHp'; amount: Amount }
  | { kind: 'cue'; text: string; tone: CueTone }
  | { kind: 'offer'; label: string; dice?: string };

/** One moment, read (`StoredMoment`), with where it comes from. */
export interface ReadMoment {
  at: MomentId;
  /** `natural20` and `natural1`: the rolls it holds for; every d20 roll when absent. */
  rolls?: ReadonlyArray<RollFilter['rolls'][number]>;
  /** `castAtLevel`: the least slot level it holds for; every cast when absent. */
  level?: number;
  /** `conditionAdded` and `conditionEnded`: the condition, lowercased; any when absent. */
  condition?: string;
  do: readonly ReadOutcome[];
  /** The entry or pack it comes from, said beside what it does. */
  from: string;
  /** What `classLevel` and level tables read in its amounts; the character's level when absent. */
  classLevel?: number;
}

/** A value that keeps a moment or an outcome from counting, and why. */
class Bad extends Error {}

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const MOMENT_IDS: ReadonlySet<string> = new Set(MOMENTS);
const TONES: ReadonlySet<string> = new Set(['help', 'ward', 'warn', 'info']);
const ROLLS: ReadonlySet<string> = new Set(['attack', 'save', 'check']);
const PART_KINDS: ReadonlySet<string> = new Set(ACTIVE_PART_KINDS);
/** As `effects/mechanics.ts` reads dice. */
const DICE = /^\d{0,3}d\d{1,3}(\s*[+-]\s*(\d{0,3}d\d{1,3}|\d{1,4}))*$/;
/** Exhaustion has six levels in both rules versions; no other condition has levels. */
const MOST_LEVELS = 6;
const AMOUNT_NAMES = formulaNamesFor('resourceRegain');
const TEMP_HP_NAMES = formulaNamesFor('tempHpEachTurn');

/** The built-in conditions as the sheet spells their ids; a homebrew one is kept as written. */
const BUILT_IN = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
];
const BUILT_IN_BY_LOWER = new Map(BUILT_IN.map((c) => [c.toLowerCase(), c]));

function words(o: Record<string, unknown>, key: string, max: number = L.labelLength): string {
  const v = own(o, key);
  if (typeof v !== 'string' || v.trim() === '') throw new Bad(`"${key}" needs words`);
  if (v.length > max) throw new Bad(`"${key}" is at most ${max} characters`);
  return v.trim();
}

function optWords(o: Record<string, unknown>, key: string): string | undefined {
  return own(o, key) === undefined ? undefined : words(o, key);
}

function amountOf(o: Record<string, unknown>, names: typeof AMOUNT_NAMES): Amount {
  const raw = own(o, 'amount');
  if (raw === undefined) throw new Bad('"amount" is missing');
  const read = readAmount(raw, names.names, names.why);
  if ('problem' in read) throw new Bad(`"amount" ${read.problem}`);
  if ('value' in read && (!Number.isInteger(read.value) || read.value < 0)) {
    throw new Bad('"amount" is a whole number, 0 or more');
  }
  return read;
}

/** A duration as `activeEffects.ts` stores one: known fields only. */
function readLasts(raw: unknown): EffectDuration | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Bad('"lasts" is a duration');
  const lasts: EffectDuration = {};
  const minutes = own(raw, 'minutes');
  const rest = own(raw, 'rest');
  const concentration = own(raw, 'concentration');
  const endsWhen = own(raw, 'endsWhen');
  if (minutes !== undefined) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
      throw new Bad('"lasts.minutes" is a number of minutes');
    }
    lasts.minutes = Math.min(minutes, L.amountLimit);
  }
  if (rest !== undefined) {
    if (rest !== 'short' && rest !== 'long') throw new Bad('"lasts.rest" is short or long');
    lasts.rest = rest;
  }
  if (concentration !== undefined) {
    if (typeof concentration !== 'boolean') throw new Bad('"lasts.concentration" is true or false');
    if (concentration) lasts.concentration = true;
  }
  if (endsWhen !== undefined) {
    if (endsWhen !== 'unconscious' && endsWhen !== 'incapacitated') {
      throw new Bad('"lasts.endsWhen" is unconscious or incapacitated');
    }
    lasts.endsWhen = endsWhen;
  }
  return lasts;
}

/** An effect in play would hold this part as it is: its kind, dice and ranges. */
function holds(part: unknown): boolean {
  const [effect] = readActiveEffects([{ id: 'part', name: 'part', parts: [part] }]).effects;
  return effect?.parts.length === 1;
}

function readOutcome(raw: unknown, problems: string[], where: string): ReadOutcome {
  if (!isRecord(raw)) throw new Bad('is not an outcome');
  const kind = own(raw, 'kind');
  switch (kind) {
    case 'addCondition': {
      const level = own(raw, 'level');
      if (
        level !== undefined &&
        (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > MOST_LEVELS)
      ) {
        throw new Bad(`"level" is from 1 to ${MOST_LEVELS}`);
      }
      const name = words(raw, 'condition');
      return {
        kind,
        condition: BUILT_IN_BY_LOWER.get(name.toLowerCase()) ?? name,
        level: typeof level === 'number' ? level : 1,
      };
    }
    case 'addEffect': {
      const name = words(raw, 'name');
      const stored = own(raw, 'effects');
      const read = readStoredEffects(stored);
      for (const p of read.problems) problems.push(`${where}: ${p}`);
      // Where each effect read sits in the stored list: the reader leaves bad ones out.
      const readAt = Array.isArray(stored)
        ? stored
            .slice(0, L.effectsPerEntry)
            .flatMap((x, i) => (readStoredEffects([x]).effects.length === 1 ? [i + 1] : []))
        : [];
      const effects: EffectTemplate[] = [];
      const places: number[] = [];
      for (const [i, t] of read.effects.entries()) {
        const place = readAt[i] ?? i + 1;
        // Effects in play are stricter than an entry's own: plain dice ("1d6",
        // never "1d6 + 2"), a critical range from 2 to 20, no negative amounts.
        // A part with a formula is checked once its numbers are worked out.
        const why =
          t.while !== undefined
            ? 'an effect in play has no "while"'
            : !PART_KINDS.has(t.effect.kind)
              ? 'an effect in play reaches only numbers and rolls'
              : t.formulas === undefined && !holds(t.effect)
                ? 'an effect in play cannot hold it as written'
                : undefined;
        if (why !== undefined) {
          problems.push(`${where}: effect ${place} (${t.effect.kind}): ${why}`);
          continue;
        }
        effects.push(t);
        places.push(place);
      }
      if (effects.length === 0) throw new Bad('"effects" has nothing an effect in play can do');
      const lasts = readLasts(own(raw, 'lasts'));
      return { kind, name, effects, places, ...(lasts !== undefined ? { lasts } : {}) };
    }
    case 'regain':
    case 'spend':
      return { kind, resource: words(raw, 'resource'), amount: amountOf(raw, AMOUNT_NAMES) };
    case 'tempHp':
      return { kind, amount: amountOf(raw, TEMP_HP_NAMES) };
    case 'cue': {
      const tone = own(raw, 'tone');
      if (tone !== undefined && (typeof tone !== 'string' || !TONES.has(tone))) {
        throw new Bad('"tone" is help, ward, warn or info');
      }
      return { kind, text: words(raw, 'text', L.textLength), tone: (tone as CueTone) ?? 'info' };
    }
    case 'offer': {
      const label = words(raw, 'label');
      const dice = optWords(raw, 'dice');
      if (dice !== undefined && (dice.length > 40 || !DICE.test(dice))) {
        throw new Bad('"dice" is dice, like 1d6 or 2d8 + 2');
      }
      return { kind, label, ...(dice !== undefined ? { dice } : {}) };
    }
    default:
      throw new Bad(`has no kind "${clip(kind)}"`);
  }
}

function readMoment(raw: unknown, from: string, problems: string[], where: string): ReadMoment {
  if (!isRecord(raw)) throw new Bad('is not a moment');
  const at = own(raw, 'at');
  if (typeof at !== 'string' || !MOMENT_IDS.has(at)) throw new Bad(`has no moment "${clip(at)}"`);
  const moment: ReadMoment = { at: at as MomentId, do: [], from };

  const rolls = own(raw, 'rolls');
  if (rolls !== undefined) {
    if (
      !Array.isArray(rolls) ||
      rolls.length === 0 ||
      rolls.length > ROLLS.size ||
      !rolls.every((r) => typeof r === 'string' && ROLLS.has(r))
    ) {
      throw new Bad('"rolls" lists attack, save or check');
    }
    moment.rolls = [...new Set(rolls as RollFilter['rolls'])];
  }
  const level = own(raw, 'level');
  if (level !== undefined) {
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9) {
      throw new Bad('"level" is a slot level, from 1 to 9');
    }
    moment.level = level;
  }
  const condition = optWords(raw, 'condition');
  if (condition !== undefined) moment.condition = condition.toLowerCase();
  // A filter on a moment that never says what it filters would keep it from ever happening.
  if (moment.rolls !== undefined && at !== 'natural20' && at !== 'natural1') {
    throw new Bad('"rolls" goes only with natural20 or natural1');
  }
  if (moment.level !== undefined && at !== 'castAtLevel') {
    throw new Bad('"level" goes only with castAtLevel');
  }
  if (moment.condition !== undefined && at !== 'conditionAdded' && at !== 'conditionEnded') {
    throw new Bad('"condition" goes only with conditionAdded or conditionEnded');
  }

  const outcomes = own(raw, 'do');
  if (!Array.isArray(outcomes) || outcomes.length === 0) throw new Bad('"do" lists what happens');
  if (outcomes.length > L.effectsPerEntry) {
    problems.push(`${where}: only the first ${L.effectsPerEntry} of "do" count`);
  }
  const done: ReadOutcome[] = [];
  outcomes.slice(0, L.effectsPerEntry).forEach((o, i) => {
    const here = `${where}, outcome ${i + 1}`;
    try {
      done.push(readOutcome(o, problems, here));
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      const kind =
        isRecord(o) && typeof own(o, 'kind') === 'string' ? ` (${clip(own(o, 'kind'))})` : '';
      problems.push(`${here}${kind}: ${err.message}`);
    }
  });
  if (done.length === 0) throw new Bad('nothing it does can happen');
  moment.do = done;
  return moment;
}

/** A stored list of moments, read: a bad one is a problem and is left out. */
export function readMoments(
  raw: unknown,
  from: string,
): { moments: ReadMoment[]; problems: string[] } {
  const moments: ReadMoment[] = [];
  const problems: string[] = [];
  if (raw === undefined) return { moments, problems };
  if (!Array.isArray(raw)) return { moments, problems: ['"moments" is not a list'] };
  if (raw.length > L.momentsPerPack) {
    problems.push(`only the first ${L.momentsPerPack} of "moments" count`);
  }
  raw.slice(0, L.momentsPerPack).forEach((m, i) => {
    const at = isRecord(m) && typeof own(m, 'at') === 'string' ? ` (${clip(own(m, 'at'))})` : '';
    const where = `moment ${i + 1}${at}`;
    try {
      moments.push(readMoment(m, from, problems, where));
    } catch (err) {
      if (!(err instanceof Bad)) throw err;
      problems.push(`${where}: ${err.message}`);
    }
  });
  return { moments, problems };
}

interface Read {
  moments: readonly ReadMoment[];
  problems: readonly string[];
}

/** Read once per stored `castGuidance` and name: the registry builds new objects when its files change. */
const READ = new WeakMap<object, Map<string, Read>>();

/** The moments in a stored `castGuidance` (an entry's or a pack's), read once per object. */
function momentsIn(raw: unknown, from: string): Read {
  if (raw === undefined) return { moments: [], problems: [] };
  if (!isRecord(raw)) return { moments: [], problems: [] };
  const byName = READ.get(raw) ?? new Map<string, Read>();
  READ.set(raw, byName);
  const known = byName.get(from);
  if (known !== undefined) return known;
  let read: Read;
  if (own(raw, 'moments') === undefined) read = { moments: [], problems: [] };
  else {
    const version = guidanceVersion(raw);
    // The entry's own reader (`readMechanics`) already says an unreadable version.
    read =
      'problem' in version ? { moments: [], problems: [] } : readMoments(own(raw, 'moments'), from);
  }
  byName.set(from, read);
  return read;
}

/** One entry the character has, whose own moments count. */
export interface MomentSubject {
  entry: DataEntity;
  /** Its name on the sheet, said with what its moments do and with problems. */
  label: string;
  /** The level of the class it belongs to, for `classLevel` and level tables. */
  classLevel?: number;
}

function appliesTo(entry: DataEntity, characterId: string): boolean {
  const to = own(entry, 'appliesTo');
  const characters = isRecord(to) ? own(to, 'characters') : undefined;
  return Array.isArray(characters) && characters.includes(characterId);
}

/** Every moment a character's entries and the packs applied to them hold, and what did not count. */
export interface CharacterMoments {
  moments: readonly ReadMoment[];
  problems: readonly string[];
}

/**
 * The moments in force for one character: each entry's own, then each rule
 * pack applied to them, in the player's order. A pack with no `appliesTo`
 * reaches nobody.
 */
export function collectMoments(
  subjects: Iterable<MomentSubject>,
  ctx: Pick<EngineContext, 'byType'>,
  characterId: string,
): CharacterMoments {
  const moments: ReadMoment[] = [];
  const problems: string[] = [];
  for (const s of subjects) {
    const read = momentsIn(own(s.entry, 'castGuidance'), s.label);
    for (const p of read.problems) problems.push(`${s.label}: ${p}`);
    for (const m of read.moments) {
      moments.push(s.classLevel === undefined ? m : { ...m, classLevel: s.classLevel });
    }
  }
  for (const pack of ctx.byType(RULE_PACK_TYPE)) {
    if (!appliesTo(pack, characterId)) continue;
    const named = own(pack, 'name');
    const name =
      typeof named === 'string' && named.trim() !== '' ? clip(named.trim()) : 'A rule pack';
    const read = momentsIn(own(pack, 'castGuidance'), name);
    for (const p of read.problems) problems.push(`${name}: ${p}`);
    moments.push(...read.moments);
  }
  return { moments, problems };
}

// ---------------------------------------------------------------------------
// Moments in force, and what sets them off
// ---------------------------------------------------------------------------

/**
 * What firing moments needs to know of the character, given to `effectLife.ts`
 * through `HpLimits.moments`. Absent, nothing fires.
 */
export interface MomentsInForce {
  moments: readonly ReadMoment[];
  /** What amounts read, from the sheet; `hp` is read from play when the moment happens. */
  scope: FormulaScope;
  /** The pools uses can be regained into or spent from, by key, and their size. */
  pools: ReadonlyArray<{ key: string; label: string; max: number }>;
  /**
   * Current HP when the sheet was derived, so before the change in hand: a
   * character already at 0 then is not dropping to 0 again when hit.
   */
  hpWhenDerived: number;
}

/**
 * What a sheet gives moments to read: its level, scores, proficiency, HP
 * maximum and pools, and `hp`, current HP as it was derived.
 */
export function momentsInForce(
  read: CharacterMoments,
  sheet: Pick<DerivedSheet, 'abilities' | 'profBonus' | 'totalLevel' | 'maxHp' | 'resources'>,
  hp: number,
): MomentsInForce | undefined {
  if (read.moments.length === 0) return undefined;
  const mod = {} as FormulaScope['mod'];
  const score = {} as FormulaScope['score'];
  for (const a of ABILITIES) {
    mod[a] = sheet.abilities[a].mod;
    score[a] = sheet.abilities[a].value;
  }
  return {
    moments: read.moments,
    scope: {
      level: sheet.totalLevel,
      classLevel: sheet.totalLevel,
      prof: sheet.profBonus.value,
      hp,
      maxHp: sheet.maxHp.value,
      mod,
      score,
    },
    pools: sheet.resources.map((r) => ({ key: r.key, label: r.label, max: r.max })),
    hpWhenDerived: hp,
  };
}

/** What happened, for matching a moment's filters. */
export interface MomentDetail {
  /** `castAtLevel`: the slot level spent, 0 for a cantrip. */
  level?: number;
  /** `conditionAdded` and `conditionEnded`: the condition's id. */
  condition?: string;
  /** `natural20` and `natural1`: the kind of roll. */
  roll?: RollFilter['rolls'][number];
}

/** The moments `at` sets off, in order. */
export function momentsAt(
  inForce: MomentsInForce,
  at: MomentId,
  detail: MomentDetail = {},
): ReadMoment[] {
  return inForce.moments.filter((m) => {
    if (m.at !== at) return false;
    if (m.level !== undefined && !((detail.level ?? 0) >= m.level)) return false;
    if (m.condition !== undefined && m.condition !== detail.condition?.trim().toLowerCase()) {
      return false;
    }
    if (m.rolls !== undefined && (detail.roll === undefined || !m.rolls.includes(detail.roll))) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Working out outcomes
// ---------------------------------------------------------------------------

/**
 * One chain of moments: what fired, so none fires twice and a chain that sets
 * itself off ends, and the formula steps it has spent.
 */
export interface MomentChain {
  fired: Set<ReadMoment>;
  steps: number;
  /** How many moments deep this one is: one condition's moment adding another. */
  depth: number;
}

export const newChain = (): MomentChain => ({ fired: new Set(), steps: 0, depth: 0 });

/** How many moments deep a chain may go before the rest are left out. */
export const CHAIN_DEPTH = 8;

/** The scope a moment's amounts read, with current HP and the HP maximum as they are now. */
export function scopeFor(
  inForce: MomentsInForce,
  m: ReadMoment,
  now: { hp: number; maxHp: number },
): FormulaScope {
  return { ...inForce.scope, ...now, classLevel: m.classLevel ?? inForce.scope.level };
}

/** A formula's value under the chain's step budget (`formulaStepsPerDerive`); past it, 0. */
function work(f: Formula, scope: FormulaScope, chain: MomentChain): number {
  if (chain.steps + f.cost > L.formulaStepsPerDerive) return 0;
  chain.steps += f.cost;
  return f.evaluate(scope);
}

/** An outcome's amount now: uses and temporary hit points are never below 0. */
export function amountNow(a: Amount, scope: FormulaScope, chain: MomentChain): number {
  return Math.max(0, 'value' in a ? a.value : work(a.formula, scope, chain));
}

/**
 * The effect an `addEffect` outcome puts in play, its numbers worked out now,
 * read back as effects in play are; undefined when nothing of it can be
 * stored. `dropped` names each part ("2 (sense)") whose numbers came out where
 * an effect in play cannot hold them, such as a negative range. `id` is the
 * effect's own: one of the same name already in play is replaced rather than
 * added beside it.
 */
export function effectNow(
  o: Extract<ReadOutcome, { kind: 'addEffect' }>,
  scope: FormulaScope,
  chain: MomentChain,
  id: string = randomId(),
): { effect: ActiveEffect | undefined; dropped: string[] } {
  const dropped: string[] = [];
  const parts: Record<string, unknown>[] = [];
  o.effects.forEach((t, i) => {
    const part: Record<string, unknown> = structuredClone(t.effect);
    for (const slot of t.formulas ?? []) part[slot.field] = work(slot.formula, scope, chain);
    if (holds(part)) parts.push(part);
    else dropped.push(`${o.places[i] ?? i + 1} (${t.effect.kind})`);
  });
  const candidate = {
    id,
    name: o.name,
    parts,
    ...(o.lasts !== undefined ? { lasts: o.lasts } : {}),
  };
  const [effect] = readActiveEffects([candidate]).effects;
  return {
    effect: effect === undefined || effect.parts.length === 0 ? undefined : effect,
    dropped,
  };
}

/** The pool `name` names: by key, else by its label, either way ignoring case. */
export function poolNamed(
  inForce: MomentsInForce,
  name: string,
): MomentsInForce['pools'][number] | undefined {
  const lower = name.toLowerCase();
  return (
    inForce.pools.find((p) => p.key.toLowerCase() === lower) ??
    inForce.pools.find((p) => p.label.toLowerCase() === lower)
  );
}

/** What moments did, for the sheet to say. Absent from a result when no moment fired. */
export interface MomentReport {
  /** Each change to the character, one line each: "Exhaustion 1", "+5 temporary HP". */
  done: Array<{ text: string; from: string }>;
  /** Lines to show the player, from `cue` outcomes. */
  cues: Array<{ text: string; tone: CueTone; from: string }>;
  /** Dice or choices to offer, from `offer` outcomes. */
  offers: Array<{ label: string; dice?: string; from: string }>;
  /** Outcomes that could not happen (no pool of that name), worded for the player. */
  problems: string[];
}

export const emptyReport = (): MomentReport => ({ done: [], cues: [], offers: [], problems: [] });

/** Join what a later step reported onto an earlier one. */
export function joinReports(into: MomentReport, more: MomentReport | undefined): void {
  if (more === undefined) return;
  into.done.push(...more.done);
  into.cues.push(...more.cues);
  into.offers.push(...more.offers);
  into.problems.push(...more.problems);
}

export const reportIsEmpty = (r: MomentReport): boolean =>
  r.done.length + r.cues.length + r.offers.length + r.problems.length === 0;

/** The most levels a condition can have: Exhaustion's six, 1 for any other. */
export const levelsOf = (condition: string): number =>
  condition === 'Exhaustion' ? MOST_LEVELS : 1;
