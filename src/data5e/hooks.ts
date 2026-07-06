import { useEffect, useState } from 'react';
import { useDataStatus } from '@/stores/dataStatus';
import type { EntityRegistry } from './normalize';
import type { PackId } from './packs';
import { ensureRegistry, getRegistry, registrySignature } from './registry';
import { ensureSearchIndex } from './search/client';

/**
 * Registry hook: ensures the given packs, returns the live registry, and
 * refreshes as the background drain grows the cached file set.
 */
export function useRegistry(packs: readonly PackId[] = []): EntityRegistry | null {
  const [registry, setRegistry] = useState<EntityRegistry | null>(null);
  const phase = useDataStatus((s) => s.phase);
  const filesDone = useDataStatus((s) => s.filesDone);
  const key = packs.join(',');

  // filesDone/phase retrigger a (signature-cached, cheap) registry check.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for packs; phase/filesDone are refresh triggers
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const reg = packs.length > 0 ? await ensureRegistry([...packs]) : await getRegistry();
      if (alive) setRegistry(reg);
    };
    void run().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, phase, filesDone]);

  return registry;
}

/** Registry + global search readiness (index built off-thread, persisted). */
export function useSearchReady(registry: EntityRegistry | null): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (registry === null) return;
    let alive = true;
    void ensureSearchIndex(registry, registrySignature())
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [registry]);
  return ready;
}
