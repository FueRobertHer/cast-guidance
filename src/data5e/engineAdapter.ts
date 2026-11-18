import type { EngineContext } from '@/engine/types';
import { type AppTableRules, appTableRules } from '@/stores/tableRules';
import type { EntityRegistry, EntityType } from './normalize';

const LOOKUPS = new WeakMap<EntityRegistry, Pick<EngineContext, 'get' | 'byType'>>();

/**
 * The registry as the engine's lookups alone, one object per registry, for
 * what reads it outside a derive (an item's charges, `itemChargesOf`).
 */
export function entityLookup(registry: EntityRegistry): Pick<EngineContext, 'get' | 'byType'> {
  const known = LOOKUPS.get(registry);
  if (known !== undefined) return known;
  const lookup: Pick<EngineContext, 'get' | 'byType'> = {
    get: (type, name, source) => registry.get(type as EntityType, name, source),
    byType: (type) => registry.byType(type as EntityType),
  };
  LOOKUPS.set(registry, lookup);
  return lookup;
}

/**
 * Wrap the registry as the engine's minimal lookup surface, with the app's
 * table rules (Settings) as they are now, unless `rules` are given. The
 * registry's built-in rule sets come along (`byType(RULE_SET_TYPE)`).
 */
export function engineContextFor(
  registry: EntityRegistry,
  rules: AppTableRules = appTableRules(),
): EngineContext {
  return {
    ...entityLookup(registry),
    rules,
    ...(registry.ruleSetsFailed ? { ruleSetsFailed: true } : {}),
  };
}
