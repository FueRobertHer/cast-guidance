/**
 * Everything the engine hands to `proseScanFeature`, listed from a normalized
 * registry: named race and subrace traits, class and subclass features, feats
 * and optional features. Each becomes one subject, with the effects the
 * scanner draws from it and the readable text a judge (a person or Jev) reads
 * to say what the prose really grants.
 *
 * Subjects are keyed by a hash of that text, so `_versions` and `_copy`
 * duplicates collapse into one question, and a judgment stays valid until the
 * words change.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import { CURATED } from '../../engine/curated/curatedEffects';
import { Collector } from '../../engine/effects/base';
import { proseScanFeature } from '../../engine/effects/proseScan';
import { type EffectInput, newCharacterDoc } from '../../engine/types';
import type { Entity } from '../copyMod';
import { plainEntryText } from '../entries/plainText';
import type { EntityType } from '../normalize';

export type ProseSubjectType =
  | 'race'
  | 'subrace'
  | 'classFeature'
  | 'subclassFeature'
  | 'feat'
  | 'optionalfeature';

export interface ProseSubject {
  /** Hash of `state`: the identity a saved judgment is filed under. */
  key: string;
  /** Who it belongs to, for people reading a report: `Rage (Barbarian|PHB)`. */
  label: string;
  /** The trait or feature name the scanner sees. */
  name: string;
  type: ProseSubjectType;
  /** The name and readable prose, as a judge reads it. */
  state: string;
  /** How many entities share this exact prose. */
  owners: number;
  /**
   * Every owner has a curated entry, so the engine never scans it and the
   * scanner's output for it is not what any sheet shows.
   */
  curated: boolean;
  /** What `proseScanFeature` draws from the prose. */
  effects: EffectInput[];
}

/** Anything a registry can list by type. */
export interface ByType {
  byType(type: EntityType): readonly Entity[];
}

/**
 * cyrb53: a fast 53-bit string hash. Collisions are not a security concern
 * here, only a correctness one, and at a few thousand subjects 53 bits leaves
 * them vanishingly unlikely.
 */
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export interface ReadableOptions {
  /** Read `table` entries too. */
  tables?: boolean;
  /** How to read a string's tags, and a name's; `plainEntryText` and as written when not given. */
  tagText?: (text: string) => string;
}

/**
 * Entries as plain paragraphs, case kept and tags shown as their display
 * text. Named sub-entries keep their name as a lead-in ("Longtooth. ..."), so
 * a judge can tell an option the player picks from what the trait always does.
 *
 * This text is what a subject's key hashes. Reading a tag differently re-keys
 * exactly the subjects whose words move, and their answers wait to be asked
 * again; `bun run data:judge -- --dry-run` counts them before anyone pays. So
 * the defaults stay put, and a reader that wants more asks through the options.
 */
