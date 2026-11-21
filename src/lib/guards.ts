/**
 * Hand-rolled validators for the few formats we own. The 5etools dataset is
 * deliberately NOT validated (tolerant parsing everywhere).
 */
import type { HomebrewFileRow } from '@/db/db';

export class ValidationError extends Error {}

export interface HomebrewMetaSource {
  json: string;
  abbreviation?: string;
  full?: string;
}

/**
 * Minimal structural check for a homebrew file: `_meta.sources[].json`. Its
 * messages follow "Import failed: ", so they say what a player can check.
 */
export function assertHomebrewFile(raw: unknown): {
  meta: { sources: HomebrewMetaSource[] };
  json: Record<string, unknown>;
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(
      'not a homebrew file (a homebrew file is one JSON object, with a "_meta" block naming its books)',
    );
  }
  const json = raw as Record<string, unknown>;
  const meta = json._meta;
  if (meta === null || typeof meta !== 'object') {
    throw new ValidationError('not a homebrew file (it has no "_meta" block naming its books)');
  }
  const sources = (meta as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new ValidationError(
      'the "_meta" block names no books (it has no "sources" list, or an empty one)',
    );
  }
  const parsed: HomebrewMetaSource[] = [];
  for (const s of sources) {
    if (typeof s !== 'object' || s === null || typeof (s as { json?: unknown }).json !== 'string') {
      throw new ValidationError('a book in the "_meta" block has no "json" id to know it by');
    }
    parsed.push(s as unknown as HomebrewMetaSource);
  }
  return { meta: { sources: parsed }, json };
}

/** Entity-array keys we ingest from homebrew files (same keys as official data). */
export const HOMEBREW_ENTITY_KEYS = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'itemGroup',
  'magicvariant',
  'spell',
  'class',
  'subclass',
  'classFeature',
  'subclassFeature',
  'language',
  'condition',
  'disease',
  'status',
  'action',
  'skill',
  'sense',
  'variantrule',
] as const;

