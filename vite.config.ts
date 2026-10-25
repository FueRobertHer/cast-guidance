/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './pwa.manifest.ts';
import { headersMetaPlugin } from './src/app/headersMeta.ts';

// vercel.json is the source of truth for the response headers. Their digest
// goes into index.html so a header change also changes the precached shell's
// revision; see src/app/headersMeta.ts.
const vercelConfig: { headers?: unknown } = JSON.parse(
  readFileSync(path.resolve(__dirname, 'vercel.json'), 'utf8'),
);

export default defineConfig({
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
