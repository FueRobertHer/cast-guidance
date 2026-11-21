/**
 * What a class page lists beside its features (review finding 43): the
 * proficiencies a class starts with, and its level table (proficiency bonus
 * and the class's own columns, such as Rages or spell slots). Plain data in,
 * strings out, the strings keeping the data's inline tags (`{@item ...}`) for
 * the page to render as links.
 */
import type { Entity } from '@/data5e/copyMod';
import { signed } from '@/lib/signed';

const ARMOR: Readonly<Record<string, string>> = {
  light: 'Light armor',
  medium: 'Medium armor',
  heavy: 'Heavy armor',
  shield: 'Shields',
};

const WEAPONS: Readonly<Record<string, string>> = {
  simple: 'Simple weapons',
  martial: 'Martial weapons',
  firearms: 'Firearms',
};

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One proficiency as the data writes it: a word, a tagged name, or `{ proficiency, full }`. */
function proficiencyText(value: unknown, words: Readonly<Record<string, string>>): string[] {
  if (typeof value === 'string') {
    const word = words[value.toLowerCase()];
    return [word ?? capitalized(value)];
  }
  if (typeof value !== 'object' || value === null) return [];
  const { proficiency, full, optional } = value as {
    proficiency?: unknown;
    full?: unknown;
    optional?: unknown;
  };
  const text =
    typeof full === 'string'
      ? capitalized(full)
      : typeof proficiency === 'string'
        ? (words[proficiency.toLowerCase()] ?? capitalized(proficiency))
        : undefined;
  if (text === undefined) return [];
  return [optional === true ? `${text} (optional rule)` : text];
}

/** A skill list entry: a choice from named skills, any skills, or named skills outright. */
function skillText(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const v = value as { choose?: { from?: unknown; count?: unknown }; any?: unknown };
  if (v.choose !== undefined) {
    const from = Array.isArray(v.choose.from) ? v.choose.from.map(String) : [];
    const count = typeof v.choose.count === 'number' ? v.choose.count : 1;
    if (from.length === 0) return [];
    return [`Choose ${count} from ${from.map((s) => capitalized(s)).join(', ')}`];
  }
  if (typeof v.any === 'number') return [`Any ${v.any} skill${v.any === 1 ? '' : 's'}`];
  const named = Object.entries(v)
    .filter(([, on]) => on === true)
    .map(([name]) => capitalized(name));
  return named.length > 0 ? [named.join(', ')] : [];
}

/** A tool list entry from the 2024 `toolProficiencies`: `{ "thieves' tools": true }`, `{ anyMusicalInstrument: 3 }`. */
function toolObjectText(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, on]) => {
    if (on === true) return [capitalized(name)];
    if (typeof on === 'number') {
      const what = name
        .replace(/^any/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase();
      return [`Any ${on} ${what}${on === 1 ? '' : 's'}`];
    }
    return [];
  });
}

/**
 * The proficiencies a class starts with, as [label, text] rows: Armor,
 * Weapons, Tools and Skills, each present only when the class grants some.
 */
export function classProficiencies(e: Entity): Array<[string, string]> {
  const start = e.startingProficiencies;
  if (typeof start !== 'object' || start === null) return [];
  const p = start as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const rows: Array<[string, string[]]> = [
    ['Armor', list(p.armor).flatMap((v) => proficiencyText(v, ARMOR))],
    ['Weapons', list(p.weapons).flatMap((v) => proficiencyText(v, WEAPONS))],
    [
      'Tools',
      list(p.tools).length > 0
        ? list(p.tools).flatMap((v) => proficiencyText(v, {}))
        : list(p.toolProficiencies).flatMap(toolObjectText),
    ],
    ['Skills', list(p.skills).flatMap(skillText)],
  ];
  return rows
    .filter(([, parts]) => parts.length > 0)
    .map(([label, parts]) => [label, parts.join(', ')]);
}

/** One column group of a class's table, as the data has it. */
interface TableGroup {
  title?: string;
  colLabels: string[];
  rows: unknown[][];
  /** Spell slots, where a 0 is a slot level not reached yet. */
  slots: boolean;
}

function tableGroups(e: Entity): TableGroup[] {
  if (!Array.isArray(e.classTableGroups)) return [];
  return e.classTableGroups.flatMap((g): TableGroup[] => {
    if (typeof g !== 'object' || g === null) return [];
    const { title, colLabels, rows, rowsSpellProgression } = g as Record<string, unknown>;
    if (!Array.isArray(colLabels)) return [];
    const slots = Array.isArray(rowsSpellProgression);
    const body = slots ? rowsSpellProgression : rows;
    if (!Array.isArray(body)) return [];
    return [
      {
        title: typeof title === 'string' ? title : undefined,
        colLabels: colLabels.map(String),
        rows: body.map((r) => (Array.isArray(r) ? r : [])),
        slots,
      },
    ];
  });
}

/** A table cell as the book prints it: a number, a die, a bonus, or text. */
export function cellText(value: unknown, slots = false): string {
  if (typeof value === 'number') return slots && value === 0 ? '-' : String(value);
  if (typeof value === 'string') return value === '' ? '-' : value;
  if (typeof value !== 'object' || value === null) return '-';
  const v = value as { type?: unknown; value?: unknown; toRoll?: unknown };
  if (v.type === 'dice' && Array.isArray(v.toRoll)) {
    return v.toRoll
      .map((d: { number?: number; faces?: number }) => `${d.number ?? 1}d${d.faces ?? '?'}`)
      .join(' + ');
  }
  if (v.type === 'bonus' && typeof v.value === 'number') return signed(v.value);
  if (v.type === 'bonusSpeed' && typeof v.value === 'number') {
    return v.value === 0 ? '-' : `+${v.value} ft.`;
  }
  return typeof v.value === 'number' || typeof v.value === 'string' ? String(v.value) : '-';
}

/** The proficiency bonus at a class level, which every class shares. */
export const proficiencyBonus = (level: number) => 2 + Math.floor((level - 1) / 4);

/** A class's level table: its column groups and a row per level, 1 to 20. */
export interface ClassTable {
  /** Each group with its columns; a title spans its columns in a second header row. */
  groups: ReadonlyArray<{ title?: string; labels: readonly string[] }>;
  /** Per level, the cells of every group in order, already in words. */
  rows: ReadonlyArray<{ level: number; cells: readonly string[] }>;
}

export function classTable(e: Entity): ClassTable {
  const groups = tableGroups(e);
  const rows = Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    cells: groups.flatMap((g) => g.colLabels.map((_, c) => cellText(g.rows[i]?.[c], g.slots))),
  }));
  return { groups: groups.map((g) => ({ title: g.title, labels: g.colLabels })), rows };
}
