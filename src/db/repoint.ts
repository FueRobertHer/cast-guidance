/**
 * Moving or renaming an entry keeps it on every sheet (ADR-002, D5).
 *
 * An entry is known by its name and its source, and a character holds what it
 * uses by both: in its refs, in the keys of its picks (`class:<name|source>:…`,
 * `feat:<name|source>:<instance>:…`), in the values of some (a feat or an
 * optional feature picked), and in the pools a granted spell spends. A move
 * gives an entry its new collection's source, so each collection keeps one
 * source and its switch for a character stays exact; a rename gives it a new
 * name. Either way, in the same transaction as the move or the save, every
 * character is re-pointed from the old identity to the new, the player's own
 * rule packs' changes follow it, and the imported packs that still name it
 * where it was are listed.
 *
 * Loaded on a move or a rename alone, never with the app.
 */
import { invalidateRegistry } from '@/data5e/registry';
import { packGuidance, packName } from '@/data5e/rulePack';
import { addedSpellPoolKey } from '@/engine/effects/addedSpells';
import { parseSpellRef } from '@/engine/effects/additionalSpells';
import { migrateCharacter } from '@/engine/migrate';
import {
  type ActiveEffect,
  type AddedSpell,
  type CharacterDoc,
  type ClassLevelEntry,
  type EntityRef,
  type EquipmentEntry,
  type KeptEffect,
  type PlayState,
  refUid,
} from '@/engine/types';
import { randomId } from '@/lib/randomId';
import { type CharacterRow, db } from './db';
import {
  EntryClash,
  type EntryKey,
  type HomebrewFile,
  internals,
  partitionHomebrewMeta,
  partitionHomebrewRows,
  withContent,
} from './homebrewRepo';

const { isEntry, rewrite, OWNED } = internals;

/** One entry's identity changing: where characters hold it, and where it is now. */
export interface Repoint {
  /** Its type, as the registry and the file name it: `feat`, `spell`, `class`. */
  type: string;
  from: EntityRef;
  to: EntityRef;
}

/** An imported rule pack whose changes still name an entry where it was. */
export interface ImportedMention {
  fileId: string;
  fileName: string;
  /** The pack's name, as the review shows it. */
  pack: string;
  /** Its changes' targets that name an old identity, as the file writes them. */
  targets: string[];
}

/** What a move or a rename re-pointed. */
export interface RepointReport {
  /** Each entry moved or renamed (a class's or subclass's own features go with it unlisted). */
  changes: Repoint[];
  /** The characters re-pointed, by id. */
  characters: string[];
  /** Characters that could not be read (a newer app's, a broken row), left as they were. */
  skipped: string[];
  /** The player's own rule packs whose changes followed, by file id. */
  packs: string[];
  /**
   * Imported rule packs that name an entry where it was. They are left as
   * they came, so their changes no longer reach it: the move sheet lists them.
   */
  imported: ImportedMention[];
}

/** Entries to move from one of the player's collections to another. */
export interface MoveRequest {
  /** The file they are in, one the player owns. */
  from: string;
  /** The file they go to, one the player owns: they take its source. */
  to: string;
  entries: ReadonlyArray<EntryKey & { type: string }>;
}

/** A move that cannot be made as asked; nothing was changed. */
export class MoveRefused extends Error {}

type Row = Record<string, unknown>;

const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

const lower = (v: unknown): string | undefined =>
  typeof v === 'string' ? v.trim().toLowerCase() : undefined;

const eq = (a: unknown, b: unknown) => lower(a) !== undefined && lower(a) === lower(b);

/** A change as the walker reads it: both identities as uids, and whether the name changed. */
interface Change extends Repoint {
  was: string;
  now: string;
  renamed: boolean;
  /** Its pick keys' `<prefix>:<uid>` pattern, when its type has one. */
  keys?: RegExp;
  /**
   * The character holds this very entry by its ref (an added spell, a class's
   * levels). What names it by its name alone (an added spell's pool, an
   * effect's class) follows a rename only then: another book's entry may
   * have the name.
   */
  held?: boolean;
}

/** The pick key prefixes a type's uid follows (`class:wizard|phb:skill:0`). */
const KEY_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  race: ['race'],
  // A subrace's own trait picks are under `race:<subrace uid>`.
  subrace: ['subrace', 'race'],
  background: ['background'],
  class: ['class'],
  subclass: ['subclass'],
  feat: ['feat'],
  // Its picks are under its host's type with its own uid, and its spells under `spells-of`.
  optionalfeature: ['class', 'subclass', 'feat', 'spells-of'],
  item: ['item', 'spells', 'attached'],
  baseitem: ['item', 'spells', 'attached'],
};

