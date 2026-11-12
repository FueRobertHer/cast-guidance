/**
 * Characters built on the official data beside the same characters built from
 * Fight Club XML content: does every sheet feature still work?
 *
 *   bun --tsconfig-override=tsconfig.app.json scripts/fc5-sheet-compare.ts \
 *     --set srd51=a.xml,b.xml --set 5e=Complete_Compendium_5e.xml [--release release.json] [--out dir]
 *
 *   --set name=files    a set of XML files converted together (repeatable)
 *   --release file      the release (path to data file -> JSON), read from this
 *                       file if it exists, otherwise fetched and saved there
 *   --lookup file       the same for `generated/gendata-spell-source-lookup.json`
 *   --levels 1,5,11,20  the character levels each swap is derived at
 *   --limit n           at most n entries of each kind, for a quick run
 *   --out dir           writes `sheet-compare.json`: per set and kind, each field's
 *                       tallies and examples, and per entry the fields that differ
 *
 * Each set converts its files with nothing left out as installed, then gives
 * every converted entry a source of its own (`CVT` + its source) so it sits in
 * the registry beside the official entry it copies. Each converted entry with
 * an official counterpart (same kind, name and edition, as `--compare` matches
 * them, preferring the printing in the same book) is swapped into an otherwise
 * official character, and both characters are derived through the engine the
 * sheet uses and compared field by field. A class option is taken on the class
 * or subclass that offers it, at the levels where either side was offered it.
 * A class is the character's class; a subclass goes on the official class, from
 * the level it is chosen. Their prompts are answered alike: the converted side
 * takes the options of the names the official side took, else the first by
 * name. Spells are compared as the Spells tab reads them, entry against entry.
 *
 * Game data never lands in the repo: the release comes from the network or a
 * cached file outside it, the XML from paths given.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spellClassesFromLookup } from '../src/convert/compareOfficial';
import { convertXmlChunks } from '../src/convert/index';
import { OFFICIAL_TYPES, officialFeatLookup, officialNames } from '../src/convert/official';
import type { ConvertedKind, OfficialFeat } from '../src/convert/types';
import { withBuiltInRules } from '../src/data5e/builtInRules';
import { DATA_TAG } from '../src/data5e/config';
import type { Entity } from '../src/data5e/copyMod';
import { engineContextFor } from '../src/data5e/engineAdapter';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '../src/data5e/normalize';
import { editionOf } from '../src/data5e/rulesVersion';
import { GithubTagSource } from '../src/data5e/source';
import { deriveSheet } from '../src/engine/derive';
import { subclassUnlockLevel } from '../src/engine/multiclass';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
  refUid,
} from '../src/engine/types';
import { castingEconomy } from '../src/features/sheet/castResources';
import { spellMeta, spellSaves } from '../src/features/sheet/spellMeta';
import { spellRollActions } from '../src/features/sheet/spellRolls';
import { fetchRelease } from './data-release';

const { values } = parseArgs({
  options: {
    set: { type: 'string', multiple: true },
    release: { type: 'string' },
    lookup: { type: 'string' },
    out: { type: 'string' },
    levels: { type: 'string', default: '1,5,11,20' },
    limit: { type: 'string' },
  },
});

const LEVELS = (values.levels ?? '1,5,11,20').split(',').map(Number);
const LIMIT = values.limit === undefined ? Number.POSITIVE_INFINITY : Number(values.limit);
const PREFIX = 'CVT';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const KINDS: ConvertedKind[] = ['race', 'background', 'feat', 'item', 'spell', 'optionalfeature'];
/** Kinds swapped in as the character's class. */
const CLASS_KINDS: ConvertedKind[] = ['class', 'subclass'];
/** Kinds paired with an official entry and counted. */
const PAIRED: ConvertedKind[] = [...KINDS, ...CLASS_KINDS];
/** Kinds whose entries take a converted source of their own, refs included. */
const SOURCED: ConvertedKind[] = [...PAIRED, 'classFeature', 'subclassFeature'];
/** Fields that name a converted class or subclass by its source alone. */
const SOURCE_FIELDS = ['classSource', 'subclassSource'];

// ---------------------------------------------------------------- data

/** Read from `file` when it exists; otherwise fetched, and saved there when a path is given. */
async function cached<T>(file: string | undefined, fetch: () => Promise<T>): Promise<T> {
  if (file !== undefined && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const fetched = await fetch();
  if (file !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(fetched));
  }
  return fetched;
}

async function officialFiles(): Promise<Map<string, unknown>> {
  const raw = await cached(values.release, async () =>
    Object.fromEntries((await fetchRelease(DATA_TAG)).files),
  );
  return new Map(Object.entries(raw));
}

interface ConvertedSet {
  name: string;
  json: Record<string, unknown>;
  /** Files that could not be converted, with why. */
  skipped: string[];
}

/** The class lists the Spells tab offers an official spell on. */
async function officialSpellClasses(): Promise<(spell: Entity) => readonly string[]> {
  const lookup = await cached(values.lookup, () =>
    new GithubTagSource(DATA_TAG).fetchFile('generated/gendata-spell-source-lookup.json'),
  );
  return spellClassesFromLookup(lookup);
}

