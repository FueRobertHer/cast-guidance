/**
 * What every card file shares: how stored values read in a sentence, how a
 * box shows them, and the boxes' choices for what any card may hold (a state,
 * a rules version). A value a file gives that no box offers shows as written.
 */
import { EFFECT_EDITIONS, isRecord } from '@/engine/castGuidance';
import { signed } from '@/lib/signed';
import { ABILITY_WORDS } from '../../fields';
import type { Eff, FieldSpec, Options } from './types';

export const ABILITY: Options = ABILITY_WORDS;

export const STATES: Options = [
  ['', 'Always'],
  ['bloodied', 'While bloodied'],
  ['concentrating', 'While concentrating'],
  ['noArmor', 'While wearing no armor'],
  ['shield', 'While holding a shield'],
];

/**
 * The rules version an effect counts under alone (`edition`), as a card's (and
 * a class's pool's) "Rules" box offers it. "Either rules" takes it away.
 */
export const EDITIONS: Options = [
  ['', 'Either rules'],
  ['2014', '2014 rules only'],
  ['2024', '2024 rules only'],
];
export const editionOf = (e: Eff) =>
  EFFECT_EDITIONS.find((v) => v === e.edition) as (typeof EFFECT_EDITIONS)[number] | undefined;

/** The Rules box's choice for an `edition` a file gives that is not a rules version. */
export const AS_WRITTEN = 'as written';

/**
 * A Rules box's value and choices. An `edition` a file gives that is not a
 * rules version shows as written, so "Either rules" is a change that takes it away.
 */
export function editionBox(e: Eff): { value: string; options: Options } {
  const edition = editionOf(e);
  if (edition !== undefined || e.edition === undefined)
    return { value: edition ?? '', options: EDITIONS };
  const raw = typeof e.edition === 'string' ? e.edition : JSON.stringify(e.edition);
  return {
    value: AS_WRITTEN,
    options: [...EDITIONS, [AS_WRITTEN, `${raw} (not a rules version)`]],
  };
}

export const word = (options: Options, v: unknown) =>
  options.find(([k]) => k === v)?.[1] ?? String(v);

