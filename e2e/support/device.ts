import { devices } from '@playwright/test';

/**
 * The browser every spec runs in: a phone, because the app is mobile-first,
 * with service workers on (the default, stated because the suite depends on
 * it) and a fixed locale and time zone. Shared by `playwright.config.ts` and
 * persistent profiles launched from a spec, so both behave the same.
 */
export const DEVICE = {
  ...devices['Pixel 7'],
  serviceWorkers: 'allow' as const,
  locale: 'en-US',
  timezoneId: 'UTC',
};

/**
 * The same, as an iPhone in WebKit: Safari's engine, which every browser on
 * iOS uses and where an installed PWA runs (the `webkit` project). Service
 * workers are blocked: WebKit's routing does not see what a page the worker
 * controls fetches through it, so with a worker the mirror could not answer
 * the app's game data and the specs could not stay off the real network.
 */
export const WEBKIT_DEVICE = {
  ...devices['iPhone 14'],
  serviceWorkers: 'block' as const,
  locale: 'en-US',
  timezoneId: 'UTC',
};

/** The device a project's browser runs as, for profiles a spec launches itself. */
export function deviceFor(browserName: string): typeof DEVICE | typeof WEBKIT_DEVICE {
  return browserName === 'webkit' ? WEBKIT_DEVICE : DEVICE;
}