/** The class lists a converted spell is offered on: its own `classes.fromClassList`. */
function convertedSpellClasses(spell: Entity): string[] {
  const classes = isRecord(spell.classes) ? spell.classes : {};
  const list = Array.isArray(classes.fromClassList) ? classes.fromClassList : [];
  return list.filter(isRecord).map((c) => String(c.name));
}

const classSet = (names: readonly string[]) =>
  [...new Set(names.map((n) => n.toLowerCase()))].sort();

/**
 * The file as the app's worker reads it: in chunks, whatever its size. A
 * background's feat that the file lacks names the installed one, as in the app.
 */
async function convertFile(file: string, officialFeat: OfficialFeat) {
  const text = readFileSync(file, 'utf8');
  async function* chunks() {
    for (let i = 0; i < text.length; i += 1 << 20) yield text.slice(i, i + (1 << 20));
  }
  return convertXmlChunks(chunks, { fileName: path.basename(file), officialFeat });
}

async function convertSet(
  name: string,
  files: string[],
  officialFeat: OfficialFeat,
): Promise<ConvertedSet> {
  const json: Record<string, unknown> = { _meta: { sources: [] } };
  const skipped: string[] = [];
  const sources = new Map<string, unknown>();
  for (const file of files) {
    let one: Record<string, unknown>;
    try {
      one = (await convertFile(file, officialFeat)).json;
    } catch (err) {
      // A file that is not a compendium (the SRD download's `source-srd5e.xml`).
      skipped.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const [key, value] of Object.entries(one)) {
      if (key === '_meta') {
        const meta = isRecord(value) ? value : {};
        for (const s of Array.isArray(meta.sources) ? meta.sources : []) {
          if (isRecord(s) && typeof s.json === 'string') sources.set(s.json, s);
        }
        continue;
      }
      if (!Array.isArray(value)) continue;
      const list = (json[key] as unknown[] | undefined) ?? [];
      for (const e of value) list.push(e);
      json[key] = list;
    }
  }
  // Each converted entry under a source of its own, beside the official one.
  const meta = json._meta as { sources: unknown[] };
  for (const [id, s] of sources) meta.sources.push({ ...(s as object), json: PREFIX + id });
  // Refs between converted entries follow them (`skilled|fcplayershandbook2024`,
  // `{@spell Hex|FCBook}`); refs to official entries stay as they are.
  const ids = new Set([...sources.keys()].map((id) => id.toLowerCase()));
  const resource = (text: string) =>
    text.replace(/\|([A-Za-z0-9]+)(?=[|}#\]]|$)/g, (whole, id: string) =>
      ids.has(id.toLowerCase()) ? `|${PREFIX}${id}` : whole,
    );
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return resource(v);
    if (Array.isArray(v)) return v.map(deep);
    if (!isRecord(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, inner]) => [resource(k), deep(inner)]));
  };
  for (const kind of SOURCED) {
    const list = (json[kind] as Entity[] | undefined) ?? [];
    json[kind] = list.map((e) => {
      const out = deep(e) as Entity;
      if (typeof out.source === 'string') out.source = PREFIX + out.source;
      // A subclass or feature names its converted class by source alone.
      for (const field of SOURCE_FIELDS) {
        const v = out[field];
        if (typeof v === 'string' && ids.has(v.toLowerCase())) out[field] = PREFIX + v;
      }
      return out;
    });
  }
  return { name, json, skipped };
}

// ---------------------------------------------------------------- pairing

interface Pair {
  kind: ConvertedKind;
  name: string;
  edition: '2014' | '2024';
  converted: Entity;
  /** The official entry, and for a subrace its race. */
  official: { type: string; entity: Entity; race?: Entity };
}

const FREE_RULES = ['srd52', 'srd', 'basicRules2024', 'basicRules', 'freeRules2024'];
const keyOf = (name: string, edition: string) => `${name.toLowerCase()}|${edition}`;

/** A book's name as both sides can spell it: `Player's Handbook (2014)` and `Player S Handbook`. */
const bookKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(?:2014|2024)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Official source id (lowercased) to its book's name, from `books.json`. */
function officialBooks(files: ReadonlyMap<string, unknown>): Map<string, string> {
  const raw = files.get('books.json');
  const books = isRecord(raw) && Array.isArray(raw.book) ? raw.book : [];
  const out = new Map<string, string>();
  for (const b of books) {
    if (isRecord(b) && typeof b.id === 'string' && typeof b.name === 'string') {
      out.set(b.id.toLowerCase(), bookKey(b.name));
    }
  }
  return out;
}

