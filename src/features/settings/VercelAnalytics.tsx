import { Analytics } from '@vercel/analytics/react';
import { scrubAnalyticsEvent } from './analyticsUrl';

/** Loaded only by a build with `VITE_ANALYTICS=vercel` (see `analytics.tsx`). */
export default function VercelAnalytics() {
  return <Analytics beforeSend={scrubAnalyticsEvent} />;
}
