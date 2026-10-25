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

/** A row of the `settings` store, unwrapped. */
export async function getSetting<T = unknown>(page: Page, key: string): Promise<T | undefined> {
  const row = await query<{ value: T } | undefined>(page, { store: 'settings', kind: 'get', key });
  return row?.value;
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
