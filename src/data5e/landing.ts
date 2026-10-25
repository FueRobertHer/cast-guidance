/**
 * When the registry should look at the cache again (DATA-003).
 *
 * Every file a download writes into the active release used to restart every
 * mounted registry hook, and each of those rebuilt the registry (every cached
 * body read and normalized on the main thread) and then the search index
 * behind it. A background drain lands hundreds of files, so a cold install
 * paid for hundreds of full rebuilds, and the library's readiness flickered
 * with every one of them.
 *
 * This keeps two counters instead. `landedCount` moves with every file
 * written, at once, so anything reporting whether the registry is current can
 * say it is not. `revision` is what consumers rebuild on, and it only catches
 * up with `landedCount` when the landings are flushed: by a timer during a
 * drain, or at once at the points something is waiting on the data (essentials
 * in, the drain finished or failed, a page's packs ensured). A drain of any
 * size therefore costs about one rebuild per {@link LANDING_FLUSH_MS}, plus one
 * per such point.
 *
 * No React here, and nothing from the rest of the data layer, so both the
 * loader (which reports landings) and the registry (which reads them) can
 * import it without a cycle.
 */
import { LANDING_FLUSH_MS } from './config';

let landedCount = 0;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const landedListeners = new Set<() => void>();
const revisionListeners = new Set<() => void>();

/**
 * Tell each listener, isolated from the others. A listener that throws must
 * not keep the rest from hearing about it, nor leave the counter it was told
 * about unreported; logged rather than swallowed, for the same reason as the
 * registry's refresh flag.
 */
function notify(listeners: ReadonlySet<() => void>): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      console.error('a data landing subscriber threw', err);
    }
  }
}

/**
 * A file was written into the active release's cache. Called after the write
 * has committed, so any read that sees this count also sees the row.
 */
export function noteFileLanded(): void {
  landedCount++;
  notify(landedListeners);
  timer ??= setTimeout(flushLanded, LANDING_FLUSH_MS);
}

/**
 * Hand everything landed so far to the consumers now, rather than when the
 * timer gets round to it. Does nothing when nothing is waiting, so a caller
 * can flush whenever it reaches a point worth reporting without checking.
 */
export function flushLanded(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (revision >= landedCount) return;
  revision = landedCount;
  notify(revisionListeners);
}

/**
 * The data changed as a whole (a release installed, or one rolled back), so
 * every consumer should read again now. Counted as a landing as well, so the
 * registry reports itself behind until they have.
 */
export function markDataChanged(): void {
  landedCount++;
  notify(landedListeners);
  flushLanded();
}

/** What consumers have been told to rebuild on. Moves only on a flush. */
export function getRevision(): number {
  return revision;
}

/** Every landing so far, flushed or not. */
export function getLandedCount(): number {
  return landedCount;
}

/** Hear about {@link getRevision} moving. Returns the unsubscribe. */
export function subscribeRevision(fn: () => void): () => void {
  revisionListeners.add(fn);
  return () => {
    revisionListeners.delete(fn);
  };
}

/** Hear about every landing, flushed or not. Returns the unsubscribe. */
export function subscribeLanded(fn: () => void): () => void {
  landedListeners.add(fn);
  return () => {
    landedListeners.delete(fn);
  };
}
