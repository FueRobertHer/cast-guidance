// @vitest-environment jsdom
// The whole point of the Sheet wrapper is one prop, and the prop's name reads
// backwards (`disablePreventScroll={false}` is what disables it), so a future
// tidy-up could plausibly "fix" it and quietly bring the mobile Safari scroll
// jump back. Pin it.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const Root = vi.fn((_props: Record<string, unknown>) => null);
const NestedRoot = vi.fn((_props: Record<string, unknown>) => null);
const Title = () => null;
vi.mock('vaul', () => ({ Drawer: { Root, NestedRoot, Title } }));

const { Sheet } = await import('./sheet');

afterEach(() => {
  cleanup();
  Root.mockClear();
  NestedRoot.mockClear();
});

describe('Sheet.Root', () => {
  it('opts out of vaul’s iOS scroll lock', () => {
    render(<Sheet.Root />);
    expect(Root.mock.lastCall?.[0]).toMatchObject({ disablePreventScroll: false });
  });

  it('forwards the caller’s own props', () => {
    const onOpenChange = vi.fn();
    render(<Sheet.Root open onOpenChange={onOpenChange} />);
    expect(Root.mock.lastCall?.[0]).toMatchObject({
      disablePreventScroll: false,
      open: true,
      onOpenChange,
    });
  });

  // Both spellings of "put it back" go through the spread, so the prop has to
  // win after it rather than supply a default before it.
  it.each([true, undefined])('keeps the lock off when a caller passes %s', (override) => {
    render(<Sheet.Root disablePreventScroll={override} />);
    expect(Root.mock.lastCall?.[0]).toMatchObject({ disablePreventScroll: false });
  });
});

describe('Sheet.NestedRoot', () => {
  it('gets the same treatment as Sheet.Root', () => {
    render(<Sheet.NestedRoot disablePreventScroll />);
    expect(NestedRoot.mock.lastCall?.[0]).toMatchObject({ disablePreventScroll: false });
  });
});

describe('Sheet', () => {
  it('passes the rest of the Drawer namespace through untouched', () => {
    expect(Sheet.Title).toBe(Title);
  });
});

/**
 * The wrapper only works if everything goes through it. Nothing enforced that,
 * so a new sheet reaching for `Drawer` directly would quietly ship the scroll
 * jump again: invisible on desktop, invisible in this suite, reproducible only
 * on a physical iOS device. Same idea as the engine's architecture guard, which
 * keeps its own copy of this scan.
 *
 * Source is read through Vite's raw glob, so the check stays in the browser
 * tsconfig with no Node types. Test files are exempt: they mock the specifier
 * rather than render it.
 */
const appSources = Object.entries(
  import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
).filter(([key]) => !/\.test\.tsx?$/.test(key) && key !== './sheet.tsx');

// Blunt on purpose: any mention of the module specifier, static or dynamic.
const VAUL_SPECIFIER = /['"]vaul['"]/;

describe('sheet boundary', () => {
  it('scans a non-trivial set of app source files', () => {
    // Guards against a glob/path bug making the assertion below vacuously pass.
    expect(appSources.length).toBeGreaterThan(50);
  });

  it('routes every vaul usage through this wrapper', () => {
    const direct = appSources
      .filter(([, source]) => VAUL_SPECIFIER.test(source))
      .map(([key]) => key);
    expect(direct).toEqual([]);
  });
});
