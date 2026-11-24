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

// The built-in rule sets' folder, as Rolldown spells a module id (forward slashes).
const RULES_DIR = `${path.resolve(__dirname, 'src/rules').replaceAll('\\', '/')}/`;

// CI splits the unit tests across shards and merges their blob reports in one
// last job (see .github/workflows/ci.yml). A shard runs a slice of the suite,
// so it collects coverage but reports none and gates none: the floors below
// are measured against the merged whole, which is the only place they mean
// anything. A shard holding a third of the code would fail every floor.
const collectOnly = process.env.COVERAGE_COLLECT_ONLY === '1';

export default defineConfig({
  build: {
    license: { fileName: '.vite/licenses.json' },
    rolldownOptions: {
      output: {
        // A built-in rule set (`src/rules/`, loaded by `src/data5e/builtInRules.ts`)
        // is data standing in for code: a name of its own, so the bundle budget
        // measures it on a line of its own.
        chunkFileNames: (chunk) =>
          (chunk.facadeModuleId ?? '').replaceAll('\\', '/').startsWith(RULES_DIR)
            ? 'assets/rule-set-[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
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
        globIgnores: [
          'icons/**',
          // Faces only Parchment and Modern draw in (src/theme/builtins.ts):
          // fetched when a theme first asks, then kept by the route below.
          'assets/literata-latin-400-*',
          'assets/literata-latin-700-*',
          'assets/alegreya-*',
          'assets/inter-*',
        ],
        // Theme fonts, cache first: a face's file name carries its content
        // hash, so a stored copy is never stale. The precache's route comes
        // first, so the default themes' faces are still served from it.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'theme-fonts',
              expiration: { maxEntries: 32 },
            },
          },
        ],
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
    // modules are transformed. 4 is as fast as one runner goes: measured on 4
    // CPUs with coverage, 4, 6 and 8 workers each took about 200 s, since the
    // extra workers only contend for the same cores and push every test
    // toward the 1 s `waitFor` default. The suite is split across CI jobs
    // instead; see .github/workflows/ci.yml.
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
      // into the step summary. A shard writes its coverage into its blob
      // report and nothing else: the merge job writes the reports.
      reporter: collectOnly
        ? ['text-summary']
        : ['text', 'text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // Bootstrap, ambient types, and test files aren't meaningful to cover.
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
      // A ratchet, not a target: each floor is one point under the measured
      // total rounded down (87.79 / 79.37 / 82.94 / 89.48 at the last
      // measure), so `test:coverage` fails when coverage falls. Raise them as
      // coverage grows; do not use `autoUpdate`, which rewrites this file.
      thresholds: collectOnly
        ? undefined
        : {
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