/**
 * The type whose own picks each borrowed prefix keys: an optional feature's
 * picks sit under its host's `class:`, `subclass:` or `feat:`, and a subrace's
 * under `race:`, beside those of an entry of that type with the same name and
 * book. While that entry stays where it was, the keys are taken to be its.
 */
const OWNER_OF: Readonly<Record<string, string>> = {
  race: 'race',
  class: 'class',
  subclass: 'subclass',
  feat: 'feat',
};

/** Types whose name a built-in pick's key holds after the uid (`feat:<uid>:skill:<name>`). */
const LABELLED = new Set(['feat', 'race', 'subrace', 'item', 'baseitem']);

/** Types a granted spell's pool key starts with (`spell:<origin uid>:<spells>`). */
const ORIGINS = new Set([...Object.keys(KEY_PREFIXES)]);

const esc = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `list` as the walker reads it. `stays` says whether an entry of a type, by
 * its uid, is still where it was once the move or the rename is made.
 */
function changesOf(
  list: readonly Repoint[],
  stays: (type: string, uid: string) => boolean = () => false,
): Change[] {
  return list.map((r) => {
    const was = refUid(r.from);
    const now = refUid(r.to);
    const renamed = r.from.name.trim().toLowerCase() !== r.to.name.trim().toLowerCase();
    const prefixes = KEY_PREFIXES[r.type]?.filter((p) => {
      const owner = OWNER_OF[p];
      return owner === undefined || owner === r.type || !stays(owner, was);
    });
    const label =
      renamed && LABELLED.has(r.type)
        ? `(?::(skill|tool|weapon|save):(${esc(r.from.name.trim().toLowerCase())}))?`
        : '';
    const keys =
      prefixes === undefined || prefixes.length === 0
        ? undefined
        : new RegExp(`(^|:)(${prefixes.map(esc).join('|')}):${esc(was)}${label}(?=:|$)`, 'g');
    return { ...r, was, now, renamed, ...(keys === undefined ? {} : { keys }) };
  });
}

// ---------------------------------------------------------------------------
// The walker: one entry per field, so a field added without one fails to compile
// ---------------------------------------------------------------------------

/** What re-points one field: the value re-pointed, or the very same value when nothing in it moved. */
export type Walk<T> = (value: T | undefined, c: readonly Change[]) => T | undefined;

/**
 * One walker per field of `T`, optional ones included, or `null` for a field
 * that holds no entry's identity. Exhaustive: a field added to the character
 * without an entry here is a compile error.
 */
export type Walkers<T> = { readonly [K in keyof T]-?: Walk<Exclude<T[K], undefined>> | null };

function fields<T>(walkers: Walkers<T>): Walk<T> {
  return (value, c) => {
    if (!isRecord(value)) return value;
    let out: Row | undefined;
    for (const [key, walk] of Object.entries(walkers) as Array<[string, Walk<unknown> | null]>) {
      if (walk === null || !Object.hasOwn(value, key)) continue;
      const before = value[key];
      const after = walk(before, c);
      if (after === before) continue;
      out ??= { ...value };
      out[key] = after;
    }
    return (out ?? value) as T;
  };
}

function list<T>(walk: Walk<T>): Walk<T[]> {
  return (value, c) => {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const out = value.map((v) => {
      const after = walk(v, c);
      if (after !== v) changed = true;
      return after as T;
    });
    return changed ? out : value;
  };
}

/**
 * A record whose keys may be re-pointed as well as its values. A key re-pointed
 * onto one already there wins: it is what the character used until now.
 */
function record<V>(rekey: Walk<string>, walk: Walk<V> | null): Walk<Record<string, V>> {
  return (value, c) => {
    if (!isRecord(value)) return value;
    let changed = false;
    const kept: Array<[string, unknown]> = [];
    const moved: Array<[string, unknown]> = [];
    for (const [key, v] of Object.entries(value)) {
      const k = rekey(key, c) ?? key;
      const after = walk === null ? v : walk(v as V, c);
      if (k !== key || after !== v) changed = true;
      (k === key ? kept : moved).push([k, after]);
    }
    return changed ? (Object.fromEntries([...kept, ...moved]) as Record<string, V>) : value;
  };
}

