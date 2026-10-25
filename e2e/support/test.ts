import path from 'node:path';
import { type BrowserContext, test as base, expect } from '@playwright/test';
import { Mirror } from '../fixtures/mirror.ts';
import { type StaticServer, startStaticServer } from '../server/staticServer.ts';
import { swVariantTransform } from '../server/swVariants.ts';
import { loadVercelRouting } from '../server/vercelRouting.ts';
import { handleOverlays } from './app.ts';
import { DEVICE } from './device.ts';
import { ConsoleGuard, NetworkGuard } from './guards.ts';

const REPO = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(REPO, 'dist');
const routing = loadVercelRouting(path.join(REPO, 'vercel.json'));

/** What a spec may ask of a server while offline: the browser's own update check. */
const SW_UPDATE_CHECK = /^\/(sw\.js|workbox-[\w-]+\.js)$/;

/**
 * Offline as a harness state, not just a browser flag (`context.setOffline`
 * does not stop `route.fulfill`, and a service worker's update check can still
 * reach the origin). Going offline flips all three: the mirror refuses, the
 * static server goes down, and every context reports `navigator.onLine` false
 * so the app picks its offline copy.
 *
 * Only inside an offline window does the console guard expect the browser's
 * own errors for origin requests (the analytics script the worker does not
 * cache, an update check the down server refused).
 */
export interface Network {
  goOffline(): Promise<void>;
  goOnline(): Promise<void>;
  readonly offline: boolean;
  /**
   * Asserts nothing was served in any offline window so far: no mirror
   * fulfils, and no origin requests except the worker's update check, which
   * must have been refused.
   */
  assertNothingServedOffline(): void;
  /** Also take `context` offline and online with the rest (a launched profile). */
  track(context: BrowserContext): void;
}

export interface ProfileOptions {
  /** Launch with the network off, as a phone in airplane mode would. */
  offline?: boolean;
  /**
   * Launch full Chromium in its new headless mode (`channel: 'chromium'`)
   * instead of the headless shell. Only the full browser runs the install
   * checks: the shell answers `Page.getInstallabilityErrors` with nothing.
   */
  newHeadless?: boolean;
}

interface WorkerFixtures {
  /** One server per worker for `dist/`; its origin is that worker's app origin. */
  sharedServer: StaticServer;
}

interface TestFixtures {
  /** Use a server of this test's own, with the service-worker variants hook. */
  privateServer: boolean;
  /** The server under test: the worker's, or a private one. Its log is per test. */
  server: StaticServer;
  networkGuard: NetworkGuard;
  mirror: Mirror;
  consoleGuard: ConsoleGuard;
  network: Network;
  /**
   * Launches (or relaunches) a persistent profile in `dir`, wired to the same
   * server, mirror and guards as the default context. Closed at teardown.
   */
  launchProfile: (dir: string, options?: ProfileOptions) => Promise<BrowserContext>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  sharedServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      const server = await startStaticServer({ root: DIST, routing });
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  privateServer: [false, { option: true }],

  server: async ({ sharedServer, privateServer }, use) => {
    if (privateServer) {
      const server = await startStaticServer({
        root: DIST,
        routing,
        transform: swVariantTransform,
      });
      await use(server);
      await server.close();
      return;
    }
    sharedServer.resetLog();
    await use(sharedServer);
    sharedServer.setDown(false);
    sharedServer.setVariant('v1');
  },

  baseURL: async ({ server }, use) => {
    await use(server.url);
  },

  networkGuard: [
    async ({ context }, use) => {
      const guard = new NetworkGuard();
      await guard.attach(context);
      await use(guard);
      guard.assertClean();
    },
    { auto: true },
  ],

  mirror: [
    async ({ context, networkGuard }, use) => {
      // Depends on the guard so the guard's catch-all is registered first.
      void networkGuard;
      const mirror = new Mirror();
      await mirror.attach(context);
      await use(mirror);
      mirror.releaseHeld();
      mirror.assertClean();
    },
    { auto: true },
  ],

  consoleGuard: [
    async ({ context, mirror }, use) => {
      const guard = new ConsoleGuard();
      guard.watch(context);
      // Mirror requests the test asked to fail are expected to log.
      guard.allowResource((url) => mirror.failedUrls.has(url));
      await use(guard);
      guard.assertClean();
    },
    { auto: true },
  ],

