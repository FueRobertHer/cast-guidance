/**
 * Storage failures as guidance (TEST-002). A write refused for lack of space
 * reaches the UI as a DOMException named `QuotaExceededError`, often wrapped
 * by Dexie (whose error keeps that name and holds the original as `inner`).
 * Its message ("The quota has been exceeded.") tells nobody what to do, so a
 * catch site that stores or shows an error message runs it through
 * {@link storageErrorText} first.
 *
 * Kept free of stores and React so the data loader can use it too.
 */

/** Names browsers and Dexie give an out-of-space write. */
const QUOTA_NAMES: ReadonlySet<string> = new Set([
  'QuotaExceededError',
  // Firefox before it adopted the standard name.
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

/** Wrappers to look through before giving up: Dexie's inner, a cause, an aggregate. */
const MAX_DEPTH = 4;

export const QUOTA_GUIDANCE =
  'This device is out of storage space for the app. Free some space, for example by deleting ' +
  'homebrew files you no longer use, then try again.';

function isQuotaAt(err: unknown, depth: number): boolean {
  if (typeof err !== 'object' || err === null || depth > MAX_DEPTH) return false;
  // By name only: the legacy code 22 always comes with the standard name.
  const e = err as { name?: unknown; inner?: unknown; cause?: unknown };
  if (typeof e.name === 'string' && QUOTA_NAMES.has(e.name)) return true;
  // A batch of saves (`flushAll`, `retryFailedSaves`) rejects with every failure.
  if (err instanceof AggregateError && err.errors.some((inner) => isQuotaAt(inner, depth + 1))) {
    return true;
  }
  return isQuotaAt(e.inner, depth + 1) || isQuotaAt(e.cause, depth + 1);
}

/** True when `err` is, or wraps, a write refused because storage is full. */
export function isQuotaError(err: unknown): boolean {
  return isQuotaAt(err, 0);
}

/**
 * The message to show for a failed storage operation: guidance for a full
 * device, otherwise the error's own message (the same rule as `errorText`).
 */
export function storageErrorText(err: unknown): string {
  if (isQuotaError(err)) return QUOTA_GUIDANCE;
  return err instanceof Error ? err.message : String(err);
}
