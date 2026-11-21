// @vitest-environment jsdom
// Analytics is opt-in per build (track 9, top 4): without the flag, nothing
// that could send a page view is mounted or loaded.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const beforeSends: unknown[] = [];
/** How many times the lazy chunk was loaded: the off build must never load it. */
const chunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./VercelAnalytics', async (importOriginal) => {
  chunk.loads += 1;
  return importOriginal();
});
vi.mock('@vercel/analytics/react', () => ({
  Analytics: (props: { beforeSend?: unknown }) => {
    beforeSends.push(props.beforeSend);
    return <span data-testid="vercel-analytics" />;
  },
}));

/** A fresh copy of the module, so its build-time check reads the stubbed env. */
async function load() {
  vi.resetModules();
  return import('./analytics');
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  beforeSends.length = 0;
  chunk.loads = 0;
});

describe('AnalyticsMount', () => {
  it('renders nothing and never loads the package without the flag', async () => {
    vi.stubEnv('VITE_ANALYTICS', '');
    const { AnalyticsMount, analyticsEnabled } = await load();
    const { container } = render(<AnalyticsMount />);
    expect(analyticsEnabled()).toBe(false);
    expect(container.innerHTML).toBe('');
    // Let any lazy import land, then check none was started.
    await vi.dynamicImportSettled();
    expect(chunk.loads).toBe(0);
    expect(screen.queryByTestId('vercel-analytics')).toBeNull();
  });

  it('mounts Vercel Analytics with the id-stripping beforeSend when the flag is set', async () => {
    vi.stubEnv('VITE_ANALYTICS', 'vercel');
    const { AnalyticsMount, analyticsEnabled } = await load();
    const { scrubAnalyticsEvent } = await import('./analyticsUrl');
    render(<AnalyticsMount />);
    expect(analyticsEnabled()).toBe(true);
    expect(await screen.findByTestId('vercel-analytics')).toBeTruthy();
    expect(beforeSends.at(-1)).toBe(scrubAnalyticsEvent);
    expect(chunk.loads).toBe(1);
  });

  it('treats any other value as off', async () => {
    vi.stubEnv('VITE_ANALYTICS', 'true');
    const { analyticsEnabled } = await load();
    expect(analyticsEnabled()).toBe(false);
  });
});