function pairs(
  reg: EntityRegistry,
  set: ConvertedSet,
  books: Map<string, string>,
): { pairs: Pair[]; unmatched: Entity[] } {
  // A converted entry's book, so a race printed in two books pairs with its own printing.
  const meta = set.json._meta as { sources: unknown[] };
  const convertedBooks = new Map<string, string>();
  for (const src of meta.sources) {
    if (isRecord(src) && typeof src.json === 'string' && typeof src.full === 'string') {
      convertedBooks.set(src.json.toLowerCase(), bookKey(src.full));
    }
  }
  const bookOf = (e: Entity, converted: boolean) =>
    typeof e.source !== 'string'
      ? undefined
      : converted
        ? convertedBooks.get(e.source.toLowerCase())
        : books.get(e.source.toLowerCase());
  const races = new Map<string, Entity>();
  for (const r of reg.byType('race')) {
    if (typeof r.name === 'string' && typeof r.source === 'string') {
      races.set(`${r.name}|${r.source}`.toLowerCase(), r);
    }
  }
  // A subclass pairs with the official one of its name on a class of its class's name.
  const classOf = (kind: ConvertedKind, e: Entity) =>
    kind === 'subclass' ? `|${String(e.className).toLowerCase()}` : '';
  // A converted class's `name|source` to the official class source it pairs with.
  const uidOf = (n: unknown, s: unknown) => `${String(n)}|${String(s)}`.toLowerCase();
  const pairedClasses = new Map<string, string>();
  const out: Pair[] = [];
  const unmatched: Entity[] = [];
  for (const kind of PAIRED) {
    const index = new Map<string, Pair['official'][]>();
    const add = (key: string, o: Pair['official']) => {
      const list = index.get(key) ?? [];
      list.push(o);
      index.set(key, list);
    };
    for (const type of OFFICIAL_TYPES[kind]) {
      for (const e of reg.byType(type)) {
        if (typeof e.name !== 'string') continue;
        const edition = editionOf(e);
        const race =
          type === 'subrace'
            ? races.get(`${String(e.raceName)}|${String(e.raceSource)}`.toLowerCase())
            : undefined;
        const o = { type, entity: e, ...(race === undefined ? {} : { race }) };
        const of = classOf(kind, e);
        for (const n of officialNames(type, e)) add(keyOf(n, edition) + of, o);
        for (const flag of ['srd', 'srd52']) {
          if (typeof e[flag] === 'string') add(keyOf(e[flag] as string, edition) + of, o);
        }
      }
    }
    for (const converted of (set.json[kind] as Entity[] | undefined) ?? []) {
      const name = typeof converted.name === 'string' ? converted.name : '';
      const edition = editionOf(converted);
      const found = index.get(keyOf(name, edition) + classOf(kind, converted)) ?? [];
      // A subclass the data has on two printings of its class (the PHB and
      // XPHB bard): the one on the official class its own class pairs with.
      const onClass =
        kind === 'subclass'
          ? (pairedClasses.get(uidOf(converted.className, converted.classSource)) ??
            String(converted.classSource).toLowerCase())
          : undefined;
      const onIt = found.filter((o) => String(o.entity.classSource).toLowerCase() === onClass);
      const candidates = onIt.length > 0 ? onIt : found;
      const own = bookOf(converted, true);
      const pick =
        candidates.find((o) => own !== undefined && bookOf(o.entity, false) === own) ??
        candidates.find((o) => FREE_RULES.some((f) => o.entity[f] !== undefined)) ??
        candidates[0];
      if (pick === undefined) {
        unmatched.push(converted);
        continue;
      }
      if (kind === 'class') {
        pairedClasses.set(
          uidOf(converted.name, converted.source),
          String(pick.entity.source).toLowerCase(),
        );
      }
      out.push({
        kind,
        name,
        edition,
        converted,
        official: pick,
      });
    }
  }
  return { pairs: out, unmatched };
}

// ---------------------------------------------------------------- characters

const ref = (e: Entity) => ({ name: String(e.name), source: String(e.source) });
const needsAttunement = (e: Entity) => e.reqAttune !== undefined && e.reqAttune !== false;

function baseDoc(
  edition: '2014' | '2024',
  level: number,
  cls: EntityRef = { name: 'Fighter', source: edition === '2024' ? 'XPHB' : 'PHB' },
): CharacterDoc {
  const doc = newCharacterDoc('cmp', 'Compare', DATA_TAG);
  doc.rulesVersion = edition;
  doc.abilities = {
    method: 'standard',
    base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  } as CharacterDoc['abilities'];
  doc.classes = [
    { ref: cls, levels: level, hp: Array.from({ length: level }, () => 'avg' as const) },
  ];
  return doc;
}

/** A converted option's id, so the automatic picks leave it to the one under test. */
const isConvertedId = (id: string) => id.toLowerCase().includes(`|${PREFIX.toLowerCase()}`);

/**
 * Prompt kinds where a name another prompt of the kind took adds nothing (a
 * second expertise in Acrobatics, a second Archery): the engine closes such
 * picks only for a `distinct` prompt, and only once the first is saved, so a
 * repeat would leave the later grant untested.
 */
const NO_REPEAT = new Set<ChoicePrompt['kind']>([
  'skill',
  'skillOrTool',
  'expertise',
  'language',
  'tool',
  'optionalfeature',
  'feat',
  'damageType',
]);
const repeatGroup = (kind: ChoicePrompt['kind']) => (kind === 'skillOrTool' ? 'skill' : kind);
const pickName = (id: string) => id.toLowerCase().split('|')[0] ?? '';

/**
 * Answer every open prompt the same way on both sides: an Ability Score
 * Improvement where offered, otherwise the first options by label, never a
 * converted entry unless `prefer` names it. `prefer` goes first; any other
 * printing of the same name (`under`, lowercased) is left out, so the
 * official twin of a converted option never rides along with it. For a class
 * swapped in (`anyPrinting`), converted options are taken like any, and two
 * printings of one name never fill one prompt. A name another prompt of the
 * same kind took is not taken again where a repeat adds nothing (`NO_REPEAT`).
 */
