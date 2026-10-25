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

/** Legacy `DOMException.QUOTA_EXCEEDED_ERR`. Only trusted on a DOMException. */
const QUOTA_CODE = 22;

/** Wrappers to look through before giving up: inner, cause, aggregates, failures. */
const MAX_DEPTH = 4;

export const QUOTA_GUIDANCE =
  'This device is out of storage space for the app. Free some space on this device, then try ' +
  'again. Settings shows how much storage the app is using.';

/**
 * Errors one failure can hold several of. `AggregateError` comes from a batch
 * of saves (`flushAll`, `retryFailedSaves`). Dexie's `ModifyError` and
 * `BulkError` keep theirs in `failures`, with no `inner` or `cause`: an array
 * in Dexie 4, a position-to-error map in Dexie 3. `Object.values` reads both.
 */
function nestedErrors(err: object): unknown[] {
  if (err instanceof AggregateError) return err.errors;
  const failures = (err as { failures?: unknown }).failures;
  return typeof failures === 'object' && failures !== null ? Object.values(failures) : [];
}

function isQuotaAt(err: unknown, depth: number): boolean {
  if (typeof err !== 'object' || err === null || depth > MAX_DEPTH) return false;
  const e = err as { name?: unknown; inner?: unknown; cause?: unknown };
  if (typeof e.name === 'string' && QUOTA_NAMES.has(e.name)) return true;
  // A Node errno can also be 22 (EINVAL), so the code counts on a DOMException only.
  if (err instanceof DOMException && err.code === QUOTA_CODE) return true;
  if (nestedErrors(err).some((inner) => isQuotaAt(inner, depth + 1))) return true;
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
