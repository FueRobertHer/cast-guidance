// @vitest-environment jsdom
// PWA-001: the panel a list shows when the one download it reads failed. Two
// cases the callers' own tests do not reach: a database another tab closed,
// which no Retry can fix, and a panel inside a modal sheet, where the shell's
// banner is hidden and cannot speak for it.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TypePacksState } from '@/data5e/hooks';
import { dataStatusStore } from '@/stores/dataStatus';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { PackProblem } from './PackProblem';

const failed = (retry: () => void): TypePacksState => ({
  status: 'error',
  error: 'Failed to fetch',
  offline: true,
  retry,
  repair: () => undefined,
});

const OFFLINE = "You're offline, so the spell list can't be downloaded yet.";

/** The banner alerting the stopped download, as it does offline. */
const bannerAlerts = () => dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });

afterEach(() => {
  cleanup();
  dataStatusStore.setState({ phase: 'idle', error: undefined, failedTag: undefined });
  dbLifecycleStore.setState({ state: 'open' });
});

describe('PackProblem', () => {
  it('asks for a reload, not a Retry, once another tab closed the database', () => {
    dbLifecycleStore.setState({ state: 'deleted' });
    const retry = vi.fn();
    render(<PackProblem packs={failed(retry)} what="the spell list" />);
    expect(screen.getByText('Reload this tab to load the spell list.')).toBeTruthy();
    expect(screen.queryByText(OFFLINE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // Back online, a retry would only fail again with "Database has been closed".
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).not.toHaveBeenCalled();
    // Outside a modal the database banner says it; this line is a visual.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for the reload as the alert inside a modal, where the banner is hidden', () => {
    dbLifecycleStore.setState({ state: 'deleted' });
    render(<PackProblem packs={failed(vi.fn())} what="the spell list" alert="always" />);
    expect(screen.getByRole('alert').textContent).toBe('Reload this tab to load the spell list.');
  });

  it('says a failure in its own words when given them', () => {
    render(
      <PackProblem
        packs={failed(vi.fn())}
        what="the class spell lists"
        message="The class spell lists couldn't be read on this device."
      />,
    );
    expect(screen.getByText("The class spell lists couldn't be read on this device.")).toBeTruthy();
    expect(screen.queryByText(/offline/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('is a visual while the banner alerts the outage', () => {
    bannerAlerts();
    render(<PackProblem packs={failed(vi.fn())} what="the spell list" />);
    expect(screen.getByText(OFFLINE).parentElement?.getAttribute('role')).toBeNull();
  });

  it('is the alert inside a modal, where the banner cannot be heard', () => {
    bannerAlerts();
    render(<PackProblem packs={failed(vi.fn())} what="the spell list" alert="always" />);
    expect(screen.getByRole('alert').textContent).toContain(OFFLINE);
  });

  it('puts the id on its message, for a dialog to be described by', () => {
    render(<PackProblem packs={failed(vi.fn())} what="the spell list" messageId="why" />);
    expect(document.getElementById('why')?.textContent).toBe(OFFLINE);
  });
});