function settle(
  doc: CharacterDoc,
  ctx: EngineContext,
  prefer?: (id: string) => boolean,
  under?: string,
  anyPrinting = false,
) {
  const twin = (id: string) => under !== undefined && id.toLowerCase().split('|')[0] === under;
  let sheet = deriveSheet(doc, ctx, { active: false });
  // The names each kind's prompts hold, by prompt, so a prompt's own picks stay its own.
  const held = new Map<string, Map<string, Set<string>>>();
  const hold = (p: ChoicePrompt, ids: readonly string[]) => {
    const group = repeatGroup(p.kind);
    const byPrompt = held.get(group) ?? new Map<string, Set<string>>();
    byPrompt.set(p.id, new Set(ids.map(pickName)));
    held.set(group, byPrompt);
  };
  const heldElsewhere = (p: ChoicePrompt, id: string) => {
    if (p.allowRepeat === true || !(p.distinct === true || NO_REPEAT.has(p.kind))) return false;
    for (const [promptId, names] of held.get(repeatGroup(p.kind)) ?? []) {
      if (promptId !== p.id && names.has(pickName(id))) return true;
    }
    return false;
  };
  for (const r of sheet.resolvedChoices) hold(r.prompt, r.selected);
  for (let round = 0; round < 16; round++) {
    let open = sheet.pending.filter(
      (p) => doc.choices[p.id] === undefined && p.spellQuery === undefined,
    );
    if (open.length === 0) break;
    // Expertise picks from the skills a class's own prompt gives: those first.
    if (anyPrinting && open.some((p) => p.kind === 'skill' || p.kind === 'skillOrTool')) {
      open = open.filter((p) => p.kind !== 'expertise');
    }
    for (const p of open) {
      const usable = p.options.filter((o) => o.disabled === undefined && !heldElsewhere(p, o.id));
      const wanted = prefer === undefined ? [] : usable.filter((o) => prefer(o.id));
      const asi = usable.filter((o) => /ability score/i.test(o.label));
      const rest = usable
        .filter((o) => (anyPrinting || !isConvertedId(o.id)) && !twin(o.id))
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      const ordered = [...wanted, ...(p.kind === 'asiOrFeat' ? asi : []), ...rest];
      const n = Math.max(1, p.count);
      const ids = ordered.length === 0 ? [] : p.allowRepeat ? Array(n).fill(ordered[0]?.id) : [];
      const names = new Set<string>();
      if (!p.allowRepeat)
        for (const o of ordered) {
          const named = o.id.toLowerCase().split('|')[0] ?? '';
          if (ids.length >= n || ids.includes(o.id) || (anyPrinting && names.has(named))) continue;
          ids.push(o.id);
          names.add(named);
        }
      doc.choices[p.id] = n === 1 ? (ids[0] ?? '') : ids;
      hold(
        p,
        ids.filter((id): id is string => typeof id === 'string' && id !== ''),
      );
    }
    sheet = deriveSheet(doc, ctx, { active: false });
  }
  return sheet;
}

// ---------------------------------------------------------------- comparison

const DROP = new Set([
  'origin',
  'origins',
  'sources',
  'sourcesBesideBackground',
  'parts',
  'base',
  'overridden',
  'entries',
  'description',
  'id',
  'weaponId',
  'resourceKey',
  'info',
  'advisory',
]);

/**
 * A converted source back as the converter wrote it (`CVTFCSrd` to `FCSrd`), for
 * labels and readable output. It does not make a converted uid read as the
 * official one: no compared field carries one today, and a field that did would
 * differ on source alone.
 */
const unprefix = (s: string) => s.replace(new RegExp(`\\b${PREFIX}(?=[A-Za-z0-9])`, 'gi'), '');

/** Lists whose order means something: spell slots by level. */
const POSITIONAL = new Set(['slots']);

function norm(v: unknown, key = ''): unknown {
  if (typeof v === 'string') return unprefix(v);
  if (Array.isArray(v)) {
    const items = v.map((x) => norm(x));
    if (POSITIONAL.has(key)) return items;
    return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (!isRecord(v)) return v;
  if (typeof v.value === 'number' && Array.isArray(v.parts)) {
    return 'mod' in v ? { value: v.value, mod: v.mod } : v.value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, inner] of Object.entries(v)) {
    if (DROP.has(k) || inner === undefined) continue;
    out[k] = norm(inner, k);
  }
  return out;
}

/**
 * Traits that only restate what the sheet shows elsewhere (scores, size,
 * speed, languages) or nothing at all (age, alignment). Other apps print them
 * as traits; 5etools keeps them as data. Left out, so a race differs only where
 * a rule does.
 */
const RESTATED =
  /^(?:ability score (?:increases?|adjustments?)|age|alignment|size|speed|creature type|languages?|life ?span)$/;

/** The named entries of a feature card, lowercased: a race's traits. */
function traitNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is Record<string, unknown> => isRecord(e) && typeof e.name === 'string')
    .map((e) => String(e.name).toLowerCase().trim())
    .filter((n) => !RESTATED.test(n));
}

/** A prompt's label without its origin's name before it. */
function ownLabel(p: { label: string; origin: { label: string } }): string {
  const lead = `${p.origin.label}: `;
  return p.label.startsWith(lead) ? p.label.slice(lead.length) : p.label;
}

