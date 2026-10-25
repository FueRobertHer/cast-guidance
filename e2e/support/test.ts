import path from 'node:path';
import { type BrowserContext, test as base, expect } from '@playwright/test';
import { Mirror } from '../fixtures/mirror.ts';
import { type StaticServer, startStaticServer } from '../server/staticServer.ts';
import { swVariantTransform } from '../server/swVariants.ts';
import { loadVercelRouting } from '../server/vercelRouting.ts';
import { dismissGettingStartedWhenShown } from './app.ts';
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
 */
export interface Network {
  goOffline(): Promise<void>;
  goOnline(): Promise<void>;
  readonly offline: boolean;
  /**
   * Asserts nothing was served while offline: no mirror fulfils, and no origin
   * requests except the worker's update check, which must have been refused.
   */
  assertNothingServedOffline(): void;
  /** Also take `context` offline and online with the rest (a launched profile). */
  track(context: BrowserContext): void;
}

export interface ProfileOptions {
  /** Launch with the network off, as a phone in airplane mode would. */
  offline?: boolean;
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
    },
    { auto: true },
  ],

  consoleGuard: [
    async ({ context, mirror, server }, use) => {
      const guard = new ConsoleGuard();
      guard.watch(context);
      // Requests the test itself made fail are expected to log.
      guard.allowResource((url) => mirror.failedUrls.has(url));
      // While the harness has a context offline, the browser fails origin
      // requests the worker does not answer (the analytics script) itself.
      guard.allowResource(
        (url, text) =>
          url.startsWith(server.url) && text.includes('net::ERR_INTERNET_DISCONNECTED'),
      );
      guard.allowResource((url) => {
        if (!url.startsWith(server.url)) return false;
        const pathname = new URL(url).pathname;
        return server.requests.some((r) => r.path === pathname && r.status === 'refused');
      });
      await use(guard);
      guard.assertClean();
    },
    { auto: true },
  ],

  page: async ({ page, consoleGuard }, use) => {
    void consoleGuard;
    await dismissGettingStartedWhenShown(page);
    await use(page);
  },

  network: async ({ context, server, mirror }, use) => {
    let offline = false;
    let servedFrom = 0;
    let servedTo: number | undefined;
    const contexts = new Set<BrowserContext>([context]);
    const network: Network = {
      get offline() {
        return offline;
      },
      async goOffline() {
        offline = true;
        servedFrom = server.requests.length;
        servedTo = undefined;
        mirror.setOffline(true);
        server.setDown(true);
        for (const ctx of contexts) await ctx.setOffline(true);
      },
      async goOnline() {
        offline = false;
        servedTo = server.requests.length;
        mirror.setOffline(false);
        server.setDown(false);
        for (const ctx of contexts) await ctx.setOffline(false);
      },
      assertNothingServedOffline() {
        expect(mirror.fulfilsWhileOffline(), 'mirror fulfils while offline').toBe(0);
        const origin = server.requests.slice(servedFrom, servedTo);
        const served = origin.filter((r) => r.status !== 'refused');
        expect(served, 'origin requests served while offline').toEqual([]);
        const unexpected = origin.filter((r) => !SW_UPDATE_CHECK.test(r.path));
        expect(unexpected, 'origin requests other than the update check').toEqual([]);
      },
      track(ctx) {
        contexts.add(ctx);
        ctx.on('close', () => contexts.delete(ctx));
      },
    };
    await use(network);
  },

  launchProfile: async (
    { playwright, browserName, launchOptions, server, mirror, networkGuard, consoleGuard, network },
    use,
  ) => {
    const launched: BrowserContext[] = [];
    await use(async (dir, options = {}) => {
      const context = await playwright[browserName].launchPersistentContext(dir, {
        ...launchOptions,
        ...DEVICE,
        baseURL: server.url,
        offline: options.offline ?? false,
      });
      launched.push(context);
      await networkGuard.attach(context);
      await mirror.attach(context);
      consoleGuard.watch(context);
      network.track(context);
      for (const page of context.pages()) await dismissGettingStartedWhenShown(page);
      context.on('page', (page) => void dismissGettingStartedWhenShown(page));
      return context;
    });
    for (const context of launched) await context.close();
  },
});

export { expect };