  page: async ({ page, consoleGuard }, use) => {
    void consoleGuard;
    await handleOverlays(page);
    await use(page);
  },

  network: [
    async ({ context, server, mirror, consoleGuard }, use) => {
      // Where each offline stretch starts and ends in the three logs; `to` is
      // unset while it lasts.
      interface Window {
        from: { console: number; fulfils: number; server: number };
        to?: { console: number; fulfils: number; server: number };
      }
      const windows: Window[] = [];
      const marks = () => ({
        console: consoleGuard.entries.length,
        fulfils: mirror.fulfils.length,
        server: server.requests.length,
      });
      const inWindow = (index: number) =>
        windows.some((w) => index >= w.from.console && index < (w.to?.console ?? Infinity));
      const contexts = new Set<BrowserContext>([context]);

      // Offline, the browser fails origin requests the worker does not answer
      // (the analytics script) itself, and the down server refuses the rest.
      consoleGuard.allowResource(
        (url, text, index) =>
          inWindow(index) &&
          url.startsWith(server.url) &&
          (text.includes('net::ERR_INTERNET_DISCONNECTED') ||
            server.requests.some(
              (r) => r.path === new URL(url).pathname && r.status === 'refused',
            )),
      );

      const network: Network = {
        get offline() {
          const last = windows.at(-1);
          return last !== undefined && last.to === undefined;
        },
        async goOffline() {
          // Let requests already on their way land first (the analytics
          // script a just-loaded page asks for, say), so none of them is
          // counted against the offline window.
          for (const ctx of contexts) {
            for (const page of ctx.pages()) await page.waitForLoadState('networkidle');
          }
          windows.push({ from: marks() });
          // The browser first, so a page request is never the one the down
          // server refuses; then the harness's own hosts.
          for (const ctx of contexts) await ctx.setOffline(true);
          mirror.setOffline(true);
          server.setDown(true);
        },
        async goOnline() {
          const current = windows.at(-1);
          // A round trip to every page first: console messages from the
          // offline stretch arrive before the answer, so they land inside it.
          for (const ctx of contexts) {
            for (const page of ctx.pages()) await page.evaluate(() => 0).catch(() => undefined);
          }
          if (current !== undefined && current.to === undefined) current.to = marks();
          mirror.setOffline(false);
          server.setDown(false);
          for (const ctx of contexts) await ctx.setOffline(false);
        },
        assertNothingServedOffline() {
          for (const w of windows) {
            const fulfils = mirror.fulfils.slice(w.from.fulfils, w.to?.fulfils);
            expect(fulfils, 'mirror fulfils while offline').toEqual([]);
            const origin = server.requests.slice(w.from.server, w.to?.server);
            const served = origin.filter((r) => r.status !== 'refused');
            expect(served, 'origin requests served while offline').toEqual([]);
            const unexpected = origin.filter((r) => !SW_UPDATE_CHECK.test(r.path));
            expect(unexpected, 'origin requests other than the update check').toEqual([]);
          }
        },
        track(ctx) {
          contexts.add(ctx);
          ctx.on('close', () => contexts.delete(ctx));
        },
      };
      await use(network);
    },
    { auto: true },
  ],

  launchProfile: async (
    { playwright, browserName, launchOptions, server, mirror, networkGuard, consoleGuard, network },
    use,
  ) => {
    const launched: BrowserContext[] = [];
    await use(async (dir, options = {}) => {
      const context = await playwright[browserName].launchPersistentContext(dir, {
        ...launchOptions,
        ...(options.newHeadless ? { channel: 'chromium' } : {}),
        ...DEVICE,
        baseURL: server.url,
        offline: options.offline ?? false,
      });
      launched.push(context);
      await networkGuard.attach(context);
      await mirror.attach(context);
      consoleGuard.watch(context);
      network.track(context);
      for (const page of context.pages()) await handleOverlays(page);
      context.on('page', (page) => void handleOverlays(page));
      return context;
    });
    for (const context of launched) await context.close();
  },
});

export { expect };
