// Where a converted entry's official counterpart lives. The import leaves out
// an entry the installed game data already has, and the converter check
// (`compareOfficial.ts`) sets one beside it. Relative imports only: scripts
// load this under plain Bun.
import type { Entity } from '../data5e/copyMod';
import { ENTITY_TYPES, type EntityRegistry, type EntityType } from '../data5e/normalize';
import { editionOf, type RulesVersion } from '../data5e/rulesVersion';
import type {
  ConvertedKind,
  ConvertOptions,
  InstalledCheck,
  OfficialClass,
  OfficialFeat,
} from './types';

/**
 * The registry types an entry of each converted kind could already be. Other
 * apps have no subraces, so a race could be an official subrace too.
 */
export const OFFICIAL_TYPES: Record<ConvertedKind, readonly EntityType[]> = {
  spell: ['spell'],
  item: ['item', 'baseitem', 'itemGroup'],
  feat: ['feat'],
  background: ['background'],
  race: ['race', 'subrace'],
  optionalfeature: ['optionalfeature'],
  class: ['class'],
  classFeature: ['classFeature'],
  subclass: ['subclass'],
  subclassFeature: ['subclassFeature'],
};

/**
 * The names, lowercased, that a converted entry could carry for an official
 * one. Most answer to their own name only. A 2014 subrace is an entry of its
 * own in 5etools (`Hill`, of `Dwarf|PHB`) and a 2024 lineage is a version of
 * its species (`Elf; Drow Lineage`), but other apps name either as a race:
 * `Dwarf, Hill`, `Dwarf (Hill)` (as 5etools shows it), `Hill Dwarf`, and
 * `Elf, Drow` or `Drow Elf` for the lineage. A subrace never answers to its
 * own name alone, and a nameless one is its race's own base entry, so it
 * answers to nothing.
 */
