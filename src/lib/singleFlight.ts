/**
 * Share one in-flight promise per key: concurrent callers with the same key
 * get the same promise and `factory` runs once. The entry clears when the
 * promise settles (success or failure), so a later call re-runs cleanly.
 *
 * Used so concurrent requests for the same data file — or the same pack — do
 * not each start their own work (and each double-count download progress).
 */
export function singleFlight<K, T>(
  map: Map<K, Promise<T>>,
  key: K,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const promise = factory().finally(() => {
    // Only clear our own entry — a re-run after settling may have replaced it.
    if (map.get(key) === promise) map.delete(key);
  });
  map.set(key, promise);
  return promise;
}
