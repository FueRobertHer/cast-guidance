import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useRegistry } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { getRegistry } from '@/data5e/registry';
import { type HomebrewFileMeta, homebrewRepo } from '@/db/homebrewRepo';

/** The registry as a screen of the stored files reads it, and the rows it was read for. */
export interface RegistryRead {
  /** The last read of this screen's own, else the shared registry; null while there is neither. */
  registry: EntityRegistry | null;
  /**
   * The stored rows `registry` was read for: its own read's, else the rows as
   * they are now. Undefined until the rows are read.
   */
  rows: readonly HomebrewFileMeta[] | undefined;
  /** Whether its own read is in, or has failed. Before that `registry` is the shared one. */
  ready: boolean;
  /** Whether its last read failed. `registry` is then the last one that did not. */
  failed: boolean;
}

/** What a stored row changes in the registry: its id, its switch, its content and a pack's Apply to and place. */
const keyOf = (rows: readonly HomebrewFileMeta[]) =>
  JSON.stringify(rows.map((r) => [r.id, r.enabled, r.rev ?? 0, r.pack ?? null]));

/**
 * The registry, read again for this screen each time the stored files change.
 *
 * A file turned on or off, deleted, updated, or a pack applied or moved,
 * changes the registry with no download, and a mounted `useRegistry` hears of
 * none of it (`invalidateRegistry` tells no one, and a change made in another
 * tab does not even invalidate this one's). So this reads the registry once
 * the rows are known, again on each change there and on each new shared read
 * (a download landing), the last read started winning: a read begun before a
 * change never has the last word. Each read keeps the rows it was started
 * for, so a screen comparing the registry with the rows (which sources are a
 * collection's) never reads one from before a change against the other from
 * after it.
 *
 * Until its first read is settled, it gives the shared registry but is not
 * ready, since that one may have been read before a change. A read that fails
 * leaves the last one standing and counts as settled, rather than Loading for
 * good.
 */
export function useRegistryRead(): RegistryRead {
  const shared = useRegistry();
  const rows = useLiveQuery(async () => (await homebrewRepo.listMetaSafe()).files, []);
  const key = rows === undefined ? undefined : keyOf(rows);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const latest = useRef(0);
  const [own, setOwn] = useState<{ registry: EntityRegistry; rows: readonly HomebrewFileMeta[] }>();
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows stand in by their key; a new shared registry is a trigger, read again so an older read never wins
  useEffect(() => {
    const at = rowsNow.current;
    if (key === undefined || at === undefined) return;
    latest.current += 1;
    const read = latest.current;
    getRegistry().then(
      (registry) => {
        if (read !== latest.current) return;
        setOwn({ registry, rows: at });
        setFailed(false);
      },
      () => {
        if (read === latest.current) setFailed(true);
      },
    );
  }, [key, shared]);
  return {
    registry: own?.registry ?? shared,
    rows: own?.rows ?? rows,
    ready: own !== undefined || failed,
    failed,
  };
}
