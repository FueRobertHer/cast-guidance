import Dexie from 'dexie';
import { type DbLifecycle, dbLifecycleStore } from '@/stores/dbLifecycle';

/** The `settings` row that names this copy of the database. */
export const DB_INSTANCE_KEY = 'dbInstance';

interface SettingRow {
  key: string;
  value: unknown;
}

/** The message a write gets once this tab has stopped using the database. */
const CLOSED_REASONS: Readonly<Record<Exclude<DbLifecycle, 'open'>, string>> = {
  deleted: 'The database was deleted under this tab',
  superseded: 'A newer version of the database is open in another tab',
  stale: 'The database is newer than this copy of the app',
};

function newInstanceId(): string {
  // `randomUUID` exists only in secure contexts; a plain-http dev server is not one.
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36)}`
  );
}

/**
 * What this tab does when another tab deletes or upgrades the database
 * (TEST-002).
 *
 * Live connection: Dexie fires `versionchange` subscribers newest first, and
 * its own one, registered in the constructor, closes with auto-open left on.
 * Left to run, that handler lets the next write reopen the database: after
 * another tab's "Reset app data" a pending character save would create the
 * database again and put the character back, and after another tab's upgrade
 * Dexie retries at the installed version, so older code would write into the
 * newer schema. So this handler closes with auto-open off (the default for
 * `close()`), which makes every later query reject with `DatabaseClosedError`,
 * records why for the banner, and returns `false` so Dexie's handler never
 * runs. It always closes: the other tab's delete or upgrade waits until every
 * open connection has gone.
 *
 * No connection: on a persisted `pagehide` Dexie closes every connection with
 * auto-open on, so a tab in the back/forward cache hears no `versionchange`
 * and reopens on its next write after Back. Every open is therefore checked
 * as well, before anything else may use it:
 * - a database at a newer version than this build knows was upgraded by
 *   newer code: `superseded` on a reopen, `stale` on this tab's first open,
 *   where it is this copy of the app that is old;
 * - a database this tab has to create, or one carrying a different instance
 *   id than the one this tab adopted, was deleted under it (another tab's
 *   reset, or the browser clearing storage), and may have been made afresh.
 *   A tab whose stamp never got written adopts whatever it finds instead.
 * Either way the open closes with auto-open off and fails, so the write that
 * caused it rejects with `DatabaseClosedError` and nothing lands.
 *
 * Installed once at module scope beside the database, not from a component,
 * so it covers writes that run outside the shell (the data loader's drain).
 * Returns an uninstall for tests.
 */
export function installDbLifecycle(database: Dexie, store = dbLifecycleStore): () => void {
  const closeFor = (state: Exclude<DbLifecycle, 'open'>): Error => {
    database.close();
    store.getState().markClosed(state);
    return new Dexie.DatabaseClosedError(CLOSED_REASONS[state]);
  };

  const onVersionChange = (event: IDBVersionChangeEvent): false => {
    // A delete reports no new version; an upgrade reports the one it opens.
    closeFor(event.newVersion ? 'superseded' : 'deleted');
    return false;
  };

  // Runs inside the upgrade that creates the database. A tab that has opened
  // it before is recreating one that was deleted under it: throwing aborts
  // that upgrade, so the deleted database is not brought back empty either.
  const onPopulate = (): void => {
    if (store.getState().instanceId === undefined) return;
    throw closeFor('deleted');
  };

  /**
   * Stamp `id` only if the row is still missing, in one read-write
   * transaction, so it never overwrites an id another tab wrote first.
   * Resolves to the id now stored, or null when the write failed (a full
   * device): a failed stamp must not keep the app from opening.
   */
  const stampIfMissing = async (vipDb: Dexie, id: string): Promise<string | null> => {
    const settings = vipDb.table<SettingRow, string>('settings');
    try {
      return await vipDb.transaction('rw', settings, async () => {
        const stored = (await settings.get(DB_INSTANCE_KEY))?.value;
        if (typeof stored === 'string') return stored;
        await settings.put({ key: DB_INSTANCE_KEY, value: id });
        return id;
      });
    } catch {
      return null;
    }
  };

  const onReady = async (vipDb: Dexie): Promise<void> => {
    const seen = store.getState().instanceId;
    // Dexie stores its version times ten. Newer data than this build knows:
    // on a reopen another tab upgraded it; on this tab's first open it is
    // this copy of the app that is old (stale HTML, or a rollback below a
    // schema bump). Either way old code must not write the newer shape.
    if (Math.floor(database.backendDB().version / 10) > database.verno) {
      throw closeFor(seen === undefined ? 'stale' : 'superseded');
    }
    if (seen === undefined || seen === null) {
      // First open, or every stamp so far failed: adopt whatever is stored,
      // or stamp one. A tab that never knew an id cannot tell a reset from
      // its own failed write, so it never calls this a delete.
      store.setState({ instanceId: await stampIfMissing(vipDb, newInstanceId()) });
      return;
    }
    const settings = vipDb.table<SettingRow, string>('settings');
    const stored = (await settings.get(DB_INSTANCE_KEY))?.value;
    if (stored === undefined) {
      // Not recreated (that stops in populate), so the row went some other
      // way. Put this tab's id back, or adopt the one another tab wrote first.
      const now = await stampIfMissing(vipDb, seen);
      if (now !== null) store.setState({ instanceId: now });
      return;
    }
    if (stored !== seen) throw closeFor('deleted');
  };

  database.on('versionchange', onVersionChange);
  database.on('populate', onPopulate);
  database.on('ready', onReady, true);
  return () => {
    database.on('versionchange').unsubscribe(onVersionChange);
    database.on('populate').unsubscribe(onPopulate);
    database.on('ready').unsubscribe(onReady);
  };
}
