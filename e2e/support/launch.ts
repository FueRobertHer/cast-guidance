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
 *   resolve, so nothing reaches a real host. The rule also catches IP
 *   literals, hence the 127.0.0.1 exclusion. Routed requests are answered
 *   before any lookup, so the mirror and the network guard work as before.
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
