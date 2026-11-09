import type { DataEntity, EntityRef } from '../types';

/**
 * The class a class is a reskin of, from the data's `reskinOf` (`Fighter|XPHB`
 * on the World of Warcraft Warrior), or undefined for any other class. A reskin
 * takes that class's features as printed, so a curated row or a level written
 * for the one is the other's too. A ref with no source is the PHB's, as the
 * data writes refs.
 */
export function reskinOf(cls: DataEntity | undefined): EntityRef | undefined {
  const refs = cls?.reskinOf;
  const first = Array.isArray(refs) ? refs[0] : undefined;
  if (typeof first !== 'string') return undefined;
  const [name, source] = first.split('|');
  if (name === undefined || name.trim() === '') return undefined;
  return { name: name.trim(), source: source?.trim() || 'PHB' };
}