/** What the sheet shows, by field, ready to compare. */
function view(s: DerivedSheet): Record<string, unknown> {
  return {
    abilities: norm(s.abilities),
    saves: norm(s.saves),
    skills: norm(s.skills),
    passivePerception: norm(s.passivePerception),
    ac: norm(s.ac),
    maxHp: norm(s.maxHp),
    initiative: norm(s.initiative),
    speed: norm({ walk: s.speedWalk, other: s.otherSpeeds, multiplier: s.speedMultiplier.factor }),
    senses: norm(s.senses),
    defenses: norm({
      resists: s.resists,
      immunities: s.immunities,
      vulnerabilities: s.vulnerabilities,
      conditionImmunities: s.conditionImmunities,
    }),
    languages: norm(s.languages),
    proficiencies: norm({ armor: s.armorProfs, weapon: s.weaponProfs, tool: s.toolProfs }),
    attacks: norm(s.attacks),
    spellcasting: norm(s.spellcasting),
    grantedSpells: norm(
      s.grantedSpells.map((g) => ({
        name: g.name,
        usage: g.usage ?? '',
        ability: g.ability ?? '',
      })),
    ),
    // A free cast's key names its origin (`spell:tiefling|phb:darkness`), which
    // a converted entry names its own way; the spell, uses and rest are compared.
    resources: norm(
      s.resources.map((r) => ({ ...r, key: r.key.replace(/^spell:[^:]*:/, 'spell:') })),
    ),
    actions: norm(s.actions),
    rollRiders: norm(s.rollRiders),
    extraActions: norm(s.extraActions),
    critRange: norm(s.critRange?.min),
    cues: norm(s.cues),
    // A race or subrace card is named for the race (`Dwarf` and `Hill` against
    // `Dwarf, Hill`), so its traits are compared by name instead.
    features: norm(
      s.features.flatMap((f) =>
        f.origin.type === 'race'
          ? traitNames(f.entries).map((n) => `trait ${n}`)
          : [`${f.name} @${f.level ?? 0}`],
      ),
    ),
    // A prompt's label opens with its origin's name (`Elf; Drow Lineage:
    // spellcasting ability`), which a converted entry words its own way.
    choices: norm({
      pending: s.pending.map((p) => `${p.kind}: ${ownLabel(p)} x${p.count}`),
      resolved: s.resolvedChoices.map(
        (r) => `${r.prompt.kind}: ${ownLabel(r.prompt)} x${r.selected.length}`,
      ),
    }),
    warnings: norm(s.warnings),
  };
}

interface FieldStats {
  same: number;
  differs: number;
  examples: string[];
}

interface Report {
  set: string;
  kind: string;
  scenarios: number;
  /** Scenarios that threw. */
  errors: string[];
  /** Entries left uncompared, with why (no class offers the option, or none offered it). */
  unchecked: string[];
  fields: Record<string, FieldStats>;
  /** Per entry: the fields that differ at any level. */
  entries: Record<string, Record<string, string>>;
}

const newReport = (set: string, kind: string): Report => ({
  set,
  kind,
  scenarios: 0,
  errors: [],
  unchecked: [],
  fields: {},
  entries: {},
});

const short = (v: unknown, n = 260) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > n ? `${s.slice(0, n)}…` : s;
};

