// @vitest-environment jsdom
// Analytics is opt-in per build (track 9, top 4): without the flag, nothing
// that could send a page view is mounted or loaded.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

/** Every source file under `src`, as [path from src, text]. */
function sources(): [string, string][] {
  const root = path.resolve(import.meta.dirname, '../..');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f.replaceAll('\\', '/'), readFileSync(path.join(root, f), 'utf8')]);
}

// The runtime tests above cannot see the bundle: a static import of the package
// anywhere, or the lazy import behind a check the build cannot fold to a
// literal, would ship the package in every build with all of them still green.
describe('the analytics package stays out of a build without the flag', () => {
  it('is imported by VercelAnalytics.tsx alone', () => {
    const importers = sources()
      .filter(([, text]) => /['"]@vercel\/analytics/.test(text))
      .map(([f]) => f);
    expect(importers).toEqual(['features/settings/VercelAnalytics.tsx']);
  });

  it('is reached only through a lazy import behind the literal env check', () => {
    const importers = sources()
      .filter(([, text]) => /['/]VercelAnalytics'/.test(text))
      .map(([f]) => f);
    expect(importers).toEqual(['features/settings/analytics.tsx']);
    const text = readFileSync(path.join(import.meta.dirname, 'analytics.tsx'), 'utf8');
    expect(text).toMatch(
      /import\.meta\.env\.VITE_ANALYTICS === 'vercel' \? lazy\(\(\) => import\('\.\/VercelAnalytics'\)\) : null/,
    );
    expect(text).not.toMatch(/^import .*VercelAnalytics/m);
  });
});
