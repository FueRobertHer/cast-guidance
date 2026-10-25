import type { LaunchOptions } from '@playwright/test';

/**
 * Chromium flags that keep every launch off the real network, below what
 * `context.route` can see. Routing answers requests, but a browser opens some
 * sockets without one: a `<link rel="preconnect">` (`index.html` has one for
 * jsDelivr), a WebSocket, its own background traffic. Those went to the real
 * hosts, through the machine's proxy if it had one, and no guard noticed.
 *
 * - `--proxy-server=direct://`: no proxy, so every name is resolved here.
 *   The headless shell ignores `--no-proxy-server` and keeps the proxy from
 *   the environment, so that flag is not enough.
 * - `--host-resolver-rules`: every name but our own servers' fails to
 *   resolve, so nothing opened by host name reaches a real host. The rule
 *   also catches IP literals, hence the 127.0.0.1 exclusion. Routed requests
 *   are answered before any lookup, so the mirror and the network guard work
 *   as before.
 *
 * Not covered: a connection to another literal IP address that skips the
 * resolver, such as WebRTC over UDP. The app uses no WebRTC.
 *
 * `harness.spec.ts` checks both launch paths with a WebSocket.
 */
export const HERMETIC_ARGS: readonly string[] = [
  '--proxy-server=direct://',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
];

const isHermeticArg = (arg: string) =>
  arg === '--no-proxy-server' ||
  arg.startsWith('--proxy-server') ||
  arg.startsWith('--host-resolver-rules');

/**
 * `base` with {@link HERMETIC_ARGS} in force. Every launch path goes through
 * this (the project's browser in `playwright.config.ts`, persistent profiles
 * in `support/test.ts`), and a caller's own proxy or resolver flags cannot
 * replace them.
 */
export function hermeticLaunchOptions(base: LaunchOptions = {}): LaunchOptions {
  return {
    ...base,
    args: [...(base.args ?? []).filter((arg) => !isHermeticArg(arg)), ...HERMETIC_ARGS],
  };
}

/**
 * Airplane mode below the routing layer: {@link HERMETIC_ARGS} without the
 * loopback exclusions, so every name and IP literal fails to resolve, our own
 * servers included. For an offline launch at the stable origin
 * (`coldLaunch.ts`): `offline: true` makes `navigator.onLine` false and fails
 * the page's and the worker's fetches, but the browser's own update check for
 * the service worker still reaches the origin, and a server other tests share
 * cannot be taken down for one of them. Routed requests are still answered
 * before any lookup, so the mirror (refusing, offline) sees them.
 */
export const AIRPLANE_ARGS: readonly string[] = [
  '--proxy-server=direct://',
  '--host-resolver-rules=MAP * ~NOTFOUND',
];

/** `base` with {@link AIRPLANE_ARGS} in force, in place of any proxy or resolver flags. */
export function airplaneLaunchOptions(base: LaunchOptions = {}): LaunchOptions {
  return {
    ...base,
    args: [...(base.args ?? []).filter((arg) => !isHermeticArg(arg)), ...AIRPLANE_ARGS],
  };
}
