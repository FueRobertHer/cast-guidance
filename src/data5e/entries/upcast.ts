/**
 * How a spell's dice grow with a higher slot, read from its text: the slot
 * levels an upcast tag lists, the slot levels a sentence names, a step from
 * the text where no tag gives one, and the dice a sentence sets outright
 * ("the damage increases to 3d8"). Shared by the sheet's cast rolls, the
 * rules text's roll chips and the Fight Club converter.
 *
 * Relative imports only: the data audit loads the cast rolls under plain Bun.
 */

/** All prose in entries, flattened: strings, names, and the entries, items and rows under them. */
export function entriesText(entries: unknown): string {
  const out: string[] = [];
  const walk = (e: unknown) => {
    if (typeof e === 'string') out.push(e);
    else if (Array.isArray(e)) e.forEach(walk);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (typeof o.name === 'string') out.push(o.name);
      walk(o.entries);
      walk(o.items);
      walk(o.rows);
    }
  };
  walk(entries);
  return out.join('\n');
}

/**
 * The slot levels an upcast tag lists: single levels and ranges, comma
 * separated ("2-9", or "2,4,6,8" for a spell that grows every two levels).
 * Undefined for any other shape.
 */
export function tagLevels(list: string): number[] | undefined {
  const levels = new Set<number>();
  for (const part of list.split(',')) {
    const range = part.trim().match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
    if (range === null) return undefined;
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    for (let level = from; level <= to; level++) levels.add(level);
  }
  return levels.size > 0 ? [...levels].sort((a, b) => a - b) : undefined;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const ORDINAL = '(\\d)(?:st|nd|rd|th)';

/** The ways a sentence names the slots it is about, each with the levels it means. */
const SLOT_PHRASES: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => number[]]> = [
  // "a spell slot of 7th level or higher"
  [new RegExp(`spell slot of ${ORDINAL} level or higher`, 'gi'), (m) => range(Number(m[1]), 9)],
  // "a spell slot of 5th or 6th level"
  [
    new RegExp(`spell slot of ${ORDINAL} or ${ORDINAL} level`, 'gi'),
    (m) => [Number(m[1]), Number(m[2])],
  ],
  // "a 3rd- or 4th-level spell slot"
  [
    new RegExp(`${ORDINAL}- or ${ORDINAL}-level spell slot`, 'gi'),
    (m) => [Number(m[1]), Number(m[2])],
  ],
  // "a level 5-6 spell slot"
  [/level (\d)-(\d) spell slot/gi, (m) => range(Number(m[1]), Number(m[2]))],
  // "a level 7+ spell slot"
  [/level (\d)\+ spell slot/gi, (m) => range(Number(m[1]), 9)],
];

/**
 * The slot levels a text names ("using a 3rd- or 4th-level spell slot"), if it
 * names them in a way this reads; of several, the one nearest its end, since
 * that is the one nearest the tag that follows.
 */
export function slotLevelsOf(text: string): number[] | undefined {
  let nearest: { at: number; levels: number[] } | undefined;
  for (const [pattern, levels] of SLOT_PHRASES) {
    for (const m of text.matchAll(pattern)) {
      const at = m.index ?? 0;
      if (nearest === undefined || at > nearest.at) nearest = { at, levels: levels(m) };
    }
  }
  return nearest?.levels;
}

/**
 * The slots dice set outright apply at: those the clause right after the tag
 * names ("increases to 3d8 with a 3rd- or 4th-level spell slot"), else those
 * nearest before it in its sentence. `before` runs from the sentence's start to
 * the tag, `after` from the tag on.
 */
export function setDiceLevels(before: string, after: string): number[] | undefined {
  return slotLevelsOf(after.split(/[,;.]|\band\b/i)[0] ?? '') ?? slotLevelsOf(before);
}

