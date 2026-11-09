/**
 * How much more this site may store, as the browser reports it, or undefined
 * when it cannot say: no Storage API, an estimate that failed, or one without
 * usable numbers. The estimate is coarse (Chrome pads it, and space freed by
 * deletes shows late), so a caller refuses only what clearly will not fit.
 */
export async function freeStorage(): Promise<number | undefined> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (typeof storage?.estimate !== 'function') return undefined;
  try {
    const { usage, quota } = await storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return undefined;
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return undefined;
    return Math.max(0, quota - usage);
  } catch {
    return undefined;
  }
}
