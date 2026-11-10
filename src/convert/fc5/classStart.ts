/**
 * A Fight Club class's start notes, the optional features named `Starting
 * Barbarian` and `Multiclass Barbarian` (`Becoming a Barbarian as a Multiclass
 * Character` in a 2024 file). The class's tags already give a first class's
 * proficiencies; these notes give what the tags do not:
 *
 * - a multiclass note's ability score minimum (`Strength 13`, `Strength 13 or
 *   Dexterity 13`) and the proficiencies a later class gains (`Armor: shields`,
 *   `Armor Training: Shields`), as 5etools' `multiclassing`;
 * - a starting note's equipment lines (`(a) a greataxe or (b) any martial
 *   melee weapon`), as `startingEquipment.default`.
 */
import { abilityKey, type Entry } from './text';

/** Whether a start note is a multiclass one, not a first class's. */
const MULTICLASS = /^multiclass |multiclass character$/i;

export function isMulticlassNote(name: string): boolean {
  return MULTICLASS.test(name);
}

/** Every line of a note's text, list items included, in order. */
function linesOf(entries: readonly Entry[]): string[] {
  const out: string[] = [];
  const walk = (e: unknown, depth: number): void => {
    if (depth > 6) return;
    if (typeof e === 'string') out.push(e.replace(/\s+/g, ' ').trim());
    else if (Array.isArray(e)) for (const x of e) walk(x, depth + 1);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      walk(o.items ?? o.entries, depth + 1);
    }
  };
  walk(entries, 0);
  return out.filter((l) => l !== '');
}

/** `Armor:`, `Armor Training:`, `Weapon Proficiencies:` and the like, by what they list. */
const PROFICIENCY_LINE =
  /^(armor(?: training| proficienc(?:y|ies))?|weapons?(?: proficienc(?:y|ies))?|tools?(?: proficienc(?:y|ies))?|skills?(?: proficienc(?:y|ies))?): ?(.{0,400})$/i;

export interface MulticlassNote {
  /** `{ str: 13 }`, `{ or: [{ str: 13 }, { dex: 13 }] }`. */
  requirements?: Record<string, unknown>;
  /** The proficiency lines a later class gains, as written. */
  armor?: string;
  weapons?: string;
  tools?: string;
  skills?: string;
  /** Lines naming abilities the converter could not read as a minimum. */
  unread: string[];
}

/**
 * A line of ability scores alone (`Strength 13, and`, `Strength, Dexterity,
 * or Constitution 13`), as words; undefined for any other line.
 */
function abilityWords(line: string): string[] | undefined {
  const words = line
    .toLowerCase()
    .split(/[\s,.;]+/)
    .filter((w) => w !== '');
  const ok = words.every(
    (w) => abilityKey(w) !== undefined || /^\d{1,2}$/.test(w) || w === 'and' || w === 'or',
  );
  return ok && words.some((w) => abilityKey(w) !== undefined) ? words : undefined;
}

/**
 * Ability words as a minimum: all of them when joined by `and`, any one when
 * by `or`. A number names the score of the abilities before it that have none.
 */
function requirementsOf(words: readonly string[]): Record<string, unknown> | undefined {
  const scores: [string, number][] = [];
  let waiting: string[] = [];
  for (const w of words) {
    const key = abilityKey(w);
    if (key !== undefined) waiting.push(key);
    else if (/^\d{1,2}$/.test(w)) {
      for (const k of waiting) scores.push([k, Number(w)]);
      waiting = [];
    }
  }
  if (waiting.length > 0 || scores.length === 0) return undefined;
  const any = words.includes('or');
  if (any && words.includes('and')) return undefined;
  if (any) return { or: scores.map(([k, n]) => ({ [k]: n })) };
  return Object.fromEntries(scores);
}

/** A multiclass note's minimum and proficiencies; undefined when it names neither. */
export function readMulticlass(entries: readonly Entry[]): MulticlassNote | undefined {
  const note: MulticlassNote = { unread: [] };
  const words: string[] = [];
  let found = false;
  for (const line of linesOf(entries)) {
    const ability = abilityWords(line);
    if (ability !== undefined) {
      // One minimum may run over two items (`Strength 13, and`, `Charisma 13`).
      words.push(...ability);
      continue;
    }
    const m = PROFICIENCY_LINE.exec(line);
    if (m === null) continue;
    found = true;
    const what = (m[1] ?? '').toLowerCase();
    const list = (m[2] ?? '').trim();
    const field = what.startsWith('armor')
      ? 'armor'
      : what.startsWith('weapon')
        ? 'weapons'
        : what.startsWith('tool')
          ? 'tools'
          : 'skills';
    if (note[field] === undefined) note[field] = list;
  }
  if (words.length > 0) {
    const req = requirementsOf(words);
    if (req === undefined) note.unread.push(words.join(' '));
    else note.requirements = req;
    found = true;
  }
  return found ? note : undefined;
}

/** A 2024 note's `Primary Ability: Strength or Dexterity`. */
const PRIMARY = /^primary abilit(?:y|ies): ?(.{1,120})$/i;

/**
 * A 2024 note's primary ability, as XPHB writes it: one object per ability
 * any one of which will do (`Strength or Dexterity`), or one of them all
 * (`Dexterity and Wisdom`). Undefined when a note names none or both kinds.
 */
export function readPrimaryAbility(
  entries: readonly Entry[],
): Record<string, boolean>[] | undefined {
  for (const line of linesOf(entries)) {
    const m = PRIMARY.exec(line);
    const words = m === null ? undefined : abilityWords(m[1] ?? '');
    if (words === undefined) continue;
    const keys = words.flatMap((w) => abilityKey(w) ?? []);
    if (words.includes('or') && words.includes('and')) return undefined;
    return words.includes('or')
      ? keys.map((k) => ({ [k]: true }))
      : [Object.fromEntries(keys.map((k) => [k, true]))];
  }
  return undefined;
}

/** `You begin play with the following equipment`, and the 2024 `Starting Equipment:`. */
const EQUIPMENT_LEAD =
  /^you (?:begin play|start) with the following equipment|^starting equipment:?$/i;

/** The equipment lines of a starting note: the list after its lead-in. */
export function readEquipment(entries: readonly Entry[]): string[] | undefined {
  const out: string[] = [];
  let after = false;
  const walk = (e: unknown, depth: number): boolean => {
    if (depth > 6) return false;
    if (typeof e === 'string') {
      if (EQUIPMENT_LEAD.test(e.trim())) after = true;
      return false;
    }
    if (Array.isArray(e)) return e.some((x) => walk(x, depth + 1));
    if (e === null || typeof e !== 'object') return false;
    const o = e as Record<string, unknown>;
    if (after && o.type === 'list' && Array.isArray(o.items)) {
      for (const item of o.items) {
        if (typeof item === 'string' && item.trim() !== '')
          out.push(item.replace(/\s+/g, ' ').trim());
      }
      return true;
    }
    return walk(o.entries, depth + 1);
  };
  walk(entries, 0);
  return out.length > 0 ? out : undefined;
}
