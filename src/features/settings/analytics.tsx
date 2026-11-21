import { lazy, Suspense } from 'react';

/**
 * Whether this build counts page views. Off unless the build sets
 * `VITE_ANALYTICS=vercel`, so Settings' "None of it is sent to a server" holds for every
 * build that does not opt in.
 */
export function analyticsEnabled(): boolean {
  return import.meta.env.VITE_ANALYTICS === 'vercel';
}

/*
 * The check is written out here rather than through `analyticsEnabled()` so
 * the build replaces it with a literal and drops the branch: without the flag
 * the analytics package is not in the bundle at all, not merely unmounted.
 */
const VercelAnalytics =
  import.meta.env.VITE_ANALYTICS === 'vercel' ? lazy(() => import('./VercelAnalytics')) : null;

/** Vercel Web Analytics, for a build that asked for it; nothing otherwise. */
export function AnalyticsMount() {
  if (VercelAnalytics === null) return null;
  return (
    <Suspense fallback={null}>
      <VercelAnalytics />
    </Suspense>
  );
}
