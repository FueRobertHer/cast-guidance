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
// Character export format
// ---------------------------------------------------------------------------

export const CHARACTER_EXPORT_FORMAT = 'cast-guidance/character@1';

export interface CharacterExport {
  $format: typeof CHARACTER_EXPORT_FORMAT;
  character: unknown;
  homebrew: HomebrewFileRow[];
}

export function assertCharacterExport(raw: unknown): CharacterExport {
  if (raw === null || typeof raw !== 'object') {
    throw new ValidationError('not a character export file');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.$format !== CHARACTER_EXPORT_FORMAT) {
    throw new ValidationError(
      `unsupported format "${String(obj.$format)}" (expected ${CHARACTER_EXPORT_FORMAT})`,
    );
  }
  if (obj.character === null || typeof obj.character !== 'object') {
    throw new ValidationError('export is missing the character document');
  }
  const homebrew = Array.isArray(obj.homebrew) ? (obj.homebrew as HomebrewFileRow[]) : [];
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
