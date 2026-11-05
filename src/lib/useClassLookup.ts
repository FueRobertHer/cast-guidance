import { useEffect, useState } from 'react';
import type { TypePacksState } from '@/data5e/hooks';
import { getSpellClassLookup, type SpellClassLookup } from '@/data5e/spellLookup';

const NO_LOOKUP: SpellClassLookup = {};

/**
 * The generated index of which spells each class can learn, read once for
 * every list that needs it, with somewhere for its failure to go.
 *
 * It is one essentials file, so it is normally on the device already, but the
 * read can still fail: the row went missing and the network is down, or
 * IndexedDB refused the read. That used to be a rejection nothing caught, and
 * the list said "Loading spell list…" for good. Until it is in hand it is read
 * again whenever the spell download's status moves, so the Retry on the spell
 * list's panel, the only one on screen until the spell files are in, retries
 * this too.
 */
export function useClassLookup(
  enabled: boolean,
  packsStatus: TypePacksState['status'],
): { lookup: SpellClassLookup | null; problem: TypePacksState } {
  const [lookup, setLookup] = useState<SpellClassLookup | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Read once: in hand, a later status change has nothing to fix.
  const settled = lookup !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `packsStatus` and `attempt` are what ask for a fresh read
  useEffect(() => {
    if (!enabled || settled) return;
    let alive = true;
    // Back to waiting while it is read again, as a retried download is.
    setFailure(null);
    getSpellClassLookup().then(
      (next) => {
        if (!alive) return;
        setLookup(next);
        setFailure(null);
      },
      (e: unknown) => {
        if (!alive) return;
        setFailure(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, settled, packsStatus, attempt]);
  return {
    // Failed, the lists fall back to the homebrew spells, which carry their
    // classes inline, rather than to a list that never arrives.
    lookup: lookup ?? (failure !== null ? NO_LOOKUP : null),
    problem: {
      status: failure !== null ? 'error' : lookup !== null ? 'ready' : 'loading',
      error: failure,
      // Never "offline": the read is normally local, so a failure is this
      // device's storage far more often than the network, and the panel is
      // given words that say so instead.
      offline: false,
      retry: () => setAttempt((n) => n + 1),
      repair: () => undefined,
    },
  };
}