/** An entry's ref, of one of these types. */
const ref =
  (...types: string[]): Walk<EntityRef> =>
  (value, c) => {
    if (!isRecord(value) || typeof value.name !== 'string' || typeof value.source !== 'string') {
      return value;
    }
    const uid = refUid({ name: value.name, source: value.source });
    const hit = c.find((x) => types.includes(x.type) && x.was === uid);
    return hit === undefined ? value : { ...value, name: hit.to.name, source: hit.to.source };
  };

/** A name alone (a condition in play, what a character concentrates on): only a rename moves it. */
const named =
  (...types: string[]): Walk<string> =>
  (value, c) => {
    const hit = c.find((x) => x.renamed && types.includes(x.type) && eq(value, x.from.name));
    return hit === undefined ? value : hit.to.name;
  };

/** Every pick key holding an old uid, the uid re-pointed (and a built-in pick's name with it). */
function rekeyChoice(key: string, c: readonly Change[]): string {
  let out = key;
  for (const x of c) {
    if (x.keys !== undefined) {
      // Without the name's group, the third argument is the match's offset.
      out = out.replace(
        x.keys,
        (_m, lead: string, prefix: string, kind: unknown) =>
          `${lead}${prefix}:${x.now}${typeof kind === 'string' ? `:${kind}:${x.to.name.trim().toLowerCase()}` : ''}`,
      );
    }
    // A class's ASI feat instance (`asi4@<class uid>`), and a feat a background
    // gave, whose instance is the background (`feat:<feat uid>:<background uid>`).
    // Sequential, which holds as no batch moves an entry onto another's old place.
    if (x.type === 'class') {
      out = out.replace(
        new RegExp(`(^|:)(asi\\d+@)${esc(x.was)}(?=:|$)`, 'g'),
        (_m, lead: string, asi: string) => `${lead}${asi}${x.now}`,
      );
    } else if (x.type === 'background') {
      out = out.replace(
        new RegExp(`(^|:)(feat:[^|]*\\|[^:]*:)${esc(x.was)}(?=:|$)`, 'g'),
        (_m, lead: string, feat: string) => `${lead}${feat}${x.now}`,
      );
    }
  }
  return out;
}

/** The picks whose answer is a feat, and those whose answer is an optional feature. */
const FEAT_KEY = /:asi:\d+:feat$|(?:^|:)background:.+:feat:\d+$/;
const OPTION_KEY = /:optfeature:/;
const MASTERY_KEY = /weapon-?mastery$/i;

/** One pick's answer, re-pointed where it names an entry that moved. */
function answer(key: string, v: string, c: readonly Change[]): string {
  const id = v.trim().toLowerCase();
  const feat = FEAT_KEY.test(key);
  const option = OPTION_KEY.test(key);
  for (const x of c) {
    // Lowercased, as the pickers store these.
    if (feat || option) {
      if (x.type === (feat ? 'feat' : 'optionalfeature') && id === x.was) return x.now;
      continue;
    }
    // A spell as the pickers write it, in the data's case.
    if (x.type === 'spell' && v.split('|').length === 2 && refUid(parseSpellRef(v)) === x.was) {
      return `${x.to.name}|${x.to.source}`;
    }
    // A weapon's mastery is picked by the weapon's name alone.
    if (
      (x.type === 'item' || x.type === 'baseitem') &&
      x.renamed &&
      MASTERY_KEY.test(key) &&
      id === x.from.name.trim().toLowerCase()
    ) {
      return x.to.name;
    }
  }
  return v;
}

const rekeyChoices = record<CharacterDoc['choices'][string]>(
  (key, c) => (key === undefined ? key : rekeyChoice(key, c)),
  null,
);

/** Every pick: its answer read under its key as it was, then the key re-pointed. */
const choices: Walk<CharacterDoc['choices']> = (value, c) => rekeyChoices(answers(value, c), c);

/** Every answer re-pointed, under the keys as they were. */
function answers(
  value: CharacterDoc['choices'] | undefined,
  c: readonly Change[],
): CharacterDoc['choices'] | undefined {
  if (!isRecord(value)) return value;
  let out: CharacterDoc['choices'] | undefined;
  for (const [key, v] of Object.entries(value)) {
    let after: unknown = v;
    if (typeof v === 'string') after = answer(key, v, c);
    else if (Array.isArray(v)) {
      const mapped = v.map((s) => (typeof s === 'string' ? answer(key, s, c) : s));
      if (mapped.some((s, i) => s !== v[i])) after = mapped;
    }
    if (after === v) continue;
    out ??= { ...(value as CharacterDoc['choices']) };
    out[key] = after as CharacterDoc['choices'][string];
  }
  return out ?? value;
}