export function officialNames(type: EntityType, e: Entity): string[] {
  if (typeof e.name !== 'string') return [];
  const own = e.name.toLowerCase();
  if (type === 'background') return backgroundNames(own);
  const raceName =
    type === 'subrace'
      ? e.raceName
      : type === 'race' && typeof e._versionOf === 'string'
        ? e._versionOf.split('|')[0]
        : undefined;
  if (typeof raceName !== 'string' || raceName === '') {
    return type === 'race' ? bracketedRaceNames(own) : [own];
  }
  const race = raceName.toLowerCase();
  const qualifier = qualifierOf(own, race) ?? (type === 'subrace' ? own : undefined);
  if (qualifier === undefined) return [own];
  // A subrace's own name (`Hill`) is no race's name.
  const names = new Set(type === 'subrace' ? [] : [own]);
  for (const q of new Set([qualifier, shortQualifier(qualifier, race)])) {
    names.add(`${race}, ${q}`);
    names.add(shownName(race, q));
    // `Hill Dwarf`, but not `Variant; Hellfire Tiefling` or `Joraga Elf (Zendikar)`.
    if (/^[\p{L}' -]+$/u.test(`${q} ${race}`)) names.add(`${q} ${race}`);
  }
  return [...names];
}

/**
 * A 2014 background variant answers to the name other apps give it alone:
 * `Variant Noble (Knight)` is `Knight`, `Variant Sailor (Pirate)` is `Pirate`.
 */
function backgroundNames(own: string): string[] {
  const m = /^variant [^()]+ \(([^()]+)\)$/.exec(own);
  return m?.[1] === undefined ? [own] : [own, m[1].trim()];
}

/**
 * A race whose name brackets its kind, with no race it is a version of:
 * `Dragonborn (Chromatic)` is `Dragonborn, Chromatic` and `Chromatic
 * Dragonborn` too.
 */
function bracketedRaceNames(own: string): string[] {
  const m = /^([^()]+) \(([^();]+)\)$/.exec(own);
  const race = m?.[1]?.trim();
  const q = m?.[2]?.trim();
  if (race === undefined || q === undefined || race === '' || q === '') return [own];
  const names = [own, `${race}, ${q}`];
  if (/^[\p{L}' -]+$/u.test(`${q} ${race}`)) names.push(`${q} ${race}`);
  return names;
}

/**
 * Registry types whose entries count only within a book: Fight Club files
 * the fighting styles with the feats (`Archery`, cited to the Player's
 * Handbook), where 5etools has them as optional features.
 */
const BOOK_ONLY_TYPES: Partial<Record<ConvertedKind, readonly EntityType[]>> = {
  feat: ['optionalfeature'],
};

/**
 * Names an official entry answers to only within its book, where other apps
 * drop the bracket 5etools adds: `Arrows (20)` is `Arrows`, `Cobalt Scholar
 * (Sage)` is `Cobalt Scholar`, and `Initiate (Dissenter)` is `Dissenter
 * (Initiate)`.
 */
function bookNames(type: EntityType, e: Entity): string[] {
  if (typeof e.name !== 'string' || !['item', 'baseitem', 'background'].includes(type)) return [];
  const own = e.name.toLowerCase();
  const open = own.lastIndexOf(' (');
  if (!own.endsWith(')') || open <= 0) return [];
  const base = own.slice(0, open).trim();
  const inner = own.slice(open + 2, -1).trim();
  if (base === '' || inner === '' || inner.includes('(')) return [];
  return type === 'background' ? [base, `${inner} (${base})`] : [base];
}

/**
 * A name with only its letters and digits, for a match within one book that
 * spelling cannot break: `Greenflame Blade` is `Green-Flame Blade`, `Summon
 * Shadow Spawn` is `Summon Shadowspawn`.
 */
function compact(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The books an official entry is printed in, lowercased: its source and its other sources. */
function entityBooks(e: Entity): string[] {
  const books = typeof e.source === 'string' ? [e.source.toLowerCase()] : [];
  if (Array.isArray(e.otherSources)) {
    for (const o of e.otherSources) {
      if (o !== null && typeof o === 'object' && typeof (o as Entity).source === 'string') {
        books.push(String((o as Entity).source).toLowerCase());
      }
    }
  }
  return books;
}

/**
 * Whether the official part of a registry has an entry, built per kind on
 * first ask: by name and rules edition, or by name in a book (the entry's
 * source or one of its other sources, so `Absorb Elements` is in Xanathar's
 * and in the Elemental Evil Player's Companion). A subrace or lineage is under
 * the names other apps give it (`Dwarf, Hill`); in a book, an entry is under
 * the looser names of {@link bookNames} too, and a feat may be a fighting
 * style.
 */
export function installedCheck(reg: EntityRegistry): InstalledCheck {
  const byKind = new Map<ConvertedKind, KindKeys>();
  return (kind, name, edition, book) => {
    let keys = byKind.get(kind);
    if (keys === undefined) {
      keys = kindKeys(reg, kind);
      byKind.set(kind, keys);
    }
    return hasKey(keys, name, edition, book);
  };
}

/** The keys {@link installedCheck} asks about one kind. */
interface KindKeys {
  /** `name|edition` of every official entry, under each name it answers to. */
  byEdition: Set<string>;
  /** `name|book`, and `~compact|book`, under its looser names too. */
  byBook: Set<string>;
}

function kindKeys(reg: EntityRegistry, kind: ConvertedKind): KindKeys {
  const built: KindKeys = { byEdition: new Set<string>(), byBook: new Set<string>() };
  const add = (type: EntityType, anyBook: boolean) => {
    for (const e of reg.byType(type).slice(0, reg.officialCount(type))) {
      const ed = editionOf(e);
      const books = entityBooks(e);
      const names = officialNames(type, e);
      if (anyBook) for (const n of names) built.byEdition.add(`${n}|${ed}`);
      for (const n of [...names, ...bookNames(type, e)]) {
        for (const b of books) {
          built.byBook.add(`${n}|${b}`);
          built.byBook.add(`~${compact(n)}|${b}`);
        }
      }
    }
  };
  for (const type of OFFICIAL_TYPES[kind]) add(type, true);
  for (const type of BOOK_ONLY_TYPES[kind] ?? []) add(type, false);
  return built;
}

function hasKey(keys: KindKeys, name: string, edition: string, book: string | undefined): boolean {
  const n = name.toLowerCase();
  if (book === undefined) return keys.byEdition.has(`${n}|${edition}`);
  const b = book.toLowerCase();
  return keys.byBook.has(`${n}|${b}`) || keys.byBook.has(`~${compact(n)}|${b}`);
}

/** Whether the official part of a registry holds anything from a book, by code. */
export function heldBooks(reg: EntityRegistry): (code: string) => boolean {
  let books: Set<string> | undefined;
  return (code) => {
    books ??= bookCodes(reg);
    return books.has(code.toLowerCase());
  };
}

function bookCodes(reg: EntityRegistry): Set<string> {
  const books = new Set<string>();
  for (const type of ENTITY_TYPES) {
    for (const e of reg.byType(type).slice(0, reg.officialCount(type))) {
      for (const b of entityBooks(e)) books.add(b);
    }
  }
  return books;
}

/** The core rules book of each edition, whose printing of a feat a grant prefers. */
const CORE_BOOK: Record<RulesVersion, string> = { '2014': 'phb', '2024': 'xphb' };

/**
 * The official feats by `name|edition`, lowercased, each as its registry id
 * (`alert|xphb`): the core rules book's printing when it has one, else the
 * first in the data.
 */
function featIds(reg: EntityRegistry): [string, string][] {
  const ids = new Map<string, string>();
  for (const e of reg.byType('feat').slice(0, reg.officialCount('feat'))) {
    if (typeof e.name !== 'string' || typeof e.source !== 'string') continue;
    const edition = editionOf(e);
    const key = `${e.name.toLowerCase()}|${edition}`;
    const core = e.source.toLowerCase() === CORE_BOOK[edition];
    if (!ids.has(key) || core) ids.set(key, `${e.name}|${e.source}`.toLowerCase());
  }
  return [...ids];
}

/** {@link OfficialFeat} over a set of {@link featIds}. */
function featLookup(ids: Iterable<[string, string]>): OfficialFeat {
  const byKey = new Map(ids);
  return (name, edition) => byKey.get(`${name.toLowerCase()}|${edition}`);
}

/** The installed feat a background's grant names, from the registry. */
export function officialFeatLookup(reg: EntityRegistry): OfficialFeat {
  return featLookup(featIds(reg));
}

/**
 * The official classes by `name|edition`, lowercased, each as `Name|Source`
 * as the data writes them: the core rules book's when it has one, else the
 * first in the data. A class's own book, never one it was also printed in
 * (`otherSources`), since a subclass names its class by that book.
 */
function classIds(reg: EntityRegistry): [string, string][] {
  const ids = new Map<string, string>();
  for (const e of reg.byType('class').slice(0, reg.officialCount('class'))) {
    if (typeof e.name !== 'string' || typeof e.source !== 'string') continue;
    const edition = editionOf(e);
    const key = `${e.name.toLowerCase()}|${edition}`;
    const core = e.source.toLowerCase() === CORE_BOOK[edition];
    if (!ids.has(key) || core) ids.set(key, `${e.name}|${e.source}`);
  }
  return [...ids];
}

/** {@link OfficialClass} over a set of {@link classIds}. */
function classLookup(ids: Iterable<[string, string]>): OfficialClass {
  const byKey = new Map(ids);
  return (name, edition) => {
    const id = byKey.get(`${name.toLowerCase()}|${edition}`);
    const bar = id?.indexOf('|') ?? -1;
    return id === undefined || bar < 0
      ? undefined
      : { name: id.slice(0, bar), source: id.slice(bar + 1) };
  };
}

/** The installed class a converted subclass goes on, from the registry. */
export function officialClassLookup(reg: EntityRegistry): OfficialClass {
  return classLookup(classIds(reg));
}

/**
 * What the converter asks of the game data ({@link installedCheck},
 * {@link heldBooks}, the books of the 2024 rules, {@link featIds} and
 * {@link classIds}), as
 * plain data: built where the registry is, and sent to a worker that
 * converts without it.
 */
export interface OfficialKeys {
  kinds: Record<ConvertedKind, { byEdition: string[]; byBook: string[] }>;
  books: string[];
  rulesBooks: string[];
  feats: [string, string][];
  classes: [string, string][];
}

export function officialKeys(reg: EntityRegistry): OfficialKeys {
  const kinds = {} as OfficialKeys['kinds'];
  for (const kind of Object.keys(OFFICIAL_TYPES) as ConvertedKind[]) {
    const keys = kindKeys(reg, kind);
    kinds[kind] = { byEdition: [...keys.byEdition], byBook: [...keys.byBook] };
  }
  return {
    kinds,
    books: [...bookCodes(reg)],
    rulesBooks: [...reg.rulesBooks],
    feats: featIds(reg),
    classes: classIds(reg),
  };
}

/** The converter's checks from {@link officialKeys}: the same answers the registry gives. */
export function officialChecks(
  keys: OfficialKeys,
): Required<
  Pick<ConvertOptions, 'isInstalled' | 'hasBook' | 'rulesBooks' | 'officialFeat' | 'officialClass'>
> {
  const byKind = new Map<ConvertedKind, KindKeys>();
  for (const kind of Object.keys(OFFICIAL_TYPES) as ConvertedKind[]) {
    const k = keys.kinds[kind];
    byKind.set(kind, { byEdition: new Set(k?.byEdition), byBook: new Set(k?.byBook) });
  }
  const books = new Set(keys.books);
  return {
    isInstalled: (kind, name, edition, book) => {
      const k = byKind.get(kind);
      return k !== undefined && hasKey(k, name, edition, book);
    },
    hasBook: (code) => books.has(code.toLowerCase()),
    rulesBooks: new Set(keys.rulesBooks),
    officialFeat: featLookup(keys.feats),
    officialClass: classLookup(keys.classes),
  };
}

/**
 * As the 5etools site names a subrace (`Renderer.race.getSubraceName`):
 * `Dwarf (Hill)`, and `Elf (Zendikar; Joraga Nation)` for a race whose name
 * already ends in brackets.
 */
function shownName(race: string, qualifier: string): string {
  const open = race.indexOf('(');
  if (open === -1 || !race.endsWith(')')) return `${race} (${qualifier})`;
  return `${race.slice(0, open)}(${race.slice(open + 1, -1)}; ${qualifier})`;
}

/** `Drow Lineage` of `elf; drow lineage`, `Black` of `dragonborn (black)`. */
function qualifierOf(name: string, race: string): string | undefined {
  if (name.startsWith(`${race}; `)) return name.slice(race.length + 2).trim() || undefined;
  if (name.startsWith(`${race} (`) && name.endsWith(')')) {
    return name.slice(race.length + 2, -1).trim() || undefined;
  }
  return undefined;
}

/**
 * `High Elf Lineage` as `high`, `Abyssal Legacy` as `abyssal`, `Cloud Giant
 * Ancestry` as `cloud giant`, `Variant; Mark of Detection` as `mark of
 * detection`.
 */
function shortQualifier(qualifier: string, race: string): string {
  // `Variant; Drow Descent`, a Sword Coast half-elf, is the drow one.
  let q = qualifier.startsWith('variant; ') ? qualifier.slice('variant; '.length) : qualifier;
  for (const suffix of [' lineage', ' legacy', ' ancestry', ' descent']) {
    if (q.endsWith(suffix)) q = q.slice(0, -suffix.length);
  }
  if (q.endsWith(` ${race}`)) q = q.slice(0, -race.length - 1);
  return q.trim() || qualifier;
}
