/// <reference types="vitest/config" />
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Game data lives in IndexedDB, not the SW cache — precache the app shell only.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        name: 'Cast Guidance',
        short_name: 'Cast Guidance',
        description: 'Mobile-first D&D 5e character creator and play sheet',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        icons: [
          // Modern browsers accept a scalable SVG for installability.
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
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
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
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
      // total rounded down (81.09 / 71.82 / 72.65 / 82.92 at the last
      // measure), so `test:coverage` fails when coverage falls. Raise them as
      // coverage grows; do not use `autoUpdate`, which rewrites this file.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 71,
        lines: 81,
      },
    },
    // No `passWithNoTests`: the suite has real tests, so a run that matches
    // zero files means test discovery broke and should fail loudly.
  },
});