/** A feat's instance names what granted it: a background's uid, or `asi<N>@<class uid>`. */
const instance: Walk<string> = (value, c) => {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const x of c) {
    if (x.type === 'background' && out.toLowerCase() === x.was) out = x.now;
    if (x.type === 'class') {
      out = out.replace(new RegExp(`^(asi\\d+@)${esc(x.was)}$`), (_m, asi: string) => asi + x.now);
    }
  }
  return out;
};

/**
 * A pool's key: a granted spell's pool is `spell:<origin uid>:<spells>`, an
 * added spell's `spell:added:<name>`. Other pools are keyed by what their
 * entry's effects name them, which neither a move nor a rename changes.
 *
 * A granted pool's spells are named as the grant writes them, and a grant in
 * an entry is not followed (`repointAll`), so a renamed spell keeps its place
 * in the key: the grant still names it so.
 */
const poolKey: Walk<string> = (value, c) => {
  if (typeof value !== 'string') return value;
  let key = value;
  for (const x of c) {
    const at = `spell:${x.was}:`;
    if (ORIGINS.has(x.type) && key.startsWith(at)) key = `spell:${x.now}:${key.slice(at.length)}`;
    if (
      x.type === 'spell' &&
      x.renamed &&
      x.held === true &&
      key === addedSpellPoolKey(x.from.name)
    ) {
      key = addedSpellPoolKey(x.to.name);
    }
  }
  return key;
};

/** An effect a character holds: what it is immune to, a class it names, a spell it grants. */
const effect: Walk<unknown> = (value, c) => {
  if (!isRecord(value)) return value;
  let out: Row | undefined;
  const set = (k: string, v: unknown) => {
    out ??= { ...value };
    out[k] = v;
  };
  for (const x of c) {
    if (x.renamed && x.type === 'condition' && value.kind === 'conditionImmune') {
      if (eq(value.condition, x.from.name)) set('condition', x.to.name);
    }
    if (x.renamed && x.type === 'class' && x.held === true) {
      if (eq(value.className, x.from.name)) set('className', x.to.name);
      if (isRecord(value.on) && eq(value.on.className, x.from.name)) {
        set('on', { ...value.on, className: x.to.name });
      }
    }
  }
  const spell = ref('spell')(value.spell as EntityRef | undefined, c);
  if (spell !== value.spell) set('spell', spell);
  return out ?? value;
};

const effects = list(effect);

/**
 * The sources a character depends on, for its export, with the one an entry
 * it holds moved to. Only for a character the walk re-pointed: the old source
 * alone says nothing of which of its entries the character holds.
 */
function withDeps(value: unknown, c: readonly Change[]): unknown {
  if (!Array.isArray(value)) return value;
  const have = new Set(value.map(lower));
  const add: string[] = [];
  for (const x of c) {
    const to = x.to.source.toLowerCase();
    if (
      to !== x.from.source.toLowerCase() &&
      have.has(x.from.source.toLowerCase()) &&
      !have.has(to)
    ) {
      have.add(to);
      add.push(x.to.source);
    }
  }
  return add.length === 0 ? value : [...value, ...add];
}

const CLASS_LEVEL: Walkers<ClassLevelEntry> = {
  ref: ref('class'),
  subclass: ref('subclass'),
  levels: null,
  hp: null,
};

const FEAT: Walkers<CharacterDoc['feats'][number]> = {
  ref: ref('feat'),
  instanceId: instance,
};

const EQUIPMENT: Walkers<EquipmentEntry> = {
  id: null,
  ref: ref('item', 'baseitem'),
  // The player's own words: never an entry.
  custom: null,
  qty: null,
  equipped: null,
  attuned: null,
  location: null,
};

const SPELL_LISTS: Walkers<CharacterDoc['spellcasting'][string]> = {
  known: list(ref('spell')),
  prepared: list(ref('spell')),
};

const ADDED_SPELL: Walkers<AddedSpell> = {
  spell: ref('spell'),
  ability: null,
  uses: null,
};

