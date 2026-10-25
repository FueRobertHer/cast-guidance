import type { Page } from '@playwright/test';

/**
 * Raw IndexedDB reads of the app's Dexie database. The database is opened with
 * no version, so these never depend on (or bump) the schema; if it does not
 * exist yet, the open is aborted rather than creating an empty one Dexie
 * would then have to upgrade.
 */
interface Query {
  store: string;
  kind: 'get' | 'getAll' | 'count';
  key?: string | number;
  index?: string;
}

async function query<T>(page: Page, q: Query): Promise<T> {
  const result: unknown = await page.evaluate(
    ({ store, kind, key, index }) =>
      new Promise<unknown>((resolve, reject) => {
        const empty = kind === 'count' ? 0 : kind === 'getAll' ? [] : undefined;
        const open = indexedDB.open('cast-guidance');
        open.onupgradeneeded = () => {
          open.transaction?.abort();
          resolve(empty);
        };
        open.onerror = () => {
          // The abort above lands here too; it has already resolved.
          if (open.error?.name !== 'AbortError') reject(open.error);
        };
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve(empty);
            return;
          }
          const tx = db.transaction(store, 'readonly');
          const source =
            index === undefined ? tx.objectStore(store) : tx.objectStore(store).index(index);
          const req =
            kind === 'get'
              ? source.get(key as string | number)
              : kind === 'count'
                ? source.count(key)
                : source.getAll(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => db.close();
        };
      }),
    q,
  );
  return result as T;
}

/** Cached data files for one release tag. */
export function countDataFiles(page: Page, tag: string): Promise<number> {
  return query<number>(page, { store: 'dataFiles', kind: 'count', index: 'tag', key: tag });
}

/** The paths cached for one release tag, sorted. */
export async function cachedPaths(page: Page, tag: string): Promise<string[]> {
  const rows = await query<Array<{ path: string }>>(page, {
    store: 'dataFiles',
    kind: 'getAll',
    index: 'tag',
    key: tag,
  });
  return rows.map((r) => r.path).sort();
}

/** A row of the `settings` store, unwrapped. */
export async function getSetting<T = unknown>(page: Page, key: string): Promise<T | undefined> {
  const row = await query<{ value: T } | undefined>(page, { store: 'settings', kind: 'get', key });
  return row?.value;
}

/**
 * Writes a row of the `settings` store, as the app stores it, for state a test
 * cannot reach through the UI in reasonable time (a remembered release list
 * gone stale, a launch counter). Fails if the database or store is missing:
 * the app must have booted first.
 */
export async function putSetting(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ key, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('cast-guidance');
        open.onupgradeneeded = () => {
          open.transaction?.abort();
          reject(new Error('putSetting: the app database does not exist yet'));
        };
        open.onerror = () => {
          if (open.error?.name !== 'AbortError') reject(open.error);
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key, value });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { key, value },
  );
}

/** Just the fields the specs read; the stored document has many more. */
export interface StoredCharacter {
  id: string;
  name: string;
  play: { conditions: Array<{ id: string; level?: number }> };
  [field: string]: unknown;
}

export function getCharacter(page: Page, id: string): Promise<StoredCharacter | undefined> {
  return query<StoredCharacter | undefined>(page, { store: 'characters', kind: 'get', key: id });
}

export function listCharacters(page: Page): Promise<StoredCharacter[]> {
  return query<StoredCharacter[]>(page, { store: 'characters', kind: 'getAll' });
}
