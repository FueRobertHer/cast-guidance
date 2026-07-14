import { db } from './db';

/**
 * Delete every piece of local app data — the IndexedDB database (characters,
 * homebrew, cached game data, settings, history, roll log) and the service
 * worker's Cache Storage. User-triggered only, behind a confirmation; the
 * caller reloads afterward so the app boots clean.
 */
export async function resetAppData(): Promise<void> {
  db.close();
  await db.delete();
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}