const KEPT: Walkers<KeptEffect> = {
  id: null,
  // The player's name for it.
  name: null,
  parts: effects as Walk<KeptEffect['parts']>,
  lasts: null,
  tempHp: null,
};

const ACTIVE: Walkers<ActiveEffect> = {
  id: null,
  // A spell or a potion lands under its name, which concentration and a recast find it by.
  name: named('spell', 'item', 'baseitem'),
  same: null,
  parts: effects as Walk<ActiveEffect['parts']>,
  lasts: null,
  turnsLeft: null,
  mine: null,
  off: null,
};

const CONDITION: Walkers<PlayState['conditions'][number]> = {
  // A condition in play is its name.
  id: named('condition'),
  level: null,
  ignored: null,
};

const CONCENTRATION: Walkers<NonNullable<PlayState['concentratingOn']>> = {
  label: named('spell'),
  level: null,
  spent: null,
};

const RESOURCE: Walkers<PlayState['resources'][number]> = {
  key: poolKey,
  used: null,
};

const PLAY: Walkers<PlayState> = {
  currentHp: null,
  tempHp: null,
  tempHpFrom: null,
  hitDiceSpent: null,
  slotsSpent: null,
  pactSlotsSpent: null,
  arcanumUsed: null,
  foretold: record(poolKey, null),
  conditions: list(fields(CONDITION)),
  deathSaves: null,
  concentratingOn: fields(CONCENTRATION),
  resources: list(fields(RESOURCE)),
  inspiration: null,
  currency: null,
  xp: null,
  // One turn's bookkeeping, keyed by names: a rename costs at most this turn's.
  turn: null,
  // Keyed by an equipment entry's id, else an attack's own label.
  weaponExtras: null,
  hpInitialized: null,
  activeEffects: list(fields(ACTIVE)),
};

const DOC: Walkers<CharacterDoc> = {
  id: null,
  schemaVersion: null,
  createdAt: null,
  updatedAt: null,
  name: null,
  rulesVersion: null,
  // Whole collections' sources: a moved entry follows its new collection's switch (D5).
  allowedSources: null,
  sourceSwitches: null,
  dataTag: null,
  abilities: null,
  hpMethod: null,
  oneUseDice: null,
  tableRules: null,
  optionalClassFeatures: null,
  keptEffects: list(fields(KEPT)),
  race: ref('race'),
  subrace: ref('subrace'),
  background: ref('background'),
  classes: list(fields(CLASS_LEVEL)),
  feats: list(fields(FEAT)),
  choices,
  equipment: list(fields(EQUIPMENT)),
  // Keyed by its class's uid.
  spellcasting: record(
    (key, c) => c.find((x) => x.type === 'class' && x.was === key)?.now ?? key,
    fields(SPELL_LISTS),
  ),
  addedSpells: list(fields(ADDED_SPELL)),
  customEffects: effects as Walk<CharacterDoc['customEffects']>,
  // Skills and the sheet's own numbers.
  overrides: null,
  play: fields(PLAY),
  // Joined after the walk, by a character it re-pointed (`withDeps`).
  homebrewDeps: null,
  notes: null,
};

/** Every walker map, for the test that each field they walk is re-pointed. */
export const FIELD_WALKERS = {
  doc: DOC,
  play: PLAY,
  classes: CLASS_LEVEL,
  feats: FEAT,
  equipment: EQUIPMENT,
  spellcasting: SPELL_LISTS,
  addedSpells: ADDED_SPELL,
  keptEffects: KEPT,
  activeEffects: ACTIVE,
  conditions: CONDITION,
  concentratingOn: CONCENTRATION,
  resources: RESOURCE,
} as const;

/**
 * `doc` with every reference to an entry in `changes` re-pointed to where it is
 * now, or `doc` itself when it holds none. Each field is matched against the
 * old identities as they were, never against another change's result.
 */
export function repointDoc(doc: CharacterDoc, changes: readonly Repoint[]): CharacterDoc {
  if (changes.length === 0) return doc;
  return walkDoc(doc, changesOf(changes));
}

/** Whether `list` holds the entry `uid` names, at `at` of an item. */
const holdsRef = (list: unknown, at: (v: Row) => unknown, uid: string): boolean =>
  Array.isArray(list) &&
  list.some((v) => {
    const r = isRecord(v) ? at(v) : undefined;
    return (
      isRecord(r) &&
      typeof r.name === 'string' &&
      typeof r.source === 'string' &&
      refUid({ name: r.name, source: r.source }) === uid
    );
  });

