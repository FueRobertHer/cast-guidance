import { entityLookup } from '@/data5e/engineAdapter';
import { useRegistry, useRegistryRefreshing, useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { pickForVersion, type RulesVersion } from '@/data5e/rulesVersion';
import type { ChargeLookup } from '@/engine/curated/itemCharges';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';

/**
 * Look a spell up by its stored printing; when that misses (blank/wrong source
 * on a granted spell) fall back to the printing matching the character's rules
 * version, so a 2024 sheet shows 2024 text.
 */
export function findSpell(
  registry: EntityRegistry | null,
  name: string,
  source: string,
  version: RulesVersion,
) {
  if (registry === null) return undefined;
  const bySource = source !== '' ? registry.get('spell', name, source) : undefined;
  if (bySource !== undefined) return bySource;
  const cands = registry
    .byType('spell')
    .filter((e) => String(e.name).toLowerCase() === name.toLowerCase());
  return pickForVersion(cands, version);
}

/**
 * Granted spells for a list that only names them. One origin can give a spell a
 * row for its slots and a row for its free uses, which matter to a list of what
 * can be cast but read here as the same spell twice. The slots row comes first,
 * so it is the one kept, and the line still says "always prepared".
 */
export function distinctGrants(grants: DerivedSheet['grantedSpells']) {
  const seen = new Set<string>();
  return grants.filter((g) => {
    const key = `${g.name}|${g.source}|${g.origin}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** No registry yet: nothing to look up, and one object for every render. */
const NOTHING: readonly never[] = [];
const NO_ENTITIES: ChargeLookup = { get: () => undefined, byType: () => NOTHING };

/**
 * The spell files, for a page that lists this character's own spells.
 * `entities` is the registry's lookups, one object per registry, which say
 * what a carried item's charges cast (`SpellCast.entities`) and what a long
 * rest gives back to an item put away (`idleChargePools`). Asks for
 * them only when one is missing: every other page that needs spell files asks
 * for them itself, and this one must not rely on the boot drain having finished.
 * `spellsSettling` says a spell with no entry may yet get one, so its row waits
 * rather than guesses.
 */
export function useSpellData(sheet: DerivedSheet | null, doc: CharacterDoc | null) {
  const registry = useRegistry();
  const spellsMissing =
    sheet !== null &&
    doc !== null &&
    registry !== null &&
    [
      ...sheet.spellcasting.flatMap((sc) => {
        const state = doc.spellcasting[sc.classUid];
        return [...(state?.known ?? []), ...(state?.prepared ?? [])];
      }),
      ...sheet.grantedSpells,
    ].some((s) => findSpell(registry, s.name, s.source, doc.rulesVersion) === undefined);
  const spellPacks = useTypePacks(spellsMissing ? 'spell' : undefined);
  const registryRefreshing = useRegistryRefreshing();
  return {
    registry,
    entities: registry === null ? NO_ENTITIES : entityLookup(registry),
    spellsMissing,
    spellPacks,
    spellsSettling: registry === null || spellPacks.status !== 'ready' || registryRefreshing,
  };
}
