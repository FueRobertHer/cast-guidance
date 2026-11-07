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
import { parseSpellRef } from '../../engine/effects/additionalSpells';
import { Collector } from '../../engine/effects/base';
import { collectClasses } from '../../engine/effects/class';
import { collectFeats } from '../../engine/effects/feat';
import { readOptionalFeatures } from '../../engine/effects/optionalFeatures';
import { proseScanFeature } from '../../engine/effects/proseScan';
import { collectRace } from '../../engine/effects/race';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type ClassLevelEntry,
  type EffectInput,
  type EntityRef,
  newCharacterDoc,
} from '../../engine/types';
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
  /** Each owner's key in `SPEND_LINKS`, which names the printing unlike the curated key. */
  spendKeys: string[];
  /**
   * The sheet of every owner holds a per-rest pool that belongs to this prose, read
   * from `additionalSpells` and not from the prose (see `tracksLimit`). Whether the
   * prose states a limit at all is the judge's to say. Kept apart from `effects`, whose
   * other readers would otherwise start comparing a resource the scanner never drew.
   */
  structuredLimit: boolean;
}

/** Anything a registry can list by type, and look an entity up in. */
export interface ByType {
  byType(type: EntityType): readonly Entity[];
  get(type: EntityType, name: string, source?: string): Entity | undefined;
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

/** A character who has an owner, and the engine's own way of reading them. */
interface Holder {
  doc: Partial<Pick<CharacterDoc, 'race' | 'subrace' | 'feats' | 'classes' | 'choices'>>;
  read: (col: Collector) => void;
}

interface Owner {
  type: ProseSubjectType;
  name: string;
  label: string;
  entries: unknown;
  /** The curated key the engine tries before it falls back to the scanner. */
  curatedKey: string;
  /** The key the engine looks up in `SPEND_LINKS`. */
  spendKey: string;
  holder: Holder;
}

const refOf = (e: Entity): EntityRef => ({ name: str(e.name), source: str(e.source) });

/** Levels of no class in particular, so every level key on a race or a feat is open. */
const ANY_LEVELS: ClassLevelEntry[] = [
  { ref: { name: 'audit', source: 'audit' }, levels: 20, hp: [] },
];

const inClass = (feature: Entity, subclass?: EntityRef): Holder => ({
  doc: {
    classes: [
      {
        ref: { name: str(feature.className), source: str(feature.classSource) },
        ...(subclass !== undefined ? { subclass } : {}),
        levels: 20,
        hp: [],
      },
    ],
  },
  read: collectClasses,
});

/** The one option an optional feature's own picker needs, offered and picked the way a class does. */
function pickedOption(e: Entity): Holder {
  const featureType = Array.isArray(e.featureType) ? e.featureType.map(String) : [];
  return {
    doc: {
      classes: ANY_LEVELS,
      choices: { [`audit:optfeature:${featureType.join('+')}`]: lower(str(e.name), str(e.source)) },
    },
    read: (col) => {
      readOptionalFeatures(
        col,
        { optionalfeatureProgression: [{ featureType, progression: { '*': 1 } }] },
        { idBase: 'audit', origin: { label: 'audit', uid: 'audit', type: 'class' }, level: 20 },
      );
    },
  };
}

function* owners(registry: ByType): Generator<Owner> {
  for (const type of ['race', 'subrace'] as const) {
    for (const e of registry.byType(type)) {
      const entries = Array.isArray(e.entries) ? e.entries : [];
      const race =
        type === 'race' ? refOf(e) : { name: str(e.raceName), source: str(e.raceSource) };
      const subrace = type === 'subrace' ? { subrace: refOf(e) } : {};
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
          spendKey: `trait:${name.toLowerCase()}`,
          holder: { doc: { race, ...subrace, classes: ANY_LEVELS }, read: collectRace },
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
      spendKey: lower(name, str(e.className), str(e.source)),
      holder: inClass(e),
    };
  }

  // A subclass feature's curated key names the subclass by its full name,
  // while the feature itself only carries the short one.
  const subclasses = new Map<string, Entity>();
  for (const sub of registry.byType('subclass')) {
    subclasses.set(lower(str(sub.className), str(sub.shortName), str(sub.source)), sub);
  }
  for (const e of registry.byType('subclassFeature')) {
    const name = str(e.name);
    const shortName = str(e.subclassShortName);
    const sub = subclasses.get(lower(str(e.className), shortName, str(e.subclassSource)));
    const subName = sub !== undefined ? str(sub.name) : shortName;
    yield {
      type: 'subclassFeature',
      name,
      label: `${name} (${str(e.className)}: ${subName}|${str(e.source)})`,
      entries: e.entries,
      curatedKey: lower(name, subName),
      spendKey: lower(name, subName, str(e.source)),
      holder: inClass(e, sub !== undefined ? refOf(sub) : undefined),
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
        spendKey: lower(name, str(e.source)),
        holder:
          type === 'feat'
            ? {
                doc: { feats: [{ ref: refOf(e), instanceId: 'audit' }], classes: ANY_LEVELS },
                read: collectFeats,
              }
            : pickedOption(e),
      };
    }
  }
}

