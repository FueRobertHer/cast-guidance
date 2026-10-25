// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { DB_LIFECYCLE_COPY, DbLifecycleBanner } from './DbLifecycleBanner';

afterEach(() => {
  cleanup();
  dbLifecycleStore.setState({ state: 'open' });
});

describe('DbLifecycleBanner', () => {
  it('shows nothing while the database is open, but keeps its live region mounted', () => {
    render(<DbLifecycleBanner onReload={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    // Polite: a role=alert would interrupt whatever the person was hearing.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['deleted', /reset in another tab/],
    ['superseded', /newer version of the app opened in another tab/],
  ] as const)('says why this tab stopped saving when %s', (state, copy) => {
    render(<DbLifecycleBanner onReload={vi.fn()} />);
    const status = screen.getByRole('status');
    act(() => dbLifecycleStore.getState().markClosed(state));

    // The same node: the message lands in the region that was already there.
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toMatch(copy);
    expect(status.textContent).toBe(DB_LIFECYCLE_COPY[state]);
    expect(status.textContent).toMatch(/Reload/);
  });

  it('leaves focus where it was and reloads only when asked', () => {
    const onReload = vi.fn();
    render(
      <>
        <button type="button">Long rest</button>
        <DbLifecycleBanner onReload={onReload} />
      </>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Long rest' });
    elsewhere.focus();

    act(() => dbLifecycleStore.getState().markClosed('deleted'));

    expect(document.activeElement).toBe(elsewhere);
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('never words the change as something this tab did wrong', () => {
    for (const copy of Object.values(DB_LIFECYCLE_COPY)) {
      expect(copy).toMatch(/another tab/);
      expect(copy).not.toMatch(/\byou\b|error|fail|wrong/i);
    }
  });
});
