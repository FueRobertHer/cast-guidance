import { useEffect, useState } from 'react';
import { useDataStatus } from '@/stores/dataStatus';
import type { EntityRegistry } from './normalize';
import type { PackId } from './packs';
import { ensureRegistry, getRegistry, registrySignature } from './registry';
import { ensureSearchIndex } from './search/client';

export type AsyncStatus = 'loading' | 'ready' | 'error';

export interface RegistryState {
  registry: EntityRegistry | null;
  status: AsyncStatus;
  error: string | null;
  /** Re-attempt after a failure (or force a refresh). */
  retry: () => void;
}

/**
 * Registry hook with explicit status (ERR-001): ensures the given packs,
 * returns the live registry, and refreshes as the background drain grows the
 * cached file set. A failure is captured as `status: 'error'` with a `retry`
 * instead of being swallowed into a permanent loading state.
 */
export function useRegistryState(packs: readonly PackId[] = []): RegistryState {
  const [registry, setRegistry] = useState<EntityRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const phase = useDataStatus((s) => s.phase);
  const filesDone = useDataStatus((s) => s.filesDone);
  const key = packs.join(',');

  // filesDone/phase retrigger a (signature-cached, cheap) registry check; nonce
  // is the manual retry trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for packs; phase/filesDone/nonce are refresh triggers
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const reg = packs.length > 0 ? await ensureRegistry([...packs]) : await getRegistry();
      if (alive) {
        setRegistry(reg);
        setError(null);
      }
    };
    run().catch((e: unknown) => {
      if (alive) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [key, phase, filesDone, nonce]);

  const status: AsyncStatus = error !== null ? 'error' : registry === null ? 'loading' : 'ready';
  return {
    registry,
    status,
    error,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}

/**
 * Convenience wrapper for callers that only need the registry (or null while it
 * loads / on error). New code that must surface errors should prefer
 * {@link useRegistryState}.
 */
export function useRegistry(packs: readonly PackId[] = []): EntityRegistry | null {
  return useRegistryState(packs).registry;
}

export type SearchStatus = 'idle' | 'building' | 'ready' | 'error';

export interface SearchState {
  status: SearchStatus;
  error: string | null;
  retry: () => void;
}

/**
 * Registry + global search readiness with explicit status (ERR-001). The index
 * is built off-thread and persisted; a failure surfaces as `status: 'error'`
 * with a `retry` rather than an indefinite "preparing" state.
 */
export function useSearchState(registry: EntityRegistry | null): SearchState {
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the manual retry trigger
  useEffect(() => {
    if (registry === null) {
      setStatus('idle');
      return;
    }
    let alive = true;
    setStatus('building');
    ensureSearchIndex(registry, registrySignature())
      .then(() => {
        if (alive) {
          setStatus('ready');
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [registry, nonce]);

  return {
    status,
    error,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}

/** Boolean convenience wrapper over {@link useSearchState}. */
export function useSearchReady(registry: EntityRegistry | null): boolean {
  return useSearchState(registry).status === 'ready';
}
