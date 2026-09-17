import { useEffect, useState } from 'react';
import { useDataStatus } from '@/stores/dataStatus';
import { ensureTypePacks, repairTypePacks } from './loader';
import type { EntityRegistry } from './normalize';
import type { PackId } from './packs';
import { ensureRegistry, getRegistry, registrySignature } from './registry';
import { ensureSearchIndex, onSearchIndexLost } from './search/client';

export type AsyncStatus = 'loading' | 'ready' | 'error';

export interface RegistryState {
  registry: EntityRegistry | null;
  status: AsyncStatus;
  error: string | null;
  /**
   * A registry is in hand and a newer one is being built. The registry
   * rebuilds as downloads land, so there is a window where the one a caller
   * holds is real but older than the files on disk. A page that reads
   * "nothing here" from it during that window is reading a stale answer, not
   * a final one.
   */
  refreshing: boolean;
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
  const [refreshing, setRefreshing] = useState(true);
  const [nonce, setNonce] = useState(0);
  const phase = useDataStatus((s) => s.phase);
  const filesDone = useDataStatus((s) => s.filesDone);
  const key = packs.join(',');

  // filesDone/phase retrigger a registry check; nonce is the manual retry
  // trigger. Deliberately NOT triggered on pack readiness: files only reach
  // IndexedDB via a fetch that already ticks filesDone, so a pack flipping to
  // 'ready' adds nothing to read, while every extra run costs a full
  // filesByTag() deserialization of the whole cached compendium.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for packs; phase/filesDone/nonce are refresh triggers
  useEffect(() => {
    let alive = true;
    setRefreshing(true);
    const run = async () => {
      const reg = packs.length > 0 ? await ensureRegistry([...packs]) : await getRegistry();
      if (alive) {
        setRegistry(reg);
        setError(null);
      }
    };
    run()
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [key, phase, filesDone, nonce]);

  // A registry already in hand outranks a failed refresh: the pages reading it
  // are still correct, and replacing a working screen with an error because a
  // later rebuild failed loses more than it reports.
  const status: AsyncStatus = registry !== null ? 'ready' : error !== null ? 'error' : 'loading';
  return {
    registry,
    status,
    error,
    refreshing,
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

  // A worker that dies after the index is ready leaves nothing to fail: the
  // build already resolved, so without this the box keeps offering to search
  // and answers every query with nothing. Dropping to `error` is what puts the
  // retry that rebuilds it back in front of the user.
  useEffect(
    () =>
      onSearchIndexLost(() => {
        setStatus('error');
        setError('the search index was lost');
      }),
    [],
  );

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

export interface TypePacksState {
  status: AsyncStatus;
  error: string | null;
  /**
   * True when the failure is the device being offline. The distinction is the
   * whole message: a download that cannot start because there is no network is
   * not broken, and telling someone to retry is worse than telling them why.
   */
  offline: boolean;
  /** Download the missing files again. */
  retry: () => void;
  /** Throw this type's cached files away and download them again. */
  repair: () => void;
}

/**
 * The packs behind one entity type, with somewhere for the failure to go
 * (ERR-001).
 *
 * The library used to start this download with a bare `void ensureTypePacks()`
 * inside an effect. A rejected promise had nowhere to land, so a section whose
 * files never arrived looked exactly like one whose entity does not exist:
 * "Not found", no reason, and nothing to press. The pack also stays
 * `downloading` in the status store when its fetch throws, so the app went on
 * reporting a download that had already failed.
 */
export function useTypePacks(type: string | undefined): TypePacksState {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /**
   * The attempt to run, and what kind. Carrying the kind here rather than in a
   * flag of its own is what keeps a repair attached to the type it was asked
   * for: a separate flag stayed set when the user navigated away mid-repair
   * (its reset is in the settle handler, which the unmounted run skips), so
   * the next section the user opened was re-downloaded without being asked.
   */
  const [attempt, setAttempt] = useState<{ n: number; repair: boolean; for?: string }>({
    n: 0,
    repair: false,
  });

  useEffect(() => {
    if (type === undefined) {
      setStatus('ready');
      setError(null);
      setOffline(false);
      return;
    }
    let alive = true;
    setStatus('loading');
    const repair = attempt.repair && attempt.for === type;
    const run = repair ? repairTypePacks(type) : ensureTypePacks(type);
    run
      .then(() => {
        if (!alive) return;
        setStatus('ready');
        setError(null);
        setOffline(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
        // Read at the moment of failure, not at render: a device that came back
        // online since would otherwise still be told it is offline.
        setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
      });
    return () => {
      alive = false;
    };
  }, [type, attempt]);

  const again = (repair: boolean) => {
    setError(null);
    setAttempt((a) => ({ n: a.n + 1, repair, for: type }));
  };

  return {
    status,
    error,
    offline,
    retry: () => {
      again(false);
    },
    repair: () => {
      again(true);
    },
  };
}
