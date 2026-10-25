import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from './motion';

function stubMatchMedia(reduce: boolean) {
  const query = vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q }));
  vi.stubGlobal('window', { matchMedia: query });
  return query;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reduced motion (A11Y-003)', () => {
  it('scrolls smoothly when the device does not ask for less motion', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps instead when it does', () => {
    const query = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
    expect(query).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('treats a missing matchMedia, or no window, as no preference', () => {
    vi.stubGlobal('window', {});
    expect(scrollBehavior()).toBe('smooth');
    vi.stubGlobal('window', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
