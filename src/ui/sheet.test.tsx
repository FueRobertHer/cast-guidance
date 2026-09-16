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
