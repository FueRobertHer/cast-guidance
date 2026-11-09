import type { DataEntity, EntityRef } from '../types';

/** The first `name|source` ref in a list of them. A ref with no source is the PHB's, as the data writes refs. */
function firstRef(refs: unknown): EntityRef | undefined {
  const first = Array.isArray(refs) ? refs[0] : undefined;
  if (typeof first !== 'string') return undefined;
  const [name, source] = first.split('|');
  if (name === undefined || name.trim() === '') return undefined;
  return { name: name.trim(), source: source?.trim() || 'PHB' };
}

/**
 * The class a class is a reskin of, from the data's `reskinOf` (`Fighter|XPHB`
 * on the World of Warcraft Warrior), or undefined for any other class. A reskin
 * takes that class's features as printed, so a curated row or a level written
 * for the one is the other's too.
 */
export function reskinOf(cls: DataEntity | undefined): EntityRef | undefined {
  return firstRef(cls?.reskinOf);
}

/**
 * The official entry an entry prints, from its `printingOf` (`Alert|XPHB`):
 * a file converted from another app carries an official entry's text under a
 * book of its own, and says which entry it is. A curated row, spend link or
 * pick written for the official entry is the copy's too.
 */
export function printingOf(e: DataEntity | undefined): EntityRef | undefined {
  return firstRef(e?.printingOf);
}

/**
 * The keys a table keyed by `name|source` holds an entry under: its own uid,
 * then the uid of the official entry it prints, when that is another.
 */
export function tableUids(e: DataEntity | undefined, uid: string): string[] {
  const printed = printingOf(e);
  if (printed === undefined) return [uid];
  const official = `${printed.name}|${printed.source}`.toLowerCase();
  return official === uid ? [uid] : [uid, official];
}
