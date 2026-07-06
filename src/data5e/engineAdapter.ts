import type { EngineContext } from '@/engine/types';
import type { EntityRegistry, EntityType } from './normalize';

/** Wrap the registry as the engine's minimal lookup surface. */
export function engineContextFor(registry: EntityRegistry): EngineContext {
  return {
    get: (type, name, source) => registry.get(type as EntityType, name, source),
    byType: (type) => registry.byType(type as EntityType),
  };
}