function walkDoc(doc: CharacterDoc, c: readonly Change[]): CharacterDoc {
  const held = (x: Change) =>
    x.type === 'spell'
      ? holdsRef(doc.addedSpells, (a) => a.spell, x.was)
      : x.type === 'class' && holdsRef(doc.classes, (l) => l.ref, x.was);
  const mine = c.map((x) => ({ ...x, held: held(x) }));
  const walked = fields(DOC)(doc, mine) ?? doc;
  if (walked === doc) return doc;
  const deps = withDeps(walked.homebrewDeps, mine);
  return deps === walked.homebrewDeps
    ? walked
    : { ...walked, homebrewDeps: deps as CharacterDoc['homebrewDeps'] };
}

// ---------------------------------------------------------------------------
// Rule packs
// ---------------------------------------------------------------------------

/** Types whose name a pack's change names an entry under them by (`Rage|Barbarian`, `trait|species`). */
const PARENTS = new Set(['class', 'subclass', 'race', 'subrace']);

/** A pack change's target re-pointed, or as it was. */
function retarget(target: unknown, c: readonly Change[]): unknown {
  if (typeof target !== 'string') return target;
  const t = target.trim().toLowerCase();
  for (const x of c) {
    if (t === x.was) return `${x.to.name}|${x.to.source}`;
    const parts = target.split('|');
    if (x.renamed && PARENTS.has(x.type) && parts.length === 2 && eq(parts[1], x.from.name)) {
      return `${parts[0]}|${x.to.name}`;
    }
  }
  return target;
}

