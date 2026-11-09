/**
 * The list of described effects a character keeps (`CharacterDoc.keptEffects`),
 * changed in place by name. Small and apart from the builder, since the sheet
 * writes it and the builder loads in a chunk of its own.
 */
import type { KeptEffect } from '@/engine/types';

const stored = (list: unknown): unknown[] => (Array.isArray(list) ? list : []);

const named = (k: unknown, name: string) =>
  k !== null &&
  typeof k === 'object' &&
  typeof (k as { name?: unknown }).name === 'string' &&
  (k as { name: string }).name.toLowerCase() === name;

/**
 * The list with this one kept, in place of one of its name. Every other entry
 * stays as stored, even one this version cannot read.
 */
export function keepOn(list: unknown, kept: KeptEffect): KeptEffect[] {
  const name = kept.name.toLowerCase();
  return [...(stored(list).filter((k) => !named(k, name)) as KeptEffect[]), kept];
}

/** The list without the one of this id, or nothing when none is left. */
export function forget(list: unknown, id: string): KeptEffect[] | undefined {
  const left = stored(list).filter(
    (k) => k === null || typeof k !== 'object' || (k as { id?: unknown }).id !== id,
  ) as KeptEffect[];
  return left.length > 0 ? left : undefined;
}
