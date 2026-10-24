// UX-003: creating a character unwinds the wizard's history entries before it
// replaces the entry the wizard was entered on, so Back from the new sheet
// leaves the wizard instead of landing in a spent, blank creator.
import type { NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceWizardWith } from './leaveWizard';

afterEach(() => {
  vi.useRealTimers();
});

describe('replaceWizardWith', () => {
  it('just replaces when the wizard is on the entry it was entered on', async () => {
    const navigate = vi.fn(() => Promise.resolve());
    await replaceWizardWith(navigate as unknown as NavigateFunction, 0, '/c/x');
    expect(navigate.mock.calls).toEqual([['/c/x', { replace: true }]]);
  });

  it('pops back to the entry the wizard was entered on, then replaces it', async () => {
    const calls: unknown[] = [];
    const navigate = vi.fn((to: unknown, opts?: unknown) => {
      calls.push(opts === undefined ? [to] : [to, opts]);
      return Promise.resolve();
    });
    await replaceWizardWith(navigate as unknown as NavigateFunction, 3, '/c/x');
    expect(calls).toEqual([[-3], ['/c/x', { replace: true }]]);
  });

  it('still replaces when the pop never lands', async () => {
    vi.useFakeTimers();
    const navigate = vi.fn((to: unknown) =>
      typeof to === 'number' ? new Promise<void>(() => undefined) : Promise.resolve(),
    );
    const done = replaceWizardWith(navigate as unknown as NavigateFunction, 3, '/c/x');
    await vi.advanceTimersByTimeAsync(999);
    expect(navigate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(navigate).toHaveBeenLastCalledWith('/c/x', { replace: true });
  });
});
