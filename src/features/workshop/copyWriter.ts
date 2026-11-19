/**
 * What the Workshop saves (ADR-001, D3), worked out apart from any screen:
 *
 * - a new entry: its fields, plus its own `castGuidance` when it has effects;
 * - an edited copy, saved as its changes by default: `_copy` naming the entry
 *   it copies, a field for each top-level value that differs, name-matched
 *   `_mod` operations on `entries` (never array positions), and a
 *   `castGuidance.basedOn` pointer, so the copy keeps the original's curated
 *   mechanics and carries no book text it did not change;
 * - a full copy on request, for sharing with someone whose data lacks the
 *   original: every field written out, with the same `basedOn`.
 *
 * Every function here is pure. The editor holds the whole entry (the
 * original's fields included); what is stored is worked out from it and the
 * original at save time, so reopening a copy and saving it again always
 * writes against the original as it is now.
 */
import { applyMod, resolveCopies } from '@/data5e/copyMod';
// The marks live beside the registry, which reads them for Needs a look
// (ADR-002, D2). Keys a saved entry never writes from its draft are the keys
// no mark reads: its identity and its guidance, written apart, and what the
// data or the registry keeps about the book an entry is printed in.
import { fieldPrint, fingerprint, NOT_WRITTEN, OWN_GUIDANCE, same } from '@/data5e/fingerprint';
import { CAST_GUIDANCE_VERSION, ENTRY_PARENT_KEYS, isRecord, own } from '@/engine/castGuidance';
import { officialOf } from '@/engine/effects/mechanics';

export { fingerprint, same };

export type Json = Record<string, unknown>;

/** Changes only (the default), or every field written out. */
export type SaveMode = 'changes' | 'full';

/** The name an entries block goes by, when it is a named part (a trait, a benefit). */
export function partName(b: unknown): string | undefined {
  return isRecord(b) && typeof b.name === 'string' ? b.name : undefined;
}

/** The part a block stands for: the one its `castGuidance.basedOn` renames, else its own name. */
function partOrigin(b: unknown, names: readonly string[]): string | undefined {
  const name = partName(b);
  if (name === undefined) return undefined;
  const g = isRecord(b) ? own(b, 'castGuidance') : undefined;
  const based = isRecord(g) ? own(g, 'basedOn') : undefined;
  const was = typeof based === 'string' ? based.split('|')[0] : undefined;
  return was !== undefined && names.includes(was) ? was : name;
}

/**
 * How `entries` went from `was` to `now`: name-matched `_mod` operations when
 * those rebuild it exactly, else `whole` (the list is written out).
 *
 * Named parts are removed, replaced and appended by name; a plain paragraph
 * that changed is replaced by its exact text. Anything those cannot say (a
 * paragraph added, a list changed, a new part between old ones) writes the
 * whole list. The operations are checked by applying them with the same code
 * the registry uses, so what is stored always reads back as the editor showed.
 */
export function diffEntries(was: unknown, now: unknown): { ops: Json[] } | { whole: true } {
  const whole = { whole: true } as const;
  if (!Array.isArray(was) || !Array.isArray(now)) return whole;
  const names = was.map(partName).filter((n): n is string => n !== undefined);
  if (new Set(names).size !== names.length) return whole;

  const ops: Json[] = [];
  // Blocks with no name taken out and nothing else (a paragraph, the reference a
  // subclass feature holds to another) are removed by their exact value, when
  // only one block has it. A block reworded is replaced by its text, below.
  const unnamed = (l: unknown[]) => l.filter((b) => partName(b) === undefined);
  const out = unnamed(was).filter(
    (b) => !now.some((n) => same(n, b)) && was.filter((x) => same(x, b)).length === 1,
  );
  const gone = unnamed(was).length - out.length === unnamed(now).length ? out : [];
  if (gone.length > 0) ops.push({ mode: 'removeArr', items: gone });
  const wasText = was.filter((b) => partName(b) === undefined && !gone.includes(b));
  const nowText = now.filter((b) => partName(b) === undefined);
  if (wasText.length !== nowText.length) return whole;
  wasText.forEach((b, i) => {
    if (!same(b, nowText[i])) ops.push({ mode: 'replaceArr', replace: b, items: [nowText[i]] });
  });

  const origins = new Set<string>();
  const appended: unknown[] = [];
  for (const b of now) {
    const origin = partOrigin(b, names);
    if (origin === undefined) continue;
    if (origins.has(origin)) return whole;
    origins.add(origin);
    const before = was.find((x) => partName(x) === origin);
    if (before === undefined) appended.push(b);
    else if (!same(before, b)) ops.push({ mode: 'replaceArr', replace: origin, items: [b] });
  }
  const removed = names.filter((n) => !origins.has(n));
  if (removed.length > 0) ops.unshift({ mode: 'removeArr', names: removed });
  if (appended.length > 0) ops.push({ mode: 'appendArr', items: appended });

  // Only a plain string can be found by its text: a list or a table that changed
  // has no name to match on.
  if (ops.some((o) => o.mode === 'replaceArr' && typeof o.replace !== 'string')) return whole;
  const check: Json = { entries: structuredClone(was) };
  let warned = false;
  applyMod(check, { entries: structuredClone(ops) }, () => {
    warned = true;
  });
  return !warned && same(check.entries, now) ? { ops } : whole;
}

