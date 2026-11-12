import type { EngineContext } from '@/engine/types';
import { type AppTableRules, appTableRules } from '@/stores/tableRules';
import type { EntityRegistry, EntityType } from './normalize';

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
    get: (type, name, source) => registry.get(type as EntityType, name, source),
    byType: (type) => registry.byType(type as EntityType),
    rules,
    ...(registry.ruleSetsFailed ? { ruleSetsFailed: true } : {}),
  };
}
