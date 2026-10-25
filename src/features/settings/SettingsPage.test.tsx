// @vitest-environment jsdom
// The data section makes two claims a user acts on: which version is installed
// and whether the compendium is complete. Both can fail, and a failure that
// only reaches the console leaves the page asserting something untrue.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({
  downloadAllPacks: vi.fn(() => Promise.resolve()),
  getActiveTag: vi.fn(() => 'v2.32.0'),
  listAvailableTags: vi.fn(() => Promise.resolve(['v2.33.0', 'v2.32.0'])),
  updateToTag: vi.fn(() => Promise.resolve()),
  verifyFullOffline: vi.fn(() => Promise.resolve({ cached: 31, total: 48 })),
}));

vi.mock('@/data5e/loader', () => loader);
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/db/dataCacheRepo', () => ({
  dataCacheRepo: { totalBytes: () => Promise.resolve(0) },
}));
vi.mock('@/db/reset', () => ({ resetAppData: vi.fn() }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true) }));
vi.mock('./SourcesSection', () => ({ SourcesSection: () => null }));

import { flushLanded, noteFileLanded } from '@/data5e/landing';
import { QUOTA_GUIDANCE } from '@/lib/storageErrors';
import { dataStatusStore } from '@/stores/dataStatus';
import { onboardingStore } from '@/stores/onboarding';
import { quotaExceeded } from '../../../tests-fixtures/idbFaults';
import { Component as SettingsPage } from './SettingsPage';

/** Walk the version picker as a user does, up to the install attempt. */
async function installVersion(tag: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Check for data updates' }));
  const select = await screen.findByLabelText('Switch version');
  fireEvent.change(select, { target: { value: tag } });
}

afterEach(() => {
  cleanup();
  for (const fn of Object.values(loader)) fn.mockClear();
  loader.updateToTag.mockResolvedValue(undefined);
  loader.downloadAllPacks.mockResolvedValue(undefined);
  loader.verifyFullOffline.mockResolvedValue({ cached: 31, total: 48 });
  dataStatusStore.setState({ rolledBackFrom: undefined, phase: 'idle' });
});

describe('SettingsPage data section', () => {
  it('offers to retry the install that failed, without asking again', async () => {
    loader.updateToTag.mockRejectedValueOnce(new Error('HTTP 500'));
    render(<SettingsPage />);
    await installVersion('v2.33.0');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 500');
    // The old version is still the one in use, and the page says so.
    expect(alert.textContent).toContain('current version is untouched');

    fireEvent.click(screen.getByRole('button', { name: 'Retry install' }));
    await waitFor(() => expect(loader.updateToTag).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/Now on v2\.33\.0/)).toBeTruthy();
  });

  it('gives the incomplete offline compendium a control that completes it', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    await waitFor(() => expect(loader.downloadAllPacks).toHaveBeenCalledOnce());
    // Once every file is cached the claim is true, so the control retires.
    await waitFor(() => expect(screen.queryByText('31/48 files')).toBeNull());
    expect(screen.getByText('ready ✓')).toBeTruthy();
  });

  it('counts the compendium again when the background download finishes', async () => {
    // Opened mid-drain: the count on mount is a snapshot of a moving target.
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    act(() => dataStatusStore.getState().setPhase('done'));
    expect(await screen.findByText('ready ✓')).toBeTruthy();
  });

  it('counts the compendium again as downloaded files land', async () => {
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 40, total: 48 });
    act(() => {
      noteFileLanded();
      flushLanded();
    });
    expect(await screen.findByText('40/48 files')).toBeTruthy();
  });

  it('keeps the newest count when an older one resolves after it', async () => {
    let finishFirst: (v: { cached: number; total: number }) => void = () => undefined;
    loader.verifyFullOffline.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    act(() => dataStatusStore.getState().setPhase('done'));
    expect(await screen.findByText('ready ✓')).toBeTruthy();

    // The mount's count, taken before the drain finished, arrives last.
    await act(async () => finishFirst({ cached: 13, total: 48 }));
    expect(screen.getByText('ready ✓')).toBeTruthy();
    expect(screen.queryByText('13/48 files')).toBeNull();
  });

  it('says the offline inventory could not be read, and still offers the download', async () => {
    // "…" forever with no error and no control is the dead end this replaces.
    loader.verifyFullOffline.mockRejectedValue(new Error('offline'));
    render(<SettingsPage />);

    expect(await screen.findByText('could not be read')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make available offline' })).toBeTruthy();
  });

  it('announces a failure to list versions as a failure', async () => {
    loader.listAvailableTags.mockRejectedValueOnce(new Error('rate limited'));
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Check for data updates' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not list versions');
    // Nothing to retry an install of, so the only affordance is the check again.
    expect(screen.queryByRole('button', { name: 'Retry install' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check for data updates' })).toBeTruthy();
  });

  it('reports a failed download and turns the same control into a retry', async () => {
    loader.downloadAllPacks.mockRejectedValueOnce(new Error('offline'));
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    await waitFor(() => expect(loader.downloadAllPacks).toHaveBeenCalledTimes(2));
  });

  // Both failures are shown as text, so a full device is told what to do
  // rather than "The quota has been exceeded." (TEST-002).
  it('words a failed install on a full device as guidance', async () => {
    loader.updateToTag.mockRejectedValueOnce(quotaExceeded());
    render(<SettingsPage />);
    await installVersion('v2.33.0');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(QUOTA_GUIDANCE);
    expect(alert.textContent).not.toContain('quota has been exceeded');
  });

  it('words a failed download on a full device as guidance', async () => {
    loader.downloadAllPacks.mockRejectedValueOnce(quotaExceeded());
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(QUOTA_GUIDANCE);
    expect(alert.textContent).not.toContain('quota has been exceeded');
  });

  it('says when the installed version is one the app went back to', () => {
    // The banner can be dismissed; the version line is where someone looking
    // for why their update is gone will look next.
    dataStatusStore.setState({ rolledBackFrom: 'v2.33.0' });
    render(<SettingsPage />);
    expect(screen.getByText(/went back from v2\.33\.0, which could not start/)).toBeTruthy();
  });
});

describe('SettingsPage data and privacy', () => {
  afterEach(() => {
    onboardingStore.setState({ dismissed: false });
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('brings the getting-started guide back and says where it went', () => {
    // UX-002: reopened in place, with no navigation and no focus jump.
    onboardingStore.setState({ dismissed: true });
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the getting-started guide' }));
    expect(onboardingStore.getState().dismissed).toBe(false);
    expect(screen.getByText('Shown on the Characters page.')).toBeTruthy();
  });

  it('shows whether storage is persistent and asks from a click', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: () => Promise.resolve(false), persist },
      configurable: true,
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Not protected yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the browser to keep my data' }));
    expect(await screen.findByText('Protected')).toBeTruthy();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('keeps focus on the ask while it runs, then moves it to the answer', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) },
      configurable: true,
    });
    render(<SettingsPage />);
    const ask = await screen.findByRole('button', { name: 'Ask the browser to keep my data' });
    ask.focus();
    fireEvent.click(ask);
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.hasAttribute('disabled')).toBe(false);
    const status = await screen.findByText('Not protected');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });
});
