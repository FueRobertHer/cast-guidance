/**
 * Class spell lists via the generated lookup:
 *   lookup[spellSourceLower][spellNameLower] = {
 *     class: { CLASS_SOURCE: { ClassName: true } }, subclass: {...}
 *   }
 */
import { getFile } from './loader';

export type SpellClassLookup = Record<string, Record<string, unknown>>;

export async function getSpellClassLookup(): Promise<SpellClassLookup> {
  const json = await getFile('generated/gendata-spell-source-lookup.json');
  return (json ?? {}) as SpellClassLookup;
}

/** Spell uids ("name|source", lowercased) on a class's list (any class source). */
export function classSpellUids(lookup: SpellClassLookup, className: string): Set<string> {
  const out = new Set<string>();
  const target = className.toLowerCase();
  for (const [spellSource, spells] of Object.entries(lookup)) {
    if (typeof spells !== 'object' || spells === null) continue;
    for (const [spellName, entry] of Object.entries(spells)) {
      const classes = (entry as { class?: Record<string, Record<string, unknown>> }).class;
      if (classes === undefined) continue;
      for (const bySource of Object.values(classes)) {
        if (typeof bySource !== 'object' || bySource === null) continue;
        for (const name of Object.keys(bySource)) {
          if (name.toLowerCase() === target) {
            out.add(`${spellName}|${spellSource}`);
          }
        }
      }
    }
  }
  return out;
}
