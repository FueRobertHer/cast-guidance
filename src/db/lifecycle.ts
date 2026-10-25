import Dexie from 'dexie';
import { type DbLifecycle, dbLifecycleStore } from '@/stores/dbLifecycle';

/** The `settings` row that names this copy of the database. */
export const DB_INSTANCE_KEY = 'dbInstance';

interface SettingRow {
  key: string;
  value: unknown;
}

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
 *   newer code (or this build is stale);
 * - a database this tab has to create, or one carrying a different instance
 *   id than the one this tab saw on its first open, was deleted by another
 *   tab, which may have made a fresh one since.
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
    return new Dexie.DatabaseClosedError(
      state === 'deleted'
        ? 'The database was deleted in another tab'
        : 'A newer version of the database is open in another tab',
    );
  };

  const onVersionChange = (event: IDBVersionChangeEvent): false => {
    // A delete reports no new version; an upgrade reports the one it opens.
    closeFor(event.newVersion ? 'superseded' : 'deleted');
    return false;
  };

  // Runs inside the upgrade that creates the database. A tab that has opened
  // it before is recreating one another tab deleted: throwing aborts that
  // upgrade, so the deleted database is not brought back empty either.
  const onPopulate = (): void => {
    if (store.getState().instanceId === undefined) return;
    throw closeFor('deleted');
  };

  const onReady = async (vipDb: Dexie): Promise<void> => {
    // Dexie stores its version times ten.
    if (Math.floor(database.backendDB().version / 10) > database.verno) {
      throw closeFor('superseded');
    }
    const settings = vipDb.table<SettingRow, string>('settings');
    const seen = store.getState().instanceId;
    if (seen === undefined) {
      // First open in this tab: adopt the stored id, or stamp one. Read and
      // written in one transaction so two tabs booting together agree.
      let id: string | undefined;
      try {
        id = await vipDb.transaction('rw', settings, async () => {
          const stored = (await settings.get(DB_INSTANCE_KEY))?.value;
          if (typeof stored === 'string') return stored;
          const fresh = newInstanceId();
          await settings.put({ key: DB_INSTANCE_KEY, value: fresh });
          return fresh;
        });
      } catch {
        // A full device must not keep the app from opening. Without a stored
        // id a later reopen restores this one (below), so the check still works.
        id = newInstanceId();
      }
      store.setState({ instanceId: id });
      return;
    }
    const stored = (await settings.get(DB_INSTANCE_KEY))?.value;
    if (stored === undefined) {
      // The database was not recreated (that would have stopped in populate),
      // so the row was lost some other way, such as a failed first stamp.
      await settings.put({ key: DB_INSTANCE_KEY, value: seen }).catch(() => undefined);
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
