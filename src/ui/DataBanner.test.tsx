// @vitest-environment jsdom
// The boot routine flips `phase` to 'working' before it knows whether there is
// anything to download, and leaves it there until the whole pack queue drains.
// On an installed PWA that meant ~1.2s of "Downloading game data… 0/0" for a
// download that had already happened, so the banner is gated on real work.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { dismissRollbackNotice, retryDataLayer, updateToTag } = vi.hoisted(() => ({
  dismissRollbackNotice: vi.fn(() => Promise.resolve()),
  retryDataLayer: vi.fn(),
  updateToTag: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/data5e/loader', () => ({
  dismissRollbackNotice,
  getActiveTag: () => 'v2.32.0',
  retryDataLayer,
  updateToTag,
}));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: () => undefined }));

import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import { DataBanner, isNetworkFailure } from './DataBanner';

/** Every line the announcer has said so far. */
const spoken = () => getAnnouncerState().messages.map((m) => m.text);

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
  retryDataLayer.mockClear();
  updateToTag.mockClear();
  dismissRollbackNotice.mockClear();
  dataStatusStore.setState({
    phase: 'idle',
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
    failedTag: undefined,
    rolledBackFrom: undefined,
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

  it('never counts past the total it is counting towards', () => {
    // The counters are shared and a new run resets them, so a run that began
    // earlier can tick past the total of the one that replaced it. Only the
    // bar was clamped, which left the text reading "13/5" and a screen reader
    // announcing "13 of 5 files" for a download that had fetched nothing.
    dataStatusStore.setState({ phase: 'working', filesDone: 13, filesTotal: 5 });
    render(<DataBanner />);

    const bar = screen.getByRole('progressbar');
    expect(bar.textContent).toContain('5/5');
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('5 of 5 files');
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

  it('says the device is offline instead of the fetch error, and keeps Retry', () => {
    // PWA-001: offline, the error is a list of mirror URLs that each "failed
    // to fetch". The reason, and the remedy, is the network.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    dataStatusStore.setState({
      phase: 'error',
      error: 'failed to fetch "races.json": https://cdn.jsdelivr.net/... -> Failed to fetch',
    });
    render(<DataBanner />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      "You're offline, so the game data download can't finish yet. It picks up by itself once you're back online.",
    );
    expect(alert.textContent).not.toContain('Failed to fetch');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryDataLayer).toHaveBeenCalledOnce();
  });

  it('keeps a reason of its own visible offline instead of blaming the network', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    dataStatusStore.setState({ phase: 'error', error: 'QuotaExceededError: storage is full' });
    render(<DataBanner />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Game data download failed: QuotaExceededError');
    expect(alert.textContent).not.toContain("You're offline");
  });

  it('says an install cannot finish offline, and still retries that install', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch', failedTag: 'v2.33.0' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain(
      "You're offline, so the update to v2.33.0 can't install yet.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(updateToTag).toHaveBeenCalledWith('v2.33.0');
  });

  it('goes back to the failure itself once the device is online again', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain("You're offline");
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Game data download failed: Failed to fetch',
    );
  });

  it('picks the download back up by itself once the device is online again', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<DataBanner />);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retryDataLayer).toHaveBeenCalledOnce();
  });

  it('leaves a failed version install to its own Retry when the network returns', () => {
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch', failedTag: 'v2.33.0' });
    render(<DataBanner />);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retryDataLayer).not.toHaveBeenCalled();
    expect(updateToTag).not.toHaveBeenCalled();
  });

  it('says why the version went backwards, over the drain that follows', () => {
    // A rollback is not an error: the app works, on the older release. But it
    // is the one change here nobody asked for, so it outranks the progress bar
    // of the boot it happened in, until the user has seen it.
    dataStatusStore.setState({
      phase: 'working',
      filesDone: 1,
      filesTotal: 4,
      rolledBackFrom: 'v2.33.0',
    });
    render(<DataBanner />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(
      screen.getByText('Game data v2.33.0 could not start, so the app went back to v2.32.0.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Dismissing is remembered by the loader; the store follows it.
    expect(dismissRollbackNotice).toHaveBeenCalledOnce();
    act(() => dataStatusStore.getState().setRolledBackFrom(undefined));
    expect(screen.getByRole('progressbar').textContent).toContain('1/4');
  });

  it('says so even once the queue has finished', () => {
    dataStatusStore.setState({ phase: 'done', rolledBackFrom: 'v2.33.0' });
    render(<DataBanner />);
    expect(screen.getByText(/v2\.33\.0 could not start/)).toBeTruthy();
  });
});

// A11Y-002: restrained announcements. The bar is real progress semantics a
// reader can query, never a live region, so a drain is not one line per file.
describe('DataBanner announcements', () => {
  it('reports progress as a progressbar value and says nothing per file', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 0, filesTotal: 48 });
    render(<DataBanner />);
    for (let done = 1; done <= 48; done++) {
      act(() => dataStatusStore.setState({ filesDone: done }));
    }
    const bar = screen.getByRole('progressbar', { name: 'Downloading game data' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('48');
    expect(bar.getAttribute('aria-valuenow')).toBe('48');
    expect(bar.getAttribute('aria-valuetext')).toBe('48 of 48 files');
    // Not a region that would speak each change on its own.
    expect(bar.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('says a rollback once, through the announcer, with no region of its own', () => {
    dataStatusStore.setState({ phase: 'done', rolledBackFrom: 'v2.33.0' });
    const { rerender } = render(<DataBanner />);
    rerender(<DataBanner />);
    act(() => dataStatusStore.setState({ filesDone: 3 }));
    expect(spoken()).toEqual([
      'Game data v2.33.0 could not start, so the app went back to v2.32.0.',
    ]);
    const notice = screen.getByText(/could not start/);
    expect(notice.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });

  it('leaves a failure to its alert, which is inserted once', () => {
    dataStatusStore.setState({ phase: 'error', error: 'offline' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain('offline');
    expect(getAnnouncerState().emitted).toBe(0);
  });
});

describe('isNetworkFailure', () => {
  it("knows each browser's fetch failure and the source's offline note", () => {
    for (const error of [
      'failed to fetch "races.json": https://x -> Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'failed to fetch "races.json": the device is offline',
      'TimeoutError: signal timed out',
    ]) {
      expect(isNetworkFailure(error), error).toBe(true);
    }
  });

  it('leaves reasons of their own alone', () => {
    for (const error of ['QuotaExceededError', 'HTTP 503', '"races.json" failed validation']) {
      expect(isNetworkFailure(error), error).toBe(false);
    }
  });
});