/** A pack's changes whose target names an old identity, re-pointed in place: their old targets. */
function retargetPack(json: unknown, c: readonly Change[], write: boolean): string[] {
  const patches = packGuidance(json)?.patches;
  if (!Array.isArray(patches)) return [];
  const hit: string[] = [];
  for (const p of patches) {
    if (!isRecord(p)) continue;
    const next = retarget(p.target, c);
    if (next === p.target) continue;
    hit.push(String(p.target));
    if (write) p.target = next;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// The player's files, characters, and the transaction that holds them
// ---------------------------------------------------------------------------

/** A file the player owns, its content open to change, and what it held when read. */
interface Open {
  file: HomebrewFile;
  json: Row;
  was: string;
}

/** Every file the player owns, read in the caller's transaction. */
async function openOwned(): Promise<Map<string, Open>> {
  const rows = (await db.homebrewFiles.toArray()).filter((r) => r.editable === true);
  const out = new Map<string, Open>();
  for (const file of partitionHomebrewRows(await withContent(rows)).files) {
    out.set(file.id, { file, json: structuredClone(file.json), was: JSON.stringify(file.json) });
  }
  return out;
}

/** A subrace's race, followed: a subrace names its race by name and source. */
function carryRace(json: Row, x: Change): void {
  if (x.type !== 'race' || !Array.isArray(json.subrace)) return;
  json.subrace = json.subrace.map((s) =>
    isRecord(s) && eq(s.raceName, x.from.name) && eq(s.raceSource, x.from.source)
      ? { ...s, raceName: x.to.name, raceSource: x.to.source }
      : s,
  );
}

/**
 * A class's subclasses and their features, followed: they name their class by
 * name and source, in whichever of the player's files they are. A rename's
 * save carries only its own file's; a move has carried them all already.
 */
function carryClass(json: Row, x: Change): void {
  if (x.type !== 'class') return;
  OWNED.class?.carry?.(
    json,
    { name: x.from.name, source: x.from.source },
    { name: x.to.name, source: x.to.source },
  );
}

/**
 * Re-point everything that holds `c`'s old identities, in the caller's
 * transaction over both homebrew tables and the characters: the player's own
 * files (`owned`, written back where changed), imported packs (listed), and
 * every character, with a new revision so an open sheet sees the change.
 */
async function repointAll(
  list: readonly Repoint[],
  owned: Map<string, Open>,
): Promise<RepointReport> {
  const files = [...owned.values()];
  const stays = (type: string, uid: string) =>
    files.some((f) =>
      entriesOf(f.json, type).some(
        (e) =>
          isRecord(e) &&
          typeof e.name === 'string' &&
          typeof e.source === 'string' &&
          refUid({ name: e.name, source: e.source }) === uid,
      ),
    );
  const c = changesOf(list, stays);
  const packs: string[] = [];
  for (const f of owned.values()) {
    for (const x of c) {
      carryRace(f.json, x);
      carryClass(f.json, x);
    }
    if (retargetPack(f.json, c, true).length > 0) packs.push(f.file.id);
  }
  for (const f of owned.values()) {
    if (JSON.stringify(f.json) !== f.was && !(await rewrite(f.file.id, f.json))) {
      throw new MoveRefused(`"${f.file.fileName}" is no longer on this device`);
    }
  }

  // Imported packs only, so a book's megabytes are never read.
  const meta = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files;
  const imported: ImportedMention[] = [];
  const candidates = meta.filter((f) => !f.editable && f.book === undefined);
  const read = partitionHomebrewRows(
    await withContent(await db.homebrewFiles.bulkGet(candidates.map((f) => f.id)).then(defined)),
  );
  for (const f of read.files) {
    const targets = retargetPack(f.json, c, false);
    if (targets.length > 0) {
      imported.push({ fileId: f.id, fileName: f.fileName, pack: packName(f.json), targets });
    }
  }

  const rows = await db.characters.toArray();
  const changed: CharacterRow[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    // Synchronous, so only the read is caught, never a write.
    let doc: CharacterDoc;
    try {
      const { revision: _, ...stored } = row;
      doc = migrateCharacter(stored);
    } catch {
      skipped.push(row.id);
      continue;
    }
    const walked = walkDoc(doc, c);
    if (walked !== doc) changed.push({ ...walked, revision: randomId() });
  }
  if (changed.length > 0) await db.characters.bulkPut(changed);
  return {
    changes: list.map(({ type, from, to }) => ({ type, from, to })),
    characters: changed.map((r) => r.id),
    skipped,
    packs,
    imported,
  };
}

function defined<T>(rows: ReadonlyArray<T | undefined>): T[] {
  return rows.filter((r): r is T => r !== undefined);
}

/**
 * After a save renamed an entry in a file the player owns (`homebrewRepo.saveEntry`),
 * re-point everything that held it. Runs in the save's transaction, which
 * holds the characters too.
 */
export async function repointRename(
  type: string,
  from: EntityRef,
  to: EntityRef,
): Promise<RepointReport | undefined> {
  if (from.name === to.name && from.source === to.source) return undefined;
  return repointAll([{ type, from, to }], await openOwned());
}

// ---------------------------------------------------------------------------
// A move
// ---------------------------------------------------------------------------

const entriesOf = (json: Row, type: string): unknown[] =>
  Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];

/**
 * Every class or subclass feature ref in `v` passed through `fix`: a
 * `classFeatures` or `subclassFeatures` item, and a held feature's
 * `classFeature` or `subclassFeature`. In place.
 */
function eachFeatureRef(v: unknown, fix: (ref: string, sub: boolean) => string, list?: string) {
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      if (list !== undefined && typeof x === 'string') v[i] = fix(x, list === 'subclassFeatures');
      else eachFeatureRef(x, fix);
    });
    return;
  }
  if (!isRecord(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if ((k === 'classFeature' || k === 'subclassFeature') && typeof x === 'string') {
      v[k] = fix(x, k === 'subclassFeature');
    } else {
      eachFeatureRef(x, fix, k === 'classFeatures' || k === 'subclassFeatures' ? k : undefined);
    }
  }
}

/**
 * The refs to a moved class's or subclass's own features, re-pointed to its new
 * source. A class feature's ref is `Name|Class|ClassSource|Level|Source`, a
 * subclass feature's `Name|Class|ClassSource|Short|ShortSource|Level|Source`;
 * an empty book is PHB, as on the sheet.
 */
function featureRefFix(type: string, before: Row, source: string) {
  const old = before.source;
  return (ref: string, sub: boolean): string => {
    const p = ref.split('|');
    const book = (i: number) => p[i] || 'PHB';
    if (type === 'class' && eq(p[1], before.name) && eq(book(2), old)) {
      p[2] = source;
      if (!sub && eq(p[4], old)) p[4] = source;
    } else if (
      type === 'subclass' &&
      sub &&
      eq(p[1], before.className) &&
      eq(book(2), before.classSource ?? 'PHB') &&
      eq(p[3], before.shortName) &&
      eq(book(4), old)
    ) {
      p[4] = source;
      if (eq(p[6], old)) p[6] = source;
    } else {
      return ref;
    }
    return p.join('|');
  };
}

