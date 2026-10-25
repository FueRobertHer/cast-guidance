/**
 * The device's record of its one-time "Ready to use offline" notice. Its own
 * module so Settings can read it without importing the notice's watcher.
 */
export const OFFLINE_ANNOUNCED_KEY = 'cast-guidance:offline-ready-announced';

/** Whether this device has had its one "Ready to use offline" notice (or skipped it). */
export function offlineReadyAnnounced(): boolean {
  try {
    return localStorage.getItem(OFFLINE_ANNOUNCED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Record that the notice was given or skipped, so later visits stay quiet. */
export function markOfflineReadyAnnounced(): void {
  try {
    localStorage.setItem(OFFLINE_ANNOUNCED_KEY, new Date().toISOString());
  } catch {
    // Unremembered: at worst a later visit decides again, silently or not.
  }
}
