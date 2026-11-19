import { useMemo } from 'react';
import type { EntityRegistry } from '@/data5e/normalize';
import { conditionEntries, type Edition } from '@/engine/conditions';

/**
 * Finds a homebrew condition's entry by name, in the character's edition, for
 * `hpLimits`: so a condition that moves the hit point maximum moves current HP
 * with it, from the strip or from a moment (H9). It reads the registry the
 * page already holds. The data is read the first time a condition is looked
 * up, which only a homebrew condition in play, or one coming on, asks for.
 */
export function useConditionEntry(
  registry: EntityRegistry | null,
  edition: Edition,
): (name: string) => unknown {
  return useMemo(() => {
    let find: ((name: string) => unknown) | undefined;
    return (name: string) => {
      if (registry === null) return undefined;
      find ??= conditionEntries(registry.byType('condition'), edition);
      return find(name);
    };
  }, [registry, edition]);
}