/** One of a moved class's or subclass's own features, at its new source. */
function movedFeature(type: string, f: Row, before: Row, source: string): Row {
  const at = type === 'class' ? { classSource: source } : { subclassSource: source };
  return { ...f, ...at, ...(eq(f.source, before.source) ? { source } : {}) };
}

/** Move one entry (and what it owns) from `from` to `to`, editing their content in place. */
function moveOne(
  owned: Map<string, Open>,
  from: Open,
  to: Open,
  want: EntryKey & { type: string },
  source: string,
): Repoint {
  const { type } = want;
  const left = entriesOf(from.json, type);
  const at = left.findIndex((e) => isEntry(e, want));
  const before = left[at];
  if (!isRecord(before) || typeof before.name !== 'string' || typeof before.source !== 'string') {
    throw new MoveRefused(`${want.name} is not in "${from.file.fileName}"`);
  }
  const into = entriesOf(to.json, type);
  if (into.some((e) => isEntry(e, { name: String(before.name), source }))) {
    throw new EntryClash(`"${to.file.fileName}" already has one called ${before.name}`);
  }
  const after: Row = { ...structuredClone(before), source };
  left.splice(at, 1);
  const own = OWNED[type];
  if (own !== undefined) {
    if (left.some((o) => isRecord(o) && own.peer(o, before))) {
      throw new MoveRefused(
        `another ${type} in "${from.file.fileName}" shares its features with ${before.name}`,
      );
    }
    if (into.some((o) => isRecord(o) && own.peer(o, after))) {
      throw new MoveRefused(
        `another ${type} in "${to.file.fileName}" would share its features with ${before.name}`,
      );
    }
    const theirs = entriesOf(from.json, own.type);
    const mine = theirs.filter((e): e is Row => isRecord(e) && own.owns(before, e));
    from.json[own.type] = theirs.filter((e) => !mine.includes(e as Row));
    const kept = entriesOf(to.json, own.type);
    const keys = new Set(kept.filter(isRecord).map((e) => own.key(e).toLowerCase()));
    for (const f of mine) {
      const g = movedFeature(type, structuredClone(f), before, source);
      if (keys.has(own.key(g).toLowerCase())) {
        throw new EntryClash(`"${to.file.fileName}" already has ${before.name}'s ${g.name}`);
      }
      kept.push(g);
    }
    to.json[own.type] = kept;
  }
  from.json[type] = left;
  into.push(after);
  to.json[type] = into;
  // What names it by its old source, in every file the player owns: a class's
  // subclasses and their features, and the refs to its own features.
  const fix = featureRefFix(type, before, source);
  for (const f of owned.values()) {
    if (type === 'class') OWNED.class?.carry?.(f.json, before, after);
    if (type === 'class' || type === 'subclass') eachFeatureRef(f.json, fix);
  }
  return {
    type,
    from: { name: before.name, source: before.source },
    to: { name: before.name, source },
  };
}

/**
 * Move entries from one of the player's collections to another, as one write
 * (ADR-002, D5): each takes the new collection's source, a class or subclass
 * takes its own features, and everything that held it is re-pointed in the same
 * transaction. An entry of that type and name already there refuses the whole
 * move (`EntryClash`), as does anything else that cannot be moved as asked
 * (`MoveRefused`); either way nothing is changed.
 */
export async function moveEntries(req: MoveRequest): Promise<RepointReport> {
  const report = await db.transaction(
    'rw',
    db.homebrewFiles,
    db.homebrewJson,
    db.characters,
    async () => {
      const owned = await openOwned();
      const from = owned.get(req.from);
      const to = owned.get(req.to);
      if (from === undefined || to === undefined) {
        throw new MoveRefused('only collections you made can be moved between');
      }
      if (from === to) throw new MoveRefused('they are in that collection already');
      if (from.file.role !== undefined || to.file.role !== undefined) {
        throw new MoveRefused('a change to the books keeps the book’s name and source');
      }
      const source = to.file.sourceIds[0];
      if (source === undefined || source === '') {
        throw new MoveRefused(`"${to.file.fileName}" has no source to give them`);
      }
      if (from.file.sourceIds.some((s) => eq(s, source))) {
        throw new MoveRefused('both collections have the same source');
      }
      const moved = req.entries.map((want) => moveOne(owned, from, to, want, source));
      return repointAll(moved, owned);
    },
  );
  invalidateRegistry();
  return report;
}
