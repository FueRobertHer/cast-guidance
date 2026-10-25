import type Dexie from 'dexie';
import { dbLifecycleStore } from '@/stores/dbLifecycle';

/**
 * What this tab does when another tab deletes or upgrades the database
 * (TEST-002).
 *
 * Dexie fires `versionchange` subscribers newest first, and its own one,
 * registered in the constructor, closes with auto-open left on. Left to run,
 * that handler lets the next write reopen the database: after another tab's
 * "Reset app data" a pending character save would create the database again
 * and put the character back, and after another tab's upgrade Dexie retries
 * at the installed version, so older code would write into the newer schema.
 *
 * So this handler closes with auto-open off (the default for `close()`),
 * which makes every later query reject with `DatabaseClosedError`, records
 * why for the banner, and returns `false` so Dexie's handler never runs. It
 * always closes: the other tab's delete or upgrade waits until every open
 * connection has gone.
 *
 * Installed once at module scope beside the database, not from a component,
 * so it covers writes that run outside the shell (the data loader's drain).
 * Returns an uninstall for tests.
 */
export function installDbLifecycle(database: Dexie, store = dbLifecycleStore): () => void {
  const onVersionChange = (event: IDBVersionChangeEvent): false => {
    database.close();
    // A delete reports no new version; an upgrade reports the one it opens.
    store.getState().markClosed(event.newVersion ? 'superseded' : 'deleted');
    return false;
  };
  database.on('versionchange', onVersionChange);
  return () => database.on('versionchange').unsubscribe(onVersionChange);
}
