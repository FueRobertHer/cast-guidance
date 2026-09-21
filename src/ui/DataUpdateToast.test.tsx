// @vitest-environment jsdom
// The update check used to run only after the download queue had finished, and
// never after it failed, so this toast and the DataBanner could not be on screen
// together. The check runs at boot now, so the two share a fixed position at the
// same z-index with nothing but render order deciding which one the user sees.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getActiveTag, retryDataLayer, updateToTag } = vi.hoisted(() => ({
  getActiveTag: vi.fn(() => 'v2.32.0'),
  retryDataLayer: vi.fn(),
  updateToTag: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/data5e/loader', () => ({ getActiveTag, retryDataLayer, updateToTag }));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: () => undefined }));

import { dataStatusStore } from '@/stores/dataStatus';
import { DataBanner } from './DataBanner';
import { DataUpdateToast } from './DataUpdateToast';

/** Both, as AppShell mounts them, so a collision shows up as two elements. */
const renderBoth = () =>
  render(
    <>
      <DataBanner />
      <DataUpdateToast />
    </>,
  );

afterEach(() => {
  cleanup();
  updateToTag.mockClear();
  dataStatusStore.setState({
    phase: 'idle',
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
    failedTag: undefined,
    updateAvailableTag: undefined,
  });
});

describe('DataUpdateToast', () => {
  it('offers the release once the queue has nothing to say', () => {
    dataStatusStore.setState({ phase: 'done', updateAvailableTag: 'v2.33.0' });
    renderBoth();
    expect(screen.getByText(/Game data v2\.33\.0 is available/)).toBeTruthy();
  });

  it('waits while the queue is still downloading', () => {
    // Otherwise it paints over the progress bar for the length of the drain,
    // and its Update button installs a second release on top of a queue still
    // fetching under the first.
    dataStatusStore.setState({
      phase: 'working',
      filesDone: 3,
      filesTotal: 10,
      updateAvailableTag: 'v2.33.0',
    });
    renderBoth();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('waits while a failure is on screen', () => {
    // The banner's Retry sits at the same position: covering it leaves the user
    // reading about a failed download with no way to act on it.
    dataStatusStore.setState({
      phase: 'error',
      error: 'offline',
      updateAvailableTag: 'v2.33.0',
    });
    renderBoth();
    expect(screen.getByRole('alert').textContent).toContain('offline');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('appears when the queue is working but has nothing to count', () => {
    // The banner stays silent here, so the position is free.
    dataStatusStore.setState({
      phase: 'working',
      filesDone: 0,
      filesTotal: 0,
      updateAvailableTag: 'v2.33.0',
    });
    renderBoth();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/Game data v2\.33\.0 is available/)).toBeTruthy();
  });

  it('hands the position to the banner when the install starts', () => {
    dataStatusStore.setState({ phase: 'done', updateAvailableTag: 'v2.33.0' });
    renderBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(updateToTag).toHaveBeenCalledWith('v2.33.0');
    expect(dataStatusStore.getState().updateAvailableTag).toBeUndefined();
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('stays gone once dismissed', () => {
    dataStatusStore.setState({ phase: 'done', updateAvailableTag: 'v2.33.0' });
    renderBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});
