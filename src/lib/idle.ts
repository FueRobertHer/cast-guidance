/** requestIdleCallback with a setTimeout fallback (Safari). */
export function runWhenIdle(fn: () => void, timeoutMs = 2000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: timeoutMs });
  } else {
    setTimeout(fn, 250);
  }
}
