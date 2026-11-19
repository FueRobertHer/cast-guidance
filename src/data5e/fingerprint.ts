/**
 * Short marks of what an entry said, so a copy or a change to the books can
 * tell when the entry below it moved (ADR-002, D2): one over the whole entry
 * (`fingerprint`, "The original changed since you copied it"), and one per
 * field (`fieldPrint`), so an update that changed a field a change also
 * changes sends the entry to Needs a look.
 *
 * Pure, with relative imports only: `normalize.ts` reads it, and the data
 * audit runs that file under plain Bun.
 */
import { isRecord, own } from '../engine/castGuidance';

type Json = Record<string, unknown>;

/**
 * Keys no mark reads: an entry's identity and guidance, and what the data or
 * the registry keeps about the book it is printed in. The Workshop never
 * writes them from a draft either (`copyWriter.ts`).
 */
export const NOT_WRITTEN: ReadonlySet<string> = new Set([
  'name',
  'source',
  '_copy',
  'castGuidance',
  '_versionOf',
  'bookEdition',
  '_versions',
  'reprintedAs',
  'srd',
  'srd52',
  'basicRules',
  'basicRules2024',
  'hasFluff',
  'hasFluffImages',
  'soundClip',
  'otherSources',
  'page',
  'alias',
]);

/** The parts of an entry's `castGuidance` that are its author's, not worked out by a save. */
export const OWN_GUIDANCE = ['effects', 'drop', 'amend', 'replace', 'moments'] as const;

/** JSON with its keys sorted, so two equal values always print the same. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/** FNV-1a over a string, as eight hex digits. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A short mark of what an entry said, over every field a mark reads. */
export function fingerprint(e: Json): string {
  const kept: Json = {};
  for (const k of Object.keys(e)) if (!NOT_WRITTEN.has(k)) kept[k] = e[k];
  return hash(stable(kept));
}

/**
 * A short mark of one field of an entry. `castGuidance` is marked by its
 * author's parts alone (`OWN_GUIDANCE`), since a save works out the rest, and
 * `castGuidance.<part>` by that one part.
 */
export function fieldPrint(e: Json, field: string): string {
  const g = own(e, 'castGuidance');
  const part = field.startsWith('castGuidance.') ? field.slice('castGuidance.'.length) : undefined;
  if (part !== undefined && (OWN_GUIDANCE as readonly string[]).includes(part)) {
    return hash(stable(isRecord(g) ? own(g, part) : undefined));
  }
  if (field !== 'castGuidance') return hash(stable(own(e, field)));
  const parts: Json = {};
  if (isRecord(g)) for (const k of OWN_GUIDANCE) if (Object.hasOwn(g, k)) parts[k] = g[k];
  return hash(stable(parts));
}
