import { useEffect, useMemo, useState } from 'react';
import { engineContextFor } from '@/data5e/engineAdapter';
import type { AsyncStatus, TypePacksState } from '@/data5e/hooks';
import { ensureCharacterPacks } from '@/data5e/loader';
import type { EntityRegistry } from '@/data5e/normalize';
import { getRegistry } from '@/data5e/registry';
import { hasMissingData, missingCharacterData } from '@/engine/dataNeeds';
import type { CharacterDoc } from '@/engine/types';

export interface CharacterDataState {
  /** `ready` when deriving now gives the numbers it will go on giving. */
  status: AsyncStatus;
  error: string | null;
  retry: () => void;
  /**
   * Set when equipped gear could not be downloaded. Unlike a class file that
   * only costs the AC and attacks those items would add, so the sheet is still
   * worth drawing, and this is the line that says what it leaves out.
   */
  equipment?: Pick<TypePacksState, 'status' | 'error' | 'offline' | 'retry'>;
}

interface Attempt {
  key: string;
  error: string | null;
  offline: boolean;
  /** No file holds it: read against a registry of everything on disk, it is still missing. */
  exhausted: boolean;
}

/**
 * Whether the files a character's numbers are read from have arrived, fetching
 * them if not. See {@link missingCharacterData} for why deriving first is not
 * an option: nothing about the result would look wrong, and a long rest or a
 * heal could then save it.
 *
 * Something still missing once its pack is on disk is not coming (a homebrew
 * class whose file was removed, say). That derives as it always has, with the
 * engine's warning, rather than leaving the character unopenable.
 */
export function useCharacterData(
  doc: CharacterDoc | null,
  registry: EntityRegistry | null,
  /** Moves when `doc` is edited in place. */
  rev: unknown,
): CharacterDataState {
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev tracks doc mutations
  const needs = useMemo(
    () =>
      doc !== null && registry !== null
        ? missingCharacterData(doc, engineContextFor(registry))
        : undefined,
    [doc, registry, rev],
  );
  const key = needs !== undefined && hasMissingData(needs) ? JSON.stringify(needs) : undefined;
  const [attempt, setAttempt] = useState<Attempt>();
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for needs and doc; nonce is the manual retry trigger
  useEffect(() => {
    if (key === undefined || needs === undefined || doc === null) return;
    let alive = true;
    ensureCharacterPacks(needs)
      // Read fresh rather than waiting for the caller's registry to catch up: a
      // pack that just landed and a file nobody has look the same from there.
      .then(() => getRegistry())
      .then((fresh) => {
        if (!alive) return;
        const still = missingCharacterData(doc, engineContextFor(fresh));
        setAttempt({ key, error: null, offline: false, exhausted: JSON.stringify(still) === key });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setAttempt({
          key,
          error: e instanceof Error ? e.message : String(e),
          // Read at the moment of failure, as `useTypePacks` does.
          offline: typeof navigator !== 'undefined' && navigator.onLine === false,
          exhausted: false,
        });
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const needsClasses = (needs?.classes.length ?? 0) > 0;
  const retry = () => {
    // A blocked sheet goes back to waiting. One already drawn stays up, since
    // the retry can only add to it.
    if (needsClasses) setAttempt(undefined);
    setNonce((n) => n + 1);
  };

  if (key === undefined) return { status: 'ready', error: null, retry };
  if (attempt?.key !== key) return { status: 'loading', error: null, retry };
  if (attempt.error !== null) {
    if (needsClasses) return { status: 'error', error: attempt.error, retry };
    return {
      status: 'ready',
      error: null,
      retry,
      equipment: { status: 'error', error: attempt.error, offline: attempt.offline, retry },
    };
  }
  // Not exhausted means the file did arrive, and the caller's registry moves to
  // it as soon as the landing is flushed.
  return { status: attempt.exhausted ? 'ready' : 'loading', error: null, retry };
}