/** Where two values first part, as a path and the two sides there. */
function firstDiff(a: unknown, b: unknown, at = ''): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (isRecord(a) && isRecord(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${at}.${k}`);
      if (d !== undefined) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const as = new Set(a.map((x) => JSON.stringify(x)));
    const bs = new Set(b.map((x) => JSON.stringify(x)));
    const onlyA = a.filter((x) => !bs.has(JSON.stringify(x)));
    const onlyB = b.filter((x) => !as.has(JSON.stringify(x)));
    return `${at}: official only ${short(onlyA, 200)} | converted only ${short(onlyB, 200)}`;
  }
  return `${at}: official ${short(a, 160)} | converted ${short(b, 160)}`;
}

function tally(
  report: Report,
  label: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  at = '',
) {
  const differing = report.entries[label] ?? {};
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const stats = (report.fields[field] ??= { same: 0, differs: 0, examples: [] });
    const d = firstDiff(a[field], b[field], field);
    if (d === undefined) {
      stats.same += 1;
      continue;
    }
    stats.differs += 1;
    differing[field] ??= `${at}${d}`;
    if (stats.examples.length < 12) stats.examples.push(`${label}: ${at}${d}`);
  }
  report.entries[label] = differing;
}

// ---------------------------------------------------------------- scenarios

/** A class, or a subclass of it, that offers a kind of class option. */
interface Host {
  edition: '2014' | '2024';
  cls: EntityRef;
  subclass?: EntityRef;
  /** The first level it offers one at. */
  from: number;
}

/** The first level a `progression` (by index from level 1, or by level) offers any at. */
function firstLevel(progression: unknown): number | undefined {
  const levels = Array.isArray(progression)
    ? progression.flatMap((n, i) => (typeof n === 'number' && n > 0 ? [i + 1] : []))
    : isRecord(progression)
      ? Object.entries(progression).flatMap(([l, n]) =>
          typeof n === 'number' && n > 0 ? [Number(l)] : [],
        )
      : [];
  return levels.length === 0 ? undefined : Math.min(...levels);
}

/**
 * Who offers each kind of class option (`EI`, `MV:B`, ...), read from the
 * official classes' and subclasses' `optionalfeatureProgression`: a class
 * before a subclass, then the earliest level.
 */
function optionHosts(reg: EntityRegistry): Map<string, Host[]> {
  const out = new Map<string, Host[]>();
  const add = (e: Entity, cls: EntityRef, subclass?: EntityRef) => {
    const list = Array.isArray(e.optionalfeatureProgression) ? e.optionalfeatureProgression : [];
    for (const p of list) {
      if (!isRecord(p) || !Array.isArray(p.featureType)) continue;
      const from = firstLevel(p.progression);
      if (from === undefined) continue;
      for (const type of p.featureType) {
        if (typeof type !== 'string') continue;
        const hosts = out.get(type) ?? [];
        hosts.push({
          edition: editionOf(e),
          cls,
          ...(subclass === undefined ? {} : { subclass }),
          from,
        });
        out.set(type, hosts);
      }
    }
  };
  for (const c of reg.byType('class')) add(c, ref(c));
  for (const s of reg.byType('subclass')) {
    add(s, { name: String(s.className), source: String(s.classSource) }, ref(s));
  }
  for (const hosts of out.values()) {
    hosts.sort(
      (a, b) =>
        Number(a.subclass !== undefined) - Number(b.subclass !== undefined) || a.from - b.from,
    );
  }
  return out;
}

/**
 * A converted class's or subclass's sheet with its uid read as the official
 * one's (`bard|fcsystemreferencedocumentv521` as `bard|xphb`, `psi
 * warrior|fctashascauldronofeverything` as `psi warrior|tce`), so a row
 * differs on what it holds, not on whose it is.
 */
function asOfficial(v: Record<string, unknown>, pair: Pair): Record<string, unknown> {
  if (pair.kind !== 'class' && pair.kind !== 'subclass') return v;
  const from = unprefix(refUid(ref(pair.converted)));
  const to = refUid(ref(pair.official.entity));
  const text = JSON.stringify(v);
  return JSON.parse(text.split(from).join(to)) as Record<string, unknown>;
}

/** An entry's label in the report: two printings of one name stay apart. */
const labelOf = (name: string, edition: string, converted: Entity) =>
  `${name} (${edition}, ${unprefix(String(converted.source))})`;

function runSwaps(
  set: ConvertedSet,
  regA: EntityRegistry,
  regB: EntityRegistry,
  all: Pair[],
): Report[] {
  const ctxA = engineContextFor(regA);
  const ctxB = engineContextFor(regB);
  const hosts = optionHosts(regA);
  const reports = new Map<string, Report>();
  const reportFor = (kind: string) => {
    let r = reports.get(kind);
    if (r === undefined) {
      r = newReport(set.name, kind);
      reports.set(kind, r);
    }
    return r;
  };
  const picked = (s: DerivedSheet, id: string) =>
    s.resolvedChoices.some((r) => r.selected.some((x) => x.toLowerCase() === id));

  const counted = new Map<string, number>();
  for (const pair of all) {
    if (pair.kind === 'spell') continue;
    const n = counted.get(pair.kind) ?? 0;
    if (n >= LIMIT) continue;
    counted.set(pair.kind, n + 1);
    const report = reportFor(pair.kind);
    const o = pair.official;
    const label = labelOf(pair.name, pair.edition, pair.converted);
    let offeredAt = 0;
    let failed = 0;
    for (const level of LEVELS) {
      try {
        let a: CharacterDoc;
        let b: CharacterDoc;
        if (pair.kind === 'race') {
          a = baseDoc(pair.edition, level);
          b = baseDoc(pair.edition, level);
          if (o.type === 'subrace' && o.race !== undefined) {
            a.race = ref(o.race);
            a.subrace = ref(o.entity);
          } else a.race = ref(o.entity);
          b.race = ref(pair.converted);
        } else if (pair.kind === 'background') {
          a = baseDoc(pair.edition, level);
          b = baseDoc(pair.edition, level);
          a.background = ref(o.entity);
          b.background = ref(pair.converted);
        } else if (pair.kind === 'feat') {
          a = baseDoc(pair.edition, level);
          b = baseDoc(pair.edition, level);
          a.feats = [{ ref: ref(o.entity), instanceId: 'f1' }];
          b.feats = [{ ref: ref(pair.converted), instanceId: 'f1' }];
        } else if (pair.kind === 'item') {
          a = baseDoc(pair.edition, level);
          b = baseDoc(pair.edition, level);
          const entry = (e: Entity) => ({
            id: 'i1',
            ref: ref(e),
            qty: 1,
            equipped: true,
            attuned: needsAttunement(e),
          });
          a.equipment = [entry(o.entity)];
          b.equipment = [entry(pair.converted)];
        } else if (pair.kind === 'class' || pair.kind === 'subclass') {
          let cls = ref(pair.official.entity);
          let from = 1;
          if (pair.kind === 'subclass') {
            // On the official class, from the level it is chosen.
            cls = { name: String(o.entity.className), source: String(o.entity.classSource) };
            from = subclassUnlockLevel(regA.get('class', cls.name, cls.source));
            if (level < from) continue;
          }
          a = baseDoc(pair.edition, level, cls);
          b = baseDoc(pair.edition, level, pair.kind === 'class' ? ref(pair.converted) : cls);
          if (pair.kind === 'subclass') {
            const ca = a.classes[0];
            const cb = b.classes[0];
            if (ca !== undefined) ca.subclass = ref(o.entity);
            if (cb !== undefined) cb.subclass = ref(pair.converted);
          }
          const sa = settle(a, ctxA, undefined, undefined, true);
          // The names the official side took, so both sides take the same.
          const took = new Set(
            sa.resolvedChoices.flatMap((r) =>
              r.selected.map((x) => x.toLowerCase().split('|')[0] ?? ''),
            ),
          );
          const sb = settle(
            b,
            ctxB,
            (id) => took.has(id.toLowerCase().split('|')[0] ?? ''),
            undefined,
            true,
          );
          report.scenarios += 1;
          tally(report, label, view(sa), asOfficial(view(sb), pair), `L${level} `);
          continue;
        } else {
          const types = Array.isArray(pair.converted.featureType)
            ? (pair.converted.featureType as string[])
            : [];
          const offering = types.flatMap((t) => hosts.get(t) ?? []);
          const host = offering.find((h) => h.edition === pair.edition) ?? offering[0];
          if (host === undefined) {
            report.unchecked.push(`${label}: no class offers ${types.join('/') || 'it'}`);
            offeredAt = -1;
            break;
          }
          const make = () => {
            const d = baseDoc(host.edition, level, host.cls);
            const c = d.classes[0];
            if (c !== undefined && host.subclass !== undefined && level >= host.from) {
              c.subclass = host.subclass;
            }
            return d;
          };
          a = make();
          b = make();
          const officialId = refUid(ref(o.entity));
          const convertedId = refUid(ref(pair.converted));
          const under = pair.name.toLowerCase();
          const sa = settle(a, ctxA, (id) => id.toLowerCase() === officialId, under);
          const sb = settle(b, ctxB, (id) => id.toLowerCase() === convertedId, under);
          const va = view(sa);
          const vb = view(sb);
          va.picked = picked(sa, officialId);
          vb.picked = picked(sb, convertedId);
          // Offered on neither side at this level (too low, or a prerequisite
          // unmet): nothing about the option to compare.
          if (va.picked === false && vb.picked === false) continue;
          offeredAt += 1;
          report.scenarios += 1;
          tally(report, label, va, vb, `L${level} `);
          continue;
        }
        report.scenarios += 1;
        tally(report, label, view(settle(a, ctxA)), view(settle(b, ctxB)), `L${level} `);
      } catch (err) {
        failed += 1;
        report.errors.push(
          `${label} at ${level}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (pair.kind === 'optionalfeature' && offeredAt === 0 && failed === 0) {
      report.unchecked.push(`${label}: offered on neither side at levels ${LEVELS.join(', ')}`);
    }
  }
  return [...reports.values()];
}

