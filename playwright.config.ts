import { defineConfig } from '@playwright/test';
import { DEVICE } from './e2e/support/device.ts';

const CI = process.env.CI !== undefined && process.env.CI !== '';

/**
 * Browser E2E against the production build in `dist/` (run `bun run build`
 * first, or `bun run e2e:ci`). There is no `webServer`: each worker starts its
 * own static server (see `e2e/support/test.ts`), so every worker has its own
 * origin, and a spec can take a private server whose content it changes.
 * See e2e/README.md.
 */
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/e2e',
  // Traces, screenshots and persistent profiles are kept for failures only.
  preserveOutput: 'failures-only',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // No retries: a flaky spec is a bug to fix, and a retry would hide it.
  retries: 0,
  // The public runners have 4 vCPUs; a fourth worker starves the browsers.
  workers: CI ? 3 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'test-results/e2e.json' }],
      ]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...DEVICE,
        // An escape hatch for a machine whose browser build does not match
        // the pinned @playwright/test.
        launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
});