/** The official entry a copy of `original` stands for: the one it copies itself, else itself. */
export function basedOnKey(original: Json): string {
  const official = officialOf(original);
  return official !== undefined
    ? `${official.name}|${official.source}`
    : `${String(original.name)}|${String(original.source)}`;
}

export interface WriteInput {
  /** The entry being copied, as the registry holds it. Absent for a new entry. */
  original?: Json;
  /** The entry as the editor holds it: every field, the original's included. */
  draft: Json;
  /** The book the player's file declares. */
  source: string;
  mode: SaveMode;
}

/** The `castGuidance` a saved entry carries, or undefined when it has nothing to say. */
function guidanceFor(draft: Json, original: Json | undefined): Json | undefined {
  const raw = own(draft, 'castGuidance');
  const mine = isRecord(raw) ? raw : {};
  const out: Json = { v: CAST_GUIDANCE_VERSION };
  // A full copy reopened has no original to diff against, but still points at one.
  const basedOn = original !== undefined ? basedOnKey(original) : own(mine, 'basedOn');
  const print = original !== undefined ? fingerprint(original) : own(mine, 'basedOnFingerprint');
  if (typeof basedOn === 'string') out.basedOn = basedOn;
  if (typeof print === 'string') out.basedOnFingerprint = print;
  for (const key of OWN_GUIDANCE) {
    const v = own(mine, key);
    if (key === 'replace' ? v === true : Array.isArray(v) && v.length > 0) out[key] = v;
  }
  return Object.keys(out).length > 1 ? out : undefined;
}

/** A draft's own fields, for a new entry or a full copy. */
function fieldsOf(draft: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(draft))
    if (!NOT_WRITTEN.has(k) && v !== undefined) out[k] = v;
  return out;
}

/** What the Workshop stores for an entry (see the top of this file). */
export function writeEntry({ original, draft, source, mode }: WriteInput): Json {
  const head: Json = { name: String(draft.name ?? '').trim(), source };
  const guidance = guidanceFor(draft, original);
  const tail: Json = guidance !== undefined ? { castGuidance: guidance } : {};
  // A 2024 book's entry often says its edition only through the book; a copy is
  // printed in the player's book, so it says so itself.
  if (
    original !== undefined &&
    own(original, 'edition') === undefined &&
    original.bookEdition === 'one'
  ) {
    tail.edition = 'one';
  }
  if (original === undefined || mode === 'full') return { ...head, ...fieldsOf(draft), ...tail };

  const fields: Json = {};
  const mod: Json = {};
  const keys = new Set([...Object.keys(original), ...Object.keys(draft)]);
  for (const key of keys) {
    if (NOT_WRITTEN.has(key)) continue;
    const was = own(original, key);
    const now = own(draft, key);
    if (same(was, now)) continue;
    if (key === 'entries') {
      const diff = diffEntries(was, now);
      if ('ops' in diff) {
        if (diff.ops.length > 0) mod.entries = diff.ops;
        continue;
      }
    }
    // A copy cannot delete what it copies; null is how it says "none of this".
    fields[key] = now === undefined ? null : now;
  }
  const copy: Json = { name: original.name, source: original.source };
  if (Object.keys(mod).length > 0) copy._mod = mod;
  return { ...head, ...fields, _copy: copy, ...tail };
}

/**
 * What Changes to the books stores for a change to `original`, an entry of
 * `type` as the registry holds it (ADR-002, D2): changes only, under the
 * original's own identity, so the registry puts it in the original's place and
 * every character holding the original gets it, with no reference rewritten.
 *
 * - Its name is the original's whatever the draft says: a change keeps the
 *   identity of what it changes, or the sheets holding it would find another.
 * - For a type known by its parent too (`ENTRY_PARENT_KEYS`: a feature's class
 *   and level), those fields go on it and in its `_copy`, so a change to Rage
 *   is the Barbarian's Rage at level 1 and no other class's.
 * - Its guidance marks each field it changes as the original had it
 *   (`basedOnFields`), so an update under one of them sends it to Needs a look.
 * - It is printed in the original's book, so it carries no edition of its own
 *   where the original took one from its book: the registry gives it back.
 *
 * `original` is the entry below the change, never a change itself: to change
 * an entry already changed, pass the registry's `changeOf(e).base` with the
 * draft, so what is stored is still read against the entry below.
 */
