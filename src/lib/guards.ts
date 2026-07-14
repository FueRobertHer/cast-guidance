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

/** Minimal structural check for a 5etools homebrew file: `_meta.sources[].json`. */
export function assertHomebrewFile(raw: unknown): {
  meta: { sources: HomebrewMetaSource[] };
  json: Record<string, unknown>;
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('homebrew file must be a JSON object');
  }
  const json = raw as Record<string, unknown>;
  const meta = json._meta;
  if (meta === null || typeof meta !== 'object') {
    throw new ValidationError('missing _meta block — is this a 5etools homebrew file?');
  }
  const sources = (meta as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new ValidationError('_meta.sources must be a non-empty array');
  }
  const parsed: HomebrewMetaSource[] = [];
  for (const s of sources) {
    if (typeof s !== 'object' || s === null || typeof (s as { json?: unknown }).json !== 'string') {
      throw new ValidationError('every _meta.sources entry needs a string "json" id');
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
} as const;

/**
 * Walk a parsed JSON value enforcing {@link IMPORT_LIMITS}. Throws on the first
 * breach. Recursion is bounded by `maxDepth`, so it cannot itself overflow the
 * stack on adversarial input.
 */
export function assertJsonWithinLimits(raw: unknown, limits = IMPORT_LIMITS): void {
  let nodes = 0;
  const walk = (value: unknown, depth: number): void => {
    if (depth > limits.maxDepth) {
      throw new ValidationError(`import nests deeper than ${limits.maxDepth} levels`);
    }
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new ValidationError(`import has more than ${limits.maxNodes} values`);
    }
    if (typeof value === 'string') {
      if (value.length > limits.maxStringLength) {
        throw new ValidationError(`import has a string longer than ${limits.maxStringLength}`);
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
  for (const f of ['abilities', 'choices', 'spellcasting', 'overrides', 'play'] as const) {
    const v = c[f];
    if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) {
      throw new ValidationError(`character ${f} must be an object`);
    }
  }
}

export function assertCharacterExport(raw: unknown): CharacterExport {
  assertJsonWithinLimits(raw);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('not a character export file');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.$format !== CHARACTER_EXPORT_FORMAT) {
    throw new ValidationError(
      `unsupported format "${String(obj.$format)}" (expected ${CHARACTER_EXPORT_FORMAT})`,
    );
  }
  if (obj.character === null || typeof obj.character !== 'object' || Array.isArray(obj.character)) {
    throw new ValidationError('export is missing the character document');
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
