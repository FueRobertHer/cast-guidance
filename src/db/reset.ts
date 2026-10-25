import { db } from './db';

/** Every key the app writes to Web Storage starts with this. */
const STORAGE_PREFIX = 'cast-guidance:';

/**
 * Drop the app's own keys from one Web Storage area and nothing else. A
 * prefix rather than a list of keys, so this module needs no imports from the
 * features that own them, and a key added later is swept without a change
 * here. Guarded: a blocked or broken storage must not fail the reset.
 */
function sweepStorage(area: () => Storage): void {
  try {
    const storage = area();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing reachable to clear.
  }
}

/**
 * Delete every piece of local app data: the IndexedDB database (characters,
 * homebrew, cached game data, settings, history, roll log), the service
 * worker's Cache Storage and the worker itself, and the app's localStorage and
 * sessionStorage keys (the getting-started flag, the creator draft). After it
 * the device is new to the app again. User-triggered only, behind a
 * confirmation; the caller reloads afterward so the app boots clean.
 */
export async function resetAppData(): Promise<void> {
  db.close();
  await db.delete();
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  // Unregistered too: a worker left active over the emptied cache still counts
  // as installed, so the app would claim it opens offline when it cannot. The
  // reload registers a fresh one that caches the shell again.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    } catch {
      // The data is gone either way; the next registration replaces the worker.
    }
  }
  sweepStorage(() => localStorage);
  sweepStorage(() => sessionStorage);
}
