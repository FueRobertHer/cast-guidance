// @vitest-environment jsdom
// The data section makes two claims a user acts on: which version is installed
// and whether the compendium is complete. Both can fail, and a failure that
// only reaches the console leaves the page asserting something untrue.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
