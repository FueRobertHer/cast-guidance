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

/**
 * Spell uids on a subclass caster's list (the Eldritch Knight's), any source:
 * `subclass[CLASS_SOURCE][ClassName][SUBCLASS_SOURCE][SubclassShortName]`.
 */
export function subclassSpellUids(
  lookup: SpellClassLookup,
  className: string,
  shortName: string,
): Set<string> {
  const out = new Set<string>();
  const targetClass = className.toLowerCase();
  const targetSub = shortName.toLowerCase();
  for (const [spellSource, spells] of Object.entries(lookup)) {
    if (typeof spells !== 'object' || spells === null) continue;
    for (const [spellName, entry] of Object.entries(spells)) {
      const subs = (entry as { subclass?: Record<string, Record<string, unknown>> }).subclass;
      if (subs === undefined) continue;
      const listed = Object.values(subs).some(
        (byClass) =>
          typeof byClass === 'object' &&
          byClass !== null &&
          Object.entries(byClass).some(
            ([name, bySource]) =>
              name.toLowerCase() === targetClass &&
              typeof bySource === 'object' &&
              bySource !== null &&
              Object.values(bySource).some(
                (byShort) =>
                  typeof byShort === 'object' &&
                  byShort !== null &&
                  Object.keys(byShort).some((s) => s.toLowerCase() === targetSub),
              ),
          ),
      );
      if (listed) out.add(`${spellName}|${spellSource}`);
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