export function readableEntries(entries: unknown, options: ReadableOptions = {}): string {
  const { tables = false, tagText = plainEntryText } = options;
  const lines: string[] = [];
  /** Plain text, a number, or a `cell` object with a roll and an entry. */
  const cellText = (cell: unknown): string => {
    if (typeof cell === 'number') return String(cell);
    if (cell === null || typeof cell !== 'object') return readableEntries(cell, options);
    const roll = (cell as Record<string, unknown>).roll as
      | { exact?: number; min?: number; max?: number }
      | null
      | undefined;
    const rolled = roll ? String(roll.exact ?? `${String(roll.min)}-${String(roll.max)}`) : '';
    return [rolled, readableEntries(cell, options)].filter((s) => s !== '').join(' ');
  };
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      lines.push(tagText(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const start = lines.length;
      walk(o.entries);
      walk(o.entry);
      walk(o.items);
      if (tables && o.type === 'table') {
        walk(o.caption);
        for (const row of [o.colLabels, ...(Array.isArray(o.rows) ? o.rows : [])]) {
          if (Array.isArray(row)) lines.push(row.map(cellText).join(' | '));
        }
        walk(o.footnotes);
      }
      if (typeof o.name === 'string' && lines.length > start) {
        // Names are read as written unless a reader asks: see the note above.
        const name = options.tagText?.(o.name) ?? o.name;
        lines[start] = `${name}. ${lines[start]}`;
      }
    }
  };
  walk(entries);
  return lines.join('\n');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const lower = (...parts: string[]) => parts.join('|').toLowerCase();

/** An engine context with nothing in it, for running a collector on one entity alone. */
export const NO_DATA = { get: () => undefined, byType: () => [] };

/** What the scanner draws from one trait, for a character with no class levels. */
function scan(name: string, entries: unknown): EffectInput[] {
  const col = new Collector(newCharacterDoc('audit', 'audit', 'audit'), NO_DATA);
  proseScanFeature(col, name, entries, { label: name, uid: 'audit', type: 'feat' });
  return col.effects;
}

interface Owner {
  type: ProseSubjectType;
  name: string;
  label: string;
  entries: unknown;
  /** The curated key the engine tries before it falls back to the scanner. */
  curatedKey: string;
}

function* owners(registry: ByType): Generator<Owner> {
  for (const type of ['race', 'subrace'] as const) {
    for (const e of registry.byType(type)) {
      const entries = Array.isArray(e.entries) ? e.entries : [];
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue;
        const name = (entry as Entity).name;
        if (typeof name !== 'string' || name === '') continue;
        yield {
          type,
          name,
          label: `${name} (${str(e.name)}|${str(e.source)})`,
          entries: (entry as Entity).entries,
          curatedKey: `trait:${name.toLowerCase()}`,
        };
      }
    }
  }

  for (const e of registry.byType('classFeature')) {
    const name = str(e.name);
    yield {
      type: 'classFeature',
      name,
      label: `${name} (${str(e.className)}|${str(e.source)})`,
      entries: e.entries,
      curatedKey: lower(name, str(e.className)),
    };
  }

  // A subclass feature's curated key names the subclass by its full name,
  // while the feature itself only carries the short one.
  const subclassNames = new Map<string, string>();
  for (const sub of registry.byType('subclass')) {
    const id = lower(str(sub.className), str(sub.shortName), str(sub.source));
    subclassNames.set(id, str(sub.name));
  }
  for (const e of registry.byType('subclassFeature')) {
    const name = str(e.name);
    const shortName = str(e.subclassShortName);
    const subName =
      subclassNames.get(lower(str(e.className), shortName, str(e.subclassSource))) ?? shortName;
    yield {
      type: 'subclassFeature',
      name,
      label: `${name} (${str(e.className)}: ${subName}|${str(e.source)})`,
      entries: e.entries,
      curatedKey: lower(name, subName),
    };
  }

  for (const type of ['feat', 'optionalfeature'] as const) {
    for (const e of registry.byType(type)) {
      const name = str(e.name);
      yield {
        type,
        name,
        label: `${name} (${type === 'feat' ? 'feat' : 'optional feature'}|${str(e.source)})`,
        entries: e.entries,
        curatedKey: lower(name, str(e.source)),
      };
    }
  }
}

/**
 * Every scanned trait and feature in the registry, one subject per distinct
 * prose, in registry order. Traits with no prose are left out: there is
 * nothing to scan or to judge.
 */
export function proseSubjects(registry: ByType): ProseSubject[] {
  const byKey = new Map<string, ProseSubject>();
  for (const owner of owners(registry)) {
    if (owner.name === '') continue;
    const prose = readableEntries(owner.entries);
    if (prose.trim() === '') continue;
    const state = `${owner.name}\n${prose}`;
    const key = textHash(state);
    const curated = Object.hasOwn(CURATED, owner.curatedKey);
    const seen = byKey.get(key);
    if (seen !== undefined) {
      seen.owners++;
      seen.curated &&= curated;
      continue;
    }
    byKey.set(key, {
      key,
      label: owner.label,
      name: owner.name,
      type: owner.type,
      state,
      owners: 1,
      curated,
      effects: scan(owner.name, owner.entries),
    });
  }
  return [...byKey.values()];
}
