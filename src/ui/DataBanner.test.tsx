// @vitest-environment jsdom
// The boot routine flips `phase` to 'working' before it knows whether there is
// anything to download, and leaves it there until the whole pack queue drains.
// On an installed PWA that meant ~1.2s of "Downloading game data… 0/0" for a
// download that had already happened, so the banner is gated on real work.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { retryDataLayer, updateToTag } = vi.hoisted(() => ({
  retryDataLayer: vi.fn(),
  updateToTag: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/data5e/loader', () => ({ retryDataLayer, updateToTag }));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: () => undefined }));

import { dataStatusStore } from '@/stores/dataStatus';
import { DataBanner } from './DataBanner';

afterEach(() => {
  cleanup();
  retryDataLayer.mockClear();
  updateToTag.mockClear();
  dataStatusStore.setState({
    phase: 'idle',
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
    failedTag: undefined,
  });
});

describe('DataBanner', () => {
  it('stays silent while working with nothing to fetch', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 0, filesTotal: 0 });
    render(<DataBanner />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('appears as soon as there are files to count', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 3, filesTotal: 10 });
    render(<DataBanner />);
    const bar = screen.getByRole('progressbar');
    expect(bar.textContent).toContain('3/10');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
  });

  it('stays silent once the queue is done', () => {
    dataStatusStore.setState({ phase: 'done', filesDone: 10, filesTotal: 10 });
    render(<DataBanner />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reports a failure even though no files were counted', () => {
    // The error path must not inherit the work gate: a download that failed
    // before addTotal ran is exactly when the user needs the retry.
    dataStatusStore.setState({ phase: 'error', filesTotal: 0, error: 'offline' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryDataLayer).toHaveBeenCalledOnce();
  });

  it('retries the version install that failed, not the background queue', () => {
    // Re-arming the queue here downloads what is missing of the *current*
    // version and reports success, leaving the update undone.
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 500', failedTag: 'v2.33.0' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Update to v2.33.0 failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(updateToTag).toHaveBeenCalledWith('v2.33.0');
    expect(retryDataLayer).not.toHaveBeenCalled();
  });
});