export function writeChange(type: string, original: Json, draft: Json): Json {
  const out = writeEntry({ original, draft, source: String(original.source), mode: 'changes' });
  // The original's, untrimmed: a name is never one of the fields a change changes.
  out.name = original.name;
  if (own(original, 'edition') === undefined) delete out.edition;
  const copy = out._copy as Json;
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? (ENTRY_PARENT_KEYS[type] ?? []) : [];
  for (const key of parents) {
    const v = own(original, key);
    if (v === undefined) continue;
    out[key] = v;
    copy[key] = v;
  }
  const fields: Record<string, string> = {};
  for (const key of Object.keys(out)) {
    if (!NOT_WRITTEN.has(key) && !parents.includes(key)) fields[key] = fieldPrint(original, key);
  }
  const mod = own(copy, '_mod');
  if (isRecord(mod)) for (const key of Object.keys(mod)) fields[key] = fieldPrint(original, key);
  if (fieldPrint(original, 'castGuidance') !== fieldPrint(draft, 'castGuidance')) {
    fields.castGuidance = fieldPrint(original, 'castGuidance');
  }
  if (Object.keys(fields).length > 0) {
    const g = isRecord(out.castGuidance) ? out.castGuidance : { v: CAST_GUIDANCE_VERSION };
    out.castGuidance = { ...g, basedOnFields: fields };
  }
  return out;
}

/** What a stored entry copies, and whether it was saved as changes only. */
export function copiedFrom(
  stored: Json,
): { name: string; source: string; changesOnly: boolean } | undefined {
  const copy = own(stored, '_copy');
  if (isRecord(copy) && typeof copy.name === 'string' && typeof copy.source === 'string') {
    return { name: copy.name, source: copy.source, changesOnly: true };
  }
  const g = own(stored, 'castGuidance');
  const based = isRecord(g) ? own(g, 'basedOn') : undefined;
  if (typeof based !== 'string') return undefined;
  const [name, src] = based.split('|');
  return name && src ? { name, source: src, changesOnly: false } : undefined;
}

/**
 * A stored copy as the editor shows it: its original with its changes applied.
 * `lost` counts the changes that no longer fit the original (a paragraph it
 * replaced was reworded since), which the editor cannot show.
 */
export function readStored(stored: Json, original: Json): { entry: Json; lost: number } {
  const entry = structuredClone(stored);
  const warnings = resolveCopies([entry], () => structuredClone(original), 'Workshop');
  return { entry, lost: warnings.length };
}

export const resolveStored = (stored: Json, original: Json): Json =>
  readStored(stored, original).entry;

/** True when the original no longer matches what the copy was made from. */
export function originalChanged(stored: Json, original: Json): boolean {
  const g = own(stored, 'castGuidance');
  const print = isRecord(g) ? own(g, 'basedOnFingerprint') : undefined;
  return typeof print === 'string' && print !== fingerprint(original);
}

/** What the editor says when a copy's original is not in the player's data. */
export function missingOriginal(name: string): string {
  return `Based on ${name}, which your data does not have.`;
}

/** How many things a changes-only copy would store, for the Save bar's line. */
export function changeCount(original: Json, draft: Json): number {
  const out = writeEntry({ original, draft, source: '', mode: 'changes' });
  // The edition a copy of a 2024 entry carries is not the player's change.
  let n = Object.keys(out).filter((k) => !NOT_WRITTEN.has(k) && k !== 'edition').length;
  if (out.name !== original.name) n += 1;
  const mod = (out._copy as Json)._mod;
  const ops = isRecord(mod) && Array.isArray(mod.entries) ? (mod.entries as Json[]) : [];
  for (const op of ops) {
    const many = op.mode === 'removeArr' ? op.names : op.mode === 'appendArr' ? op.items : [op];
    n += Array.isArray(many) ? many.length : 1;
  }
  // What the player said about the sheet: effects, drops, prices on what it
  // inherits, leaving the original's mechanics out, moments. Each that differs
  // is one change.
  const said = (e: Json, key: string) => {
    const g = own(e, 'castGuidance');
    const v = isRecord(g) ? own(g, key) : undefined;
    return key === 'replace' ? v === true : Array.isArray(v) ? v : [];
  };
  for (const key of OWN_GUIDANCE) if (!same(said(original, key), said(draft, key))) n += 1;
  return n;
}