/** Words as a sentence lists them: "Strength", "Strength and Dexterity", "A, B and C". */
export function listed(xs: readonly string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

/** A stored number as a sentence reads it: `+2`, or the formula itself. */
export function amount(v: unknown, sign = true): string {
  if (typeof v === 'number') return sign ? signed(v) : String(v);
  if (typeof v === 'object' && v !== null && 'f' in v) return `(${String(v.f)})`;
  return 'a number by level';
}

/** A stored level table (`{ "byLevel": ... }`), of numbers or of words. */
export const isByLevel = (v: unknown): v is { byLevel: Record<string, unknown> } =>
  isRecord(v) && isRecord(v.byLevel);

/** Stored words as one value: a level table's first level's, else as written. */
export function firstWords(v: unknown): string {
  if (!isByLevel(v)) return String(v);
  const [first] = Object.entries(v.byLevel).sort(([a], [b]) => Number(a) - Number(b));
  return first === undefined ? '' : String(first[1]);
}

/** Stored words as a sentence reads them: a level table's by its first level's. */
export function words(v: unknown): string {
  if (!isByLevel(v)) return String(v);
  const first = firstWords(v);
  return first === '' ? 'words by level' : `${first}, by level`;
}

/**
 * What a box shows for a level table, which a file may hold and no box edits:
 * picking or typing a value puts that one value in its place.
 */
export const BY_LEVEL = 'By level, as written';

/** A stored table of words by an answer or a spell granted (`byAnswer`, `byGrant`). */
export const isByAnswer = (v: unknown): v is Record<string, unknown> =>
  isRecord(v) && (v.byAnswer !== undefined || v.byGrant !== undefined);

/** A table of words by an answer or a spell granted, as a sentence reads it. */
export const byAnswerWords = (v: Record<string, unknown>) =>
  v.byGrant !== undefined ? 'by the spell granted' : `by the answer to ${String(v.byAnswer)}`;

/**
 * What a box shows for a table a file may hold and no box edits (by level, by an
 * answer, by a spell granted), or nothing for a value a box does edit. Picking or
 * typing a value puts that one value in its place.
 */
export function asWritten(v: unknown): string | undefined {
  if (isByLevel(v)) return BY_LEVEL;
  if (!isByAnswer(v)) return undefined;
  const said = byAnswerWords(v);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}, as written`;
}

/** The effect with these fields taken away. */
export const omit = (e: Eff, keys: readonly string[]): Eff =>
  Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))) as Eff;

/** A bonus as a line reads it: `+2`, `+(max(1, mod.int))`, or by level. */
export function bonusWords(v: unknown): string {
  if (typeof v === 'number') return signed(v);
  if (isRecord(v) && 'f' in v) return `+(${String(v.f)})`;
  return '+a number by level';
}

/** A box's choices, with a value a file gives that none of them is shown as written. */
export function offering(options: Options, value: string, written: string): Options {
  return options.some(([v]) => v === value) ? options : [...options, [value, written]];
}

/** A stored value as a box holds it: one a box can mean as it is, any other as JSON. */
export const held = (v: unknown, means: (x: unknown) => boolean): string =>
  means(v) ? String(v) : (JSON.stringify(v) ?? '');
export const isString = (x: unknown) => typeof x === 'string';
export const isNumber = (x: unknown) => typeof x === 'number';

export const amountField: FieldSpec = { key: 'amount', label: 'Amount', type: 'amount' };

/**
 * A When box's value and choices. A state a file gives that the box has no
 * choice for (at 0 hit points, while an effect lasts) shows as written, so
 * "Always" is a change that takes it away. It offers the states the reader
 * `accepts` for it: a kind that folds before hit points are known cannot wait
 * for bloodied.
 */
export function stateBox(
  e: Eff,
  accepts: (state: string) => boolean = () => true,
): { value: string; options: Options } {
  const options = STATES.filter(([v]) => v === '' || accepts(v));
  if (e.while === undefined) return { value: '', options };
  if (typeof e.while === 'string' && options.some(([v]) => v === e.while)) {
    return { value: e.while, options };
  }
  const states = Array.isArray(e.while) ? e.while : [e.while];
  const said = states.map(stateWords).join(' and ');
  return { value: AS_WRITTEN, options: [...options, [AS_WRITTEN, `${said}, as written`]] };
}

/** One stored state in words: "while Rage lasts", "while at 0 hit points". */
function stateWords(s: unknown): string {
  if (s === 'zeroHp') return 'While at 0 hit points';
  if (typeof s === 'string') return word(STATES, s);
  if (typeof s === 'object' && s !== null) {
    const { effect, condition } = s as Record<string, unknown>;
    if (typeof effect === 'string') return `While ${effect} lasts`;
    if (typeof condition === 'string') return `While ${condition}`;
  }
  return JSON.stringify(s);
}

/** A field's value as its box shows it. */
export function shown(e: Eff, f: FieldSpec): string {
  const v = e[f.key];
  // A table has no box of its own: the box offers to replace it (`asWritten`).
  if (v === undefined || asWritten(v) !== undefined) return '';
  if (typeof v === 'object' && v !== null && 'f' in v) return String(v.f);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A box's text as the field stores it: a whole number stays a number, anything else is a formula. */
export function stored(f: FieldSpec, text: string): unknown {
  if (f.type === 'pick') return f.key === 'level' ? Number(text) : text;
  if (f.type !== 'amount') return text;
  const t = text.trim();
  if (f.key === 'speed' && t === 'walk') return t;
  return /^-?\d+$/.test(t) ? Number(t) : { f: t };
}

/** `{pick}` and its forms in a card's words, said for what each pick gives. */
export const pickedWords = (s: string) =>
  // A key made around its slug ("sig-{pick.slug}", a pool's) is said whole;
  // words beside the others stay.
  s.replaceAll(/[\w-]*\{pick\.slug\}[\w-]*|\{pick(?:\.title)?\}/g, 'the one picked');

/** A stored value standing for the one picked. */
export const PICKED = '{pick}';