type Grant = Extract<EffectInput, { kind: 'grantSpell' }>;

const isBranch = (prompt: ChoicePrompt) =>
  prompt.kind === 'generic' && prompt.id.endsWith(':branch');

/**
 * What the engine grants this holder, once per way their block can branch: every
 * branch is a character someone can build. Other choices the grants wait on, an
 * ability or a spell, change no pool, so one answer stands for the rest. The engine
 * grants a spell once and a repeat loses its pool, so no two picks by filter are alike.
 */
function grantsPerBuild(registry: ByType, { doc, read }: Holder): Grant[][] {
  const builds: Grant[][] = [];
  let picks = 0;
  // A spell pick by filter lists nothing until the spell files load, and trusts a
  // saved pick the registry does not know.
  const answerTo = ({ options, count }: ChoicePrompt) =>
    options.length > 0
      ? options.slice(0, count).map((option) => option.id)
      : Array.from({ length: count }, () => `audit pick ${String(picks++)}|audit`);
  const build = (choices: CharacterDoc['choices']) => {
    const col = new Collector(
      { ...newCharacterDoc('audit', 'audit', 'audit'), ...doc, choices },
      registry,
    );
    read(col);
    const open = col.pending.filter(
      (p) => !(p.id in choices) && (p.kind === 'spell' || p.kind === 'ability' || isBranch(p)),
    );
    const branch = open.find(isBranch);
    if (branch !== undefined) {
      for (const { id } of branch.options) build({ ...choices, [branch.id]: id });
    } else if (open.length > 0) {
      build({ ...choices, ...Object.fromEntries(open.map((p) => [p.id, answerTo(p)])) });
    } else {
      builds.push(col.effects.filter((e): e is Grant => e.kind === 'grantSpell'));
    }
  };
  build(doc.choices ?? {});
  return builds;
}

/** The spells some entries tag, lowercase. Tags, not words: "shield" is also a thing you hold. */
function spellsNamedIn(entries: unknown): Set<string> {
  const tags = JSON.stringify(entries ?? null).matchAll(/\{@spell ([^}]+)\}/g);
  return new Set([...tags].map((tag) => parseSpellRef(tag[1] ?? '').name.toLowerCase()));
}

/**
 * Does the sheet of this owner count the limit its prose states, from the owner's
 * structured data? The engine is asked, not the block, so an owner it does not read
 * and a limit it does not keep (one written inside `known`) count for nothing. In
 * every build it must hold a pool on a spell the prose names. A feat's or optional
 * feature's prose is all there is of it, so a pool on a spell the player picks,
 * which the prose cannot name, is its too, while a trait or subclass feature shares
 * one block with its neighbors. A leveled spell the prose names and the engine grants
 * freely means the sheet tracks only part of the limit, which is not tracking it.
 * How many uses, and which rest refills them, stay the block's word: this asks that
 * a pool exists, and does not compare it with the prose.
 */
function tracksLimit(registry: ByType, owner: Owner): boolean {
  const named = spellsNamedIn(owner.entries);
  const whole = owner.type === 'feat' || owner.type === 'optionalfeature';
  if (!whole && named.size === 0) return false;
  const isCantrip = ({ spell }: Grant) =>
    registry.get('spell', spell.name, spell.source === '' ? undefined : spell.source)?.level === 0;
  return grantsPerBuild(registry, owner.holder).every((grants) => {
    const nameOf = (grant: Grant) => grant.spell.name.toLowerCase();
    const limited = new Set(grants.filter((g) => g.resourceKey !== undefined).map(nameOf));
    const free = grants.filter((g) => !limited.has(nameOf(g)));
    return (
      (whole ? limited.size > 0 : [...named].some((name) => limited.has(name))) &&
      !free.some((grant) => named.has(nameOf(grant)) && !isCantrip(grant))
    );
  });
}

/**
 * Every scanned trait and feature in the registry, one subject per distinct
 * prose, in registry order. Traits with no prose are left out: there is
 * nothing to scan or to judge.
 *
 * Owners sharing prose can differ in their spell block, and a sheet without the
 * pool is one where the limit goes uncounted, so `structuredLimit` needs them all.
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
      seen.spendKeys.push(owner.spendKey);
      seen.structuredLimit &&= tracksLimit(registry, owner);
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
      spendKeys: [owner.spendKey],
      structuredLimit: tracksLimit(registry, owner),
    });
  }
  return [...byKey.values()];
}
