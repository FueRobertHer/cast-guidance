/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './pwa.manifest.ts';
import { shippedModulesCollector } from './scripts/shippedModules.ts';
import { headersMetaPlugin } from './src/app/headersMeta.ts';

// vercel.json is the source of truth for the response headers. Their digest
// goes into index.html so a header change also changes the precached shell's
// revision; see src/app/headersMeta.ts.
const vercelConfig: { headers?: unknown } = JSON.parse(
  readFileSync(path.resolve(__dirname, 'vercel.json'), 'utf8'),
);

// Third-party notices (LEGAL-001): `build.license` lists the packages in the
// main bundle, and the collector records every chunk's modules, workers
// included, since `build.license` skips worker builds. The collector moves
// both records out of the bundle to node_modules/.cache, so dist/ never holds
// them, and `bun run notices` turns them into THIRD_PARTY_NOTICES.md.
const shippedModules = shippedModulesCollector(__dirname);

export default defineConfig({
  build: {
    license: { fileName: '.vite/licenses.json' },
  },
  worker: {
    plugins: () => [shippedModules.worker()],
  },
  plugins: [
    react(),
    tailwindcss(),
    headersMetaPlugin(vercelConfig.headers),
    VitePWA({
      registerType: 'prompt',
      // Game data lives in IndexedDB, not the SW cache: precache the app shell only.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // `includeManifestIcons` (on by default) precaches exactly the icons
        // the manifest lists, so the glob skips `icons/` rather than adding
        // every PNG there. The Apple touch icon stays out: iOS fetches it
        // once, online, when the app is added to the Home Screen.
        globIgnores: ['icons/**'],
      },
      manifest: pwaManifest,
    }),
    shippedModules.main,
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    // Explicit roots so local runs match CI: without this, Vitest also picks
    // up test copies under `.claude/worktrees/`, which import the root `src`
    // through the `@/` alias and skew both the test count and coverage.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'e2e/a11y/*.test.ts'],
    // Headroom for a loaded 4-vCPU runner with coverage on: component tests
    // that take a second locally ran past the 5 s default there.
    testTimeout: 15_000,
    // CI's runners have 4 vCPUs, and Vitest's default of one worker per CPU
    // but one leaves a CPU to the main process, which mostly waits once the
    // modules are transformed. Pinned to 4 CPUs, 3 workers took 105 s and 4
    // took 86 s. More ran faster still (72 s at 6), but they slow each test
    // toward the 1 s `waitFor` default and the e2e jobs take longer anyway.
    maxWorkers: process.env.CI ? 4 : undefined,
    // Node 25 and later define their own `localStorage` (undefined without
    // `--localstorage-file`) and `sessionStorage`. Vitest's jsdom environment
    // leaves alone most globals Node already has, these two included, so tests
    // got Node's storage instead of jsdom's. Turning Node's off in the workers
    // gives the global shape older Node has (CI included), where jsdom's
    // storage shows through. The check is false on Node without web storage
    // on, where the flag may not exist.
    execArgv: 'localStorage' in globalThis ? ['--no-experimental-webstorage'] : [],
    // vite-plugin-pwa resolves its virtual modules to `/@vite-plugin-pwa/...`.
    // Vitest builds a CommonJS `require` from each module's `file:///@vite-...`
    // URL, which has no drive letter, so on Windows it throws and every test
    // that reaches `PwaUpdateToast` fails to load. Under Vitest the plugin
    // serves this file verbatim (its dev client, an inert `useRegisterSW`), so
    // pointing the import straight at it changes nothing but the module's path.
    alias: {
      'virtual:pwa-register/react': path.resolve(
        __dirname,
        'node_modules/vite-plugin-pwa/dist/client/dev/react.js',
      ),
    },
    coverage: {
      provider: 'v8',
      // `json-summary` writes coverage/coverage-summary.json, which CI turns
      // into the step summary.
      reporter: ['text', 'text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // Bootstrap, ambient types, and test files aren't meaningful to cover.
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
      // A ratchet, not a target: each floor is one point under the measured
      // total rounded down (87.79 / 79.37 / 82.94 / 89.48 at the last
      // measure), so `test:coverage` fails when coverage falls. Raise them as
      // coverage grows; do not use `autoUpdate`, which rewrites this file.
      thresholds: {
        statements: 86,
        branches: 78,
        functions: 81,
        lines: 88,
      },
    },
    // No `passWithNoTests`: the suite has real tests, so a run that matches
    // zero files means test discovery broke and should fail loudly.
  },
});
