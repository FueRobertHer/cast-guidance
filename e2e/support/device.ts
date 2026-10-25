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
