import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { handleOverlays } from './app.ts';
import { DEVICE } from './device.ts';
import { airplaneLaunchOptions, hermeticLaunchOptions } from './launch.ts';
import { levelsDir, stableOrigin } from './stableOrigin.ts';
import { test as base, expect } from './test.ts';

/** What the browser reports when an offline launch asks the origin for something. */
const OFFLINE_ERRORS = /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)/;

export interface StableLaunch {
  context: BrowserContext;
  /** The profile's first tab, with the overlay handlers on. */
  page: Page;
}

export interface StableLaunchOptions {
  /** A cold start in airplane mode: offline, the mirror refusing, the origin unreachable. */
  offline?: boolean;
}

interface Fixtures {
  /**
   * Launches the persistent profile in `dir` at the stable origin, wired to
   * the test's mirror and guards. Closed at teardown, which also checks that
   * nothing was served while offline: no mirror fulfils, and no origin
   * response that did not come from the service worker.
   */
  launchStable: (dir: string, options?: StableLaunchOptions) => Promise<StableLaunch>;
  /**
   * Ends the offline stretch of an offline launch, as a phone leaving airplane
   * mode: the browser reports online and the mirror answers again. The origin
   * stays unreachable, which the precache makes no difference to.
   */
  backOnline: (launch: StableLaunch) => Promise<void>;
}

export const test = base.extend<Fixtures & { offlineLog: OfflineLog }>({
  offlineLog: async ({ mirror }, use) => {
    const log = new OfflineLog();
    await use(log);
    log.close(mirror.fulfils.length);
    log.assertNothingServed(mirror.fulfils);
  },

  launchStable: async (
    {
      playwright,
      browserName,
      channel,
      launchOptions,
      mirror,
      networkGuard,
      consoleGuard,
      offlineLog,
    },
    use,
    testInfo,
  ) => {
    const origin = stableOrigin();
    const launched: BrowserContext[] = [];
    const dirs: string[] = [];
    // Offline, the browser fails origin requests the worker does not answer
    // (the analytics script) itself.
    consoleGuard.allowResource(
      (url, text) => offlineLog.used && url.startsWith(origin) && OFFLINE_ERRORS.test(text),
    );
    await use(async (dir, options = {}) => {
      const offline = options.offline ?? false;
      if (offline) {
        mirror.setOffline(true);
        offlineLog.open(mirror.fulfils.length);
      }
      const context = await playwright[browserName].launchPersistentContext(dir, {
        // The project's browser build, off the real network; offline, cut
        // off from the stable origin too (see `launch.ts`).
        ...(offline ? airplaneLaunchOptions(launchOptions) : hermeticLaunchOptions(launchOptions)),
        channel,
        ...DEVICE,
        baseURL: origin,
        offline,
      });
      launched.push(context);
      dirs.push(dir);
      await networkGuard.attach(context);
      await mirror.attach(context);
      consoleGuard.watch(context);
      if (offline) {
        context.on('response', (response) => {
          if (!offlineLog.offline) return;
          if (response.url().startsWith(origin) && !response.fromServiceWorker()) {
            offlineLog.served.push(response.url());
          }
        });
      }
      for (const page of context.pages()) await handleOverlays(page);
      context.on('page', (page) => void handleOverlays(page));
      const page = context.pages()[0] ?? (await context.newPage());
      return { context, page };
    });
    for (const context of launched) await context.close();
    for (const dir of dirs) keepProfileIfUseful(dir, testInfo);
  },

  backOnline: async ({ mirror, offlineLog }, use) => {
    await use(async ({ context, page }) => {
      // A round trip first, so console messages from the offline stretch land inside it.
      await page.evaluate(() => 0);
      offlineLog.close(mirror.fulfils.length);
      mirror.setOffline(false);
      await context.setOffline(false);
    });
  },
});

/** Failed cells in a run whose profile is kept, for a look by hand. */
const KEEP_FAILED_PROFILES = 3;

/**
 * Claims one of the run's {@link KEEP_FAILED_PROFILES} slots. Counted on disk,
 * not in memory: Playwright replaces a worker after a failure, so a counter
 * in the module would start again at every one.
 */
function claimKeepSlot(): boolean {
  const slots = levelsDir('.kept-failed-profiles');
  mkdirSync(slots, { recursive: true });
  for (let i = 0; i < KEEP_FAILED_PROFILES; i++) {
    try {
      mkdirSync(path.join(slots, String(i)));
      return true;
    } catch {
      // Taken by an earlier failure; try the next.
    }
  }
  return false;
}

/**
 * A cell's profile is a few megabytes, and a broken build fails every cell:
 * kept whole, the report would carry hundreds of megabytes. A passing cell's
 * profile goes; a failing one keeps its IndexedDB and settings but not the
 * worker's CacheStorage (the precached build, which is `dist/` again), and
 * only the first few failures of the run keep one at all.
 */
function keepProfileIfUseful(dir: string, testInfo: TestInfo): void {
  const failed = testInfo.status !== testInfo.expectedStatus;
  if (!failed || !claimKeepSlot()) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  rmSync(path.join(dir, 'Default', 'Service Worker', 'CacheStorage'), {
    recursive: true,
    force: true,
  });
}

/** The offline stretches of a test, as indexes into the mirror's fulfils. */
class OfflineLog {
  /** Origin responses that came from the network while offline. */
  readonly served: string[] = [];
  private readonly windows: Array<{ from: number; to?: number }> = [];
  used = false;

  get offline(): boolean {
    const last = this.windows.at(-1);
    return last !== undefined && last.to === undefined;
  }

  open(fulfils: number): void {
    this.used = true;
    if (!this.offline) this.windows.push({ from: fulfils });
  }

  close(fulfils: number): void {
    const last = this.windows.at(-1);
    if (last !== undefined && last.to === undefined) last.to = fulfils;
  }

  assertNothingServed(fulfils: readonly string[]): void {
    for (const w of this.windows) {
      expect(fulfils.slice(w.from, w.to), 'mirror fulfils while offline').toEqual([]);
    }
    expect(this.served, 'origin responses from the network while offline').toEqual([]);
  }
}

export { expect };