/** An entry {@link withReadableEntries} left out of a file, and why, in words. */
export interface SkippedEntry {
  /** The list it was in (`spell`, `subclassFeature`). */
  type: string;
  /** Its place in that list, from 0, as the file holds it. */
  index: number;
  /** Its name when it has a usable one, for the preview to say which. */
  name?: string;
  why: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Why an entry cannot be stored, or undefined when it can. The rule is the
 * least every reader assumes: an object, named in words. What the game data
 * itself leaves out is allowed, measured on v2.41.0: a subrace with no name is
 * its species' base subrace, and a magic item variant keeps its book under
 * `inherits`, so a book is never required, only text when given. An entry that
 * copies another (`_copy`) takes its name from it when it leaves one out, as
 * the merge reads it, so long as the copy names one.
 */
function unreadable(type: string, e: unknown): string | undefined {
  if (!isPlainObject(e)) return 'it is not an entry';
  if (e.name !== undefined && typeof e.name !== 'string') return 'its name is not text';
  const copiesNamed = isPlainObject(e._copy) && filled(e._copy.name);
  if (!filled(e.name) && type !== 'subrace' && !copiesNamed) return 'it has no name';
  if (e.source !== undefined && typeof e.source !== 'string') return 'its book is not text';
  return undefined;
}

/**
 * A homebrew file without the entries no part of the app can read (a spell
 * with no name would show as "?" in the Library, finding 14), with what was
 * left out. The same object comes back when nothing is, so a file's hash, and
 * with it "already on this device", never moves for a file that was fine.
 * Only the lists {@link HOMEBREW_ENTITY_KEYS} names are looked at; anything
 * else in the file is the file's own.
 */
export function withReadableEntries(json: Record<string, unknown>): {
  json: Record<string, unknown>;
  skipped: SkippedEntry[];
} {
  const skipped: SkippedEntry[] = [];
  let out: Record<string, unknown> | undefined;
  for (const type of HOMEBREW_ENTITY_KEYS) {
    const list = json[type];
    if (!Array.isArray(list)) continue;
    const kept: unknown[] = [];
    list.forEach((e, index) => {
      const why = unreadable(type, e);
      if (why === undefined) kept.push(e);
      else
        skipped.push({
          type,
          index,
          ...(isPlainObject(e) && filled(e.name) ? { name: e.name.trim() } : {}),
          why,
        });
    });
    if (kept.length === list.length) continue;
    out ??= { ...json };
    out[type] = kept;
  }
  return { json: out ?? json, skipped };
}

export function homebrewEntityCounts(json: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of HOMEBREW_ENTITY_KEYS) {
    const arr = json[key];
    if (Array.isArray(arr) && arr.length > 0) counts[key] = arr.length;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Structural limits (adversarial-payload defense for anything we import)
// ---------------------------------------------------------------------------

/** Structural bounds for a parsed JSON tree; see {@link assertJsonWithinLimits}. */
export interface JsonLimits {
  /** Total JSON values (objects, arrays, primitives) anywhere in the tree. */
  maxNodes: number;
  /** Object/array nesting depth. */
  maxDepth: number;
  /** Any single string value. */
  maxStringLength: number;
}

/**
 * Bounds applied to every import before it is trusted. A hostile or corrupted
 * file that exceeds any of these is rejected before it can be migrated,
 * hashed, indexed, or written. Generous enough for real characters with a few
 * embedded homebrew files.
 */
export const IMPORT_LIMITS = {
  /** Serialized export text (UTF-16 length, a cheap proxy for byte size). */
  maxTextLength: 4_000_000,
  /** Total JSON values (objects, arrays, primitives) anywhere in the tree. */
  maxNodes: 200_000,
  /** Object/array nesting depth. */
  maxDepth: 64,
  /** Any single string value. */
  maxStringLength: 200_000,
  /** Embedded homebrew files per export. */
  maxHomebrewFiles: 64,
  /**
   * Bytes read from an imported file or URL before it is parsed at all. The
   * text and tree limits above only run on a parsed value, which is too late
   * for a body large enough to exhaust memory on the way in.
   */
  maxImportBytes: 8 * 1024 * 1024,
  /**
   * The same for an XML file from another app. Such a file is read as it
   * arrives, an entry at a time, off the main thread, and never held whole,
   * so it can be as large as a full community compendium (56 MB measured).
   */
  maxXmlImportBytes: 64 * 1024 * 1024,
} as const;

/**
 * Bounds for an official data file, checked before it is cached, normalized
 * or indexed. Measured against v2.41.0: at most 66,963 values and 13 levels
 * (items.json) and 1,255 characters in one string (spells-xphb.json). These
 * leave roughly seven times the values and twenty-six times the string, so a release
 * that grows is accepted and a body that is not game data is not.
 */
export const DATA_FILE_LIMITS: JsonLimits = {
  maxNodes: 500_000,
  maxDepth: 64,
  maxStringLength: 32_768,
};

/**
 * Walk a parsed JSON value enforcing `limits` ({@link IMPORT_LIMITS} unless
 * given). Throws on the first breach, naming the value as `label` so a data
 * file's refusal does not read as an import's. Recursion is bounded by
 * `maxDepth`, so it cannot itself overflow the stack on adversarial input.
 */
export function assertJsonWithinLimits(
  raw: unknown,
  limits: JsonLimits = IMPORT_LIMITS,
  label = 'import',
): void {
  let nodes = 0;
  const walk = (value: unknown, depth: number): void => {
    if (depth > limits.maxDepth) {
      throw new ValidationError(`${label} nests deeper than ${limits.maxDepth} levels`);
    }
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new ValidationError(`${label} has more than ${limits.maxNodes} values`);
    }
    if (typeof value === 'string') {
      if (value.length > limits.maxStringLength) {
        throw new ValidationError(`${label} has a string longer than ${limits.maxStringLength}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const val of Object.values(value)) walk(val, depth + 1);
    }
  };
  walk(raw, 0);
}

// ---------------------------------------------------------------------------
// Character export format
// ---------------------------------------------------------------------------

export const CHARACTER_EXPORT_FORMAT = 'cast-guidance/character@1';

/** The format's name without its version, so a later version is known as ours. */
const CHARACTER_FORMAT_NAME = 'cast-guidance/character@';

/** This app's format at a version above the one it writes, such as `cast-guidance/character@2`. */
function isLaterFormat(format: unknown): boolean {
  if (typeof format !== 'string' || !format.startsWith(CHARACTER_FORMAT_NAME)) return false;
  const version = format.slice(CHARACTER_FORMAT_NAME.length);
  const current = Number(CHARACTER_EXPORT_FORMAT.slice(CHARACTER_FORMAT_NAME.length));
  return /^[1-9]\d*$/.test(version) && Number(version) > current;
}

export interface CharacterExport {
  $format: typeof CHARACTER_EXPORT_FORMAT;
  character: unknown;
  homebrew: HomebrewFileRow[];
}

/**
 * Structural shape check for a character document at the import boundary.
 * Deliberately shallow: it enforces the *types* of the known top-level fields
 * (so `classes: "drop table"` or a giant nested `choices` cannot slip through)
 * without re-validating every game field, which the tolerant engine handles.
 * Version handling stays in `migrateCharacter`.
 */
export function assertCharacterDoc(raw: unknown): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('character must be an object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.trim() === '') {
    throw new ValidationError('character is missing a valid id');
  }
  if (
    c.schemaVersion !== undefined &&
    (typeof c.schemaVersion !== 'number' || !Number.isFinite(c.schemaVersion))
  ) {
    throw new ValidationError('character schemaVersion must be a finite number');
  }
  for (const f of ['name', 'rulesVersion', 'dataTag', 'createdAt', 'updatedAt', 'notes'] as const) {
    if (c[f] !== undefined && typeof c[f] !== 'string') {
      throw new ValidationError(`character ${f} must be a string`);
    }
  }
  for (const f of [
    'classes',
    'feats',
    'equipment',
    'customEffects',
    'allowedSources',
    'homebrewDeps',
  ] as const) {
    if (c[f] !== undefined && !Array.isArray(c[f])) {
      throw new ValidationError(`character ${f} must be an array`);
    }
  }
  for (const f of [
    'abilities',
    'choices',
    'spellcasting',
    'overrides',
    'play',
    'sourceSwitches',
  ] as const) {
    const v = c[f];
    if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) {
      throw new ValidationError(`character ${f} must be an object`);
    }
  }
  // Its two lists, when given, are lists. What is inside them is read
  // tolerantly (`characterSourceSwitches`), like `allowedSources`.
  const switches = c.sourceSwitches as Record<string, unknown> | undefined;
  for (const f of ['on', 'off'] as const) {
    if (switches?.[f] !== undefined && !Array.isArray(switches[f])) {
      throw new ValidationError(`character sourceSwitches.${f} must be an array`);
    }
  }
}

export function assertCharacterExport(raw: unknown): CharacterExport {
  assertJsonWithinLimits(raw);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('this is not a character file from this app');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.$format !== CHARACTER_EXPORT_FORMAT) {
    // What the file says it is goes unsaid: it is the file's text, not words for a player.
    throw new ValidationError(
      isLaterFormat(obj.$format)
        ? 'this character file is from a newer version of the app: update the app, then import it again'
        : 'this is not a character file from this app',
    );
  }
  if (obj.character === null || typeof obj.character !== 'object' || Array.isArray(obj.character)) {
    throw new ValidationError('this character file has no character in it');
  }
  assertCharacterDoc(obj.character);
  let homebrew: HomebrewFileRow[] = [];
  if (obj.homebrew !== undefined) {
    if (!Array.isArray(obj.homebrew)) {
      throw new ValidationError('homebrew must be an array');
    }
    if (obj.homebrew.length > IMPORT_LIMITS.maxHomebrewFiles) {
      throw new ValidationError(
        `export embeds more than ${IMPORT_LIMITS.maxHomebrewFiles} homebrew files`,
      );
    }
    homebrew = obj.homebrew as HomebrewFileRow[];
  }
  return {
    $format: CHARACTER_EXPORT_FORMAT,
    character: obj.character,
    homebrew,
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