/** A spell as the Spells tab reads it: its caption, rolls at each level, save and cast. */
function spellView(e: Entity): Record<string, unknown> {
  const base = typeof e.level === 'number' ? e.level : 0;
  const rolls: Record<string, string[]> = {};
  const levels = base === 0 ? [1, 5, 11, 17] : [20];
  for (const characterLevel of levels) {
    for (let slot = base === 0 ? 0 : base; slot <= (base === 0 ? 0 : 9); slot++) {
      rolls[`char ${characterLevel} slot ${slot}`] = spellRollActions(e, {
        characterLevel,
        slotLevel: slot,
        abilityModifier: 3,
      }).map((r) => `${r.variant}:${r.expr}`);
    }
  }
  const duration = Array.isArray(e.duration) ? e.duration : [];
  const meta = isRecord(e.meta) ? e.meta : {};
  const components = isRecord(e.components) ? e.components : {};
  return {
    level: e.level,
    caption: unprefix(spellMeta(e, { withLevel: true })),
    saves: spellSaves(e),
    attack: e.spellAttack ?? [],
    economy: castingEconomy(e) ?? 'other',
    concentration: duration.some((d) => isRecord(d) && d.concentration === true),
    ritual: meta.ritual === true,
    components: {
      v: components.v === true,
      s: components.s === true,
      m: components.m !== undefined,
    },
    rolls,
  };
}

