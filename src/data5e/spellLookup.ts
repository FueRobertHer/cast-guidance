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

/**
 * Homebrew spells declare their lists inline:
 * `classes: { fromClassList: [{ name: "Wizard", source: "PHB" }] }`.
 */
export function classSpellUidsFromEntities(
  spells: readonly Record<string, unknown>[],
  className: string,
): Set<string> {
  const out = new Set<string>();
  const target = className.toLowerCase();
  for (const s of spells) {
    const classes = s.classes as { fromClassList?: Array<{ name?: string }> } | undefined;
    const list = classes?.fromClassList;
    if (!Array.isArray(list)) continue;
    if (list.some((c) => String(c?.name ?? '').toLowerCase() === target)) {
      out.add(`${String(s.name)}|${String(s.source)}`.toLowerCase());
    }
  }
  return out;
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
