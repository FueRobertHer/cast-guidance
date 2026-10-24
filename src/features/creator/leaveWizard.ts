import type { NavigateFunction } from 'react-router';

/**
 * Leave the wizard for `to` so that Back from there leaves the wizard too.
 *
 * Each step is its own history entry, so replacing only the current one (what
 * creating used to do) left every earlier step behind the new sheet: Back
 * landed in a blank creator whose draft was already spent, one tap from a
 * second, empty character. This pops back to the entry the wizard was entered
 * on (`depth` entries up) and replaces that one instead.
 *
 * A pop can fail to land (the browser evicted the oldest entries), so after
 * `timeoutMs` this stops waiting and replaces the current entry, which is the
 * old behavior. A pop that lands even later than that could still reopen the
 * creator; that is no worse than before and rarer.
 */
export async function replaceWizardWith(
  navigate: NavigateFunction,
  depth: number,
  to: string,
  timeoutMs = 1000,
): Promise<void> {
  if (depth > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.resolve(navigate(-depth)), timeout]);
    clearTimeout(timer);
  }
  await navigate(to, { replace: true });
}