function runSpells(
  set: ConvertedSet,
  all: Pair[],
  classesOf: (spell: Entity) => readonly string[],
): Report {
  const report = newReport(set.name, 'spell');
  for (const pair of all) {
    if (pair.kind !== 'spell') continue;
    if (report.scenarios >= LIMIT) break;
    report.scenarios += 1;
    try {
      const a = spellView(pair.official.entity);
      const b = spellView(pair.converted);
      a.classes = classSet(classesOf(pair.official.entity));
      b.classes = classSet(convertedSpellClasses(pair.converted));
      // No rolls at any level reads as `none`, so the example says so plainly.
      const none = (r: unknown) => Object.values(r as Record<string, string[]>).flat().length === 0;
      if (none(a.rolls)) a.rolls = 'none';
      if (none(b.rolls)) b.rolls = 'none';
      tally(report, labelOf(pair.name, pair.edition, pair.converted), a, b);
    } catch (err) {
      report.errors.push(`${pair.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}

/**
 * Every converted entry with no official counterpart, alone: does it work at
 * all? A race, background, feat or item is derived on a Fighter 5; a spell is
 * read as the Spells tab reads it. Class options are left out.
 */
function runUnmatched(set: ConvertedSet, regB: EntityRegistry, unmatched: Entity[]): Report {
  const ctx = engineContextFor(regB);
  const report = newReport(set.name, 'unmatched');
  const kindOf = new Map<Entity, ConvertedKind>();
  for (const kind of PAIRED)
    for (const e of (set.json[kind] as Entity[] | undefined) ?? []) kindOf.set(e, kind);
  const stats: FieldStats = { same: 0, differs: 0, examples: [] };
  report.fields.warnings = stats;
  for (const e of unmatched) {
    const kind = kindOf.get(e);
    if (kind === undefined || kind === 'optionalfeature') continue;
    if (kind === 'spell') {
      report.scenarios += 1;
      try {
        spellView(e);
      } catch (err) {
        report.errors.push(
          `spell ${String(e.name)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }
    const edition = editionOf(e);
    // A class at 5th level; a subclass on its class at 20th, so every feature is reached.
    const doc =
      kind === 'class'
        ? baseDoc(edition, 5, ref(e))
        : kind === 'subclass'
          ? baseDoc(edition, 20, { name: String(e.className), source: String(e.classSource) })
          : baseDoc(edition, 5);
    const first = doc.classes[0];
    if (kind === 'class' || kind === 'subclass') {
      if (kind === 'subclass' && first !== undefined) first.subclass = ref(e);
    } else if (kind === 'race') doc.race = ref(e);
    else if (kind === 'background') doc.background = ref(e);
    else if (kind === 'feat') doc.feats = [{ ref: ref(e), instanceId: 'f1' }];
    else
      doc.equipment = [
        { id: 'i1', ref: ref(e), qty: 1, equipped: true, attuned: needsAttunement(e) },
      ];
    report.scenarios += 1;
    try {
      const s = settle(doc, ctx, undefined, undefined, kind === 'class' || kind === 'subclass');
      // The base character has no subclass; a subclass under test must be found.
      const own = s.warnings.filter((w) => kind === 'subclass' || !/subclass/i.test(w));
      if (own.length === 0) stats.same += 1;
      else {
        stats.differs += 1;
        if (stats.examples.length < 20)
          stats.examples.push(`${kind} ${String(e.name)}: ${own.join('; ')}`);
      }
    } catch (err) {
      report.errors.push(
        `${kind} ${String(e.name)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return report;
}

// ---------------------------------------------------------------- main

const sets = (values.set ?? []).map((spec) => {
  const [name, list] = spec.split('=');
  return { name: name ?? spec, files: (list ?? '').split(',').filter(Boolean) };
});
if (sets.length === 0 || sets.some((s) => s.files.length === 0)) {
  console.error('Give each set as --set name=a.xml,b.xml (see the header of this script).');
  process.exit(1);
}
const files = await officialFiles();
const classesOf = await officialSpellClasses();
const regA = await withBuiltInRules(normalizeDataset(files));
const officialFeat = officialFeatLookup(regA);
const books = officialBooks(files);
const results: Array<{
  set: string;
  skipped: string[];
  converted: Record<string, number>;
  matched: Record<string, number>;
  reports: Report[];
}> = [];
for (const s of sets) {
  const started = performance.now();
  const set = await convertSet(s.name, s.files, officialFeat);
  for (const why of set.skipped) console.warn(`   skipped ${why}`);
  const regB = await withBuiltInRules(normalizeDataset(files));
  mergeHomebrew(regB, new Map([[s.name, set.json]]));
  const { pairs: all, unmatched } = pairs(regA, set, books);
  const converted = Object.fromEntries(
    PAIRED.map((k) => [k, ((set.json[k] as unknown[]) ?? []).length]),
  );
  const matched = Object.fromEntries(
    PAIRED.map((k) => [k, all.filter((p) => p.kind === k).length]),
  );
  const reports = [
    ...runSwaps(set, regA, regB, all),
    runSpells(set, all, classesOf),
    runUnmatched(set, regB, unmatched),
  ];
  results.push({ set: s.name, skipped: set.skipped, converted, matched, reports });
  const ms = performance.now() - started;
  console.log(`\n== ${s.name} (${(ms / 1000).toFixed(1)} s)`);
  console.log(`   converted ${JSON.stringify(converted)}`);
  console.log(`   paired    ${JSON.stringify(matched)}`);
  for (const r of reports) {
    const bad = Object.entries(r.fields)
      .filter(([, f]) => f.differs > 0)
      .map(([k, f]) => `${k} ${f.differs}/${f.same + f.differs}`);
    const entriesOff = Object.values(r.entries).filter((f) => Object.keys(f).length > 0).length;
    console.log(
      `   ${r.kind.padEnd(16)} scenarios ${String(r.scenarios).padStart(5)}  entries differing ${entriesOff}/${Object.keys(r.entries).length}  unchecked ${r.unchecked.length}  errors ${r.errors.length}`,
    );
    if (bad.length > 0) console.log(`      ${bad.join(', ')}`);
  }
  // Written after each set, so a later set that fails keeps the earlier ones.
  if (values.out !== undefined) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(
      path.join(values.out, 'sheet-compare.json'),
      `${JSON.stringify(results, null, 1)}\n`,
    );
  }
}
if (values.out !== undefined) console.log(`\nwrote ${path.join(values.out, 'sheet-compare.json')}`);