/** "4, 6 and 8", "5 and 6", or "7 to 9" for a run of three or more. */
export function slotLevelsLabel(levels: readonly number[]): string {
  const sorted = [...levels].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return '';
  if (sorted.length >= 3 && last - first === sorted.length - 1) return `${first} to ${last}`;
  if (sorted.length === 1) return String(first);
  return `${sorted.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Whether the words around a tag say it sets the dice outright: "the damage
 * increases to" before it, and no "for each slot level" after it, which makes
 * it a step after all.
 */
export function setsDice(before: string, after = ''): boolean {
  return /\bincreases? to\s*$/i.test(before) && !/^\s*for (?:each|every)\b/i.test(after);
}

/** A roll tag's dice, by kind, from text: `{@damage 3d6}`, `{@dice 1d8+3}`. */
const ROLL_TAG = /\{@(damage|dice) (\d{1,3})d(\d{1,3})([+-]\d{1,3})?\}/g;

/**
 * The one roll of a kind and die in the text, or undefined when there is none
 * or more than one: the upcast step needs to know which roll it grows.
 */
export function onlyRoll(text: string, kind: string, sides: string): string | undefined {
  const found = new Set<string>();
  for (const m of text.matchAll(ROLL_TAG)) {
    if (m[1] === kind && m[3] === sides) found.add(`${m[2]}d${m[3]}${m[4] ?? ''}`);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** "the damage increases by {@dice 1d6} for each slot level above 1st". */
const UPCAST_STEP =
  /\b(damage|healing)\b[^.]{0,80}? increases? by \{@(?:dice|damage) (\d{1,3}d(\d{1,3}))\} for each (?:spell )?slot level above/i;

/**
 * The upcast tag from the text alone, for a spell without one: "the damage
 * increases by 1d6 for each slot level above 1st" over the spell's one damage
 * roll of that die (`{@scaledamage 3d6|1-9|1d6}`), or the healing over its one
 * roll (`{@scaledice 1d8|1-9|1d8}`). A text that caps the increase says nothing
 * reliable about the top slot, so it stays as it is.
 */
export function textUpcastTag(
  entries: unknown,
  higher: unknown,
  spellLevel: number,
): string | undefined {
  const higherText = entriesText(higher);
  if (/\bmaximum\b/i.test(higherText)) return undefined;
  // Two steps ("the initial damage increases by 1d8 and the later damage by 1d6") are more than one tag holds.
  if ((higherText.match(/ by \{@(?:dice|damage) /g) ?? []).length > 1) return undefined;
  const step = UPCAST_STEP.exec(higherText);
  if (step === null) return undefined;
  const healing = (step[1] ?? '').toLowerCase() === 'healing';
  const base = onlyRoll(entriesText(entries), healing ? 'dice' : 'damage', step[3] ?? '');
  if (base === undefined) return undefined;
  return `{@scale${healing ? 'dice' : 'damage'} ${base}|${spellLevel}-9|${step[2]}}`;
}

/** Dice a sentence sets for the slots it names: Shadow Blade's 3d8 at 3rd and 4th. */
export interface SetDice {
  /** The roll in the spell's own text that these dice replace. */
  base: string;
  levels: number[];
  expr: string;
}

/** A roll or scale tag: `{@damage 3d8}`, `{@scaledamage 1d4|3-9|2d4}`. */
const ROLL_OR_SCALE =
  /\{@(damage|dice|scaledamage|scaledice) ([^}|]{1,40})(?:\|([^}|]{1,40})\|([^}|]{1,40}))?(?:\|[^}]{0,40})?\}/gi;

/**
 * Every tag of the higher-level text that sets a roll's dice outright ("the
 * damage increases to {@damage 3d8}") for the slots its sentence names. A plain
 * roll replaces the spell's one roll of its kind and die; a scale tag names the
 * roll it replaces, and its last part is the new dice. A tag whose slots this
 * cannot read sets nothing.
 */
export function setDiceOf(entries: unknown, higher: unknown): SetDice[] {
  const main = entriesText(entries);
  const out: SetDice[] = [];
  for (const sentence of entriesText(higher).split(/(?<=\.)\s+/)) {
    for (const m of sentence.matchAll(ROLL_OR_SCALE)) {
      const start = m.index ?? 0;
      const before = sentence.slice(0, start);
      const after = sentence.slice(start + m[0].length);
      if (!setsDice(before, after)) continue;
      const levels = setDiceLevels(before, after);
      if (levels === undefined) continue;
      const first = (m[2] ?? '').replaceAll(' ', '');
      const scaled = m[4] !== undefined;
      const expr = scaled ? (m[4] ?? '').replaceAll(' ', '') : first;
      const sides = /d(\d{1,3})$/i.exec(expr)?.[1];
      const kind = /dice$/i.test(m[1] ?? '') ? 'dice' : 'damage';
      const base = scaled ? first : sides === undefined ? undefined : onlyRoll(main, kind, sides);
      if (base !== undefined && base !== expr) out.push({ base, levels, expr });
    }
  }
  return out;
}
