import type { ManifestOptions } from 'vite-plugin-pwa';

/**
 * The web app manifest (PWA-002, #107), kept out of `vite.config.ts` so
 * `scripts/pwaManifest.test.ts` can check it without loading Vite's plugins.
 *
 * The PNGs under `public/icons/` come from `scripts/generate-icons.ts`. Each
 * purpose gets its own entries: the rounded-square SVG and the `any` PNGs are
 * not maskable-safe (a launcher's circle mask would clip the hexagon), so only
 * the full-bleed `maskable-*` files claim `maskable`.
 */
export const pwaManifest: Partial<ManifestOptions> = {
  id: '/',
  name: 'Cast Guidance',
  short_name: 'Cast Guidance',
  description: 'Mobile-first D&D 5e character creator and play sheet',
  start_url: '/',
  scope: '/',
  theme_color: '#18181b',
  background_color: '#18181b',
  display: 'standalone',
  icons: [
    { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

/**
 * Linked from `index.html` for iOS. Safari before 15.4 ignores the manifest's
 * icons, and later versions still prefer this link when it is present, so iOS
 * gets an opaque 180 px icon rather than an `any` PNG with transparent
 * corners. Not precached.
 */
export const APPLE_TOUCH_ICON = { src: 'icons/apple-touch-icon-180.png', size: 180 } as const;
