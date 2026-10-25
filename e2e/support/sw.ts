import { expect, type Page } from '@playwright/test';

/**
 * Makes sure the page is controlled by the service worker. The app registers
 * in prompt mode with no `clientsClaim`, so the first load never is: wait for
 * the worker to be ready, then reload once. Deterministic, no sleeps.
 */
export async function waitForSwControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  if (!controlled) await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

export interface WorkerSummary {
  scriptURL: string;
  state: ServiceWorkerState;
}

export interface SwState {
  active: WorkerSummary | null;
  waiting: WorkerSummary | null;
  installing: WorkerSummary | null;
  controlled: boolean;
}

export function swState(page: Page): Promise<SwState> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const summary = (w: ServiceWorker | null | undefined) =>
      w ? { scriptURL: w.scriptURL, state: w.state } : null;
    return {
      active: summary(reg?.active),
      waiting: summary(reg?.waiting),
      installing: summary(reg?.installing),
      controlled: navigator.serviceWorker.controller !== null,
    };
  });
}

export interface SwUpdateResult {
  /** How the new worker's install ended: now waiting, or failed. */
  state: 'installed' | 'redundant';
  /** Every state the new worker passed through, from `installing` on. */
  states: ServiceWorkerState[];
}

/**
 * Asks the registration to check for a new worker now, instead of waiting for
 * the browser's own check, and resolves once the new worker's install has
 * ended. Throws if the server had nothing new.
 */
export function triggerSwUpdate(page: Page): Promise<SwUpdateResult> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg === undefined) throw new Error('triggerSwUpdate: no service worker registration');
    // A failing install can go redundant before update() resolves and drop
    // out of `reg.installing`, so keep hold of the worker from updatefound,
    // which fires before its first state change.
    let found: ServiceWorker | null = null;
    const states: ServiceWorkerState[] = [];
    reg.addEventListener(
      'updatefound',
      () => {
        const worker = reg.installing;
        found = worker;
        if (worker === null) return;
        states.push(worker.state);
        worker.addEventListener('statechange', () => states.push(worker.state));
      },
      { once: true },
    );
    await reg.update();
    const worker: ServiceWorker | null = found ?? reg.installing ?? reg.waiting;
    if (worker === null) throw new Error('triggerSwUpdate: update() found no new worker');
    const done = (s: ServiceWorkerState) => s === 'installed' || s === 'redundant';
    if (!done(worker.state)) {
      await new Promise<void>((resolve) => {
        const onChange = () => {
          if (!done(worker.state)) return;
          worker.removeEventListener('statechange', onChange);
          resolve();
        };
        worker.addEventListener('statechange', onChange);
      });
    }
    return { state: worker.state as 'installed' | 'redundant', states };
  });
}

/** Remembers the registration's active worker, for {@link isRememberedWorkerActive}. */
export async function rememberActiveWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    (window as { e2eRememberedWorker?: ServiceWorker | null }).e2eRememberedWorker =
      reg?.active ?? null;
  });
}

/**
 * Whether the active worker is still the very one remembered (same object, so
 * the same worker), not just one at the same script URL: every build serves
 * `/sw.js`. Only meaningful before the page reloads.
 */
export function isRememberedWorkerActive(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const remembered = (window as { e2eRememberedWorker?: ServiceWorker | null })
      .e2eRememberedWorker;
    return reg?.active != null && reg.active === remembered;
  });
}
