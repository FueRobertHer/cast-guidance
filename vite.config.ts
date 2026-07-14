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
        name: 'D&D Character Sheet',
        short_name: 'DnD Sheet',
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
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // Bootstrap, ambient types, and test files aren't meaningful to cover.
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
    },
    // No `passWithNoTests`: the suite has real tests, so a run that matches
    // zero files means test discovery broke and should fail loudly.
  },
});
