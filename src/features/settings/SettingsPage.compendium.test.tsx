// @vitest-environment jsdom
// PWA-001: on a device whose first download never got anywhere, counting the
// offline compendium fails (the indexes it counts against are not there
// either), and the row read "could not be read", as if storage were broken.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => {
  class CompendiumNotDownloadedError extends Error {}
  return {
    CompendiumNotDownloadedError,
    downloadAllPacks: vi.fn(() => Promise.resolve()),
    getActiveTag: () => 'v2.32.0',
    listAvailableTags: vi.fn(() => Promise.resolve([])),
    updateToTag: vi.fn(() => Promise.resolve()),
    verifyFullOffline: vi.fn<() => Promise<{ cached: number; total: number }>>(),
  };
});

vi.mock('@/data5e/loader', () => loader);
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/db/dataCacheRepo', () => ({
  // Some bytes on disk: essentials that only partly landed still read as not
  // downloaded, so the answer cannot rest on the cache being empty.
  dataCacheRepo: { totalBytes: () => Promise.resolve(4096) },
}));
vi.mock('@/db/reset', () => ({ resetAppData: vi.fn() }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true) }));
vi.mock('./SourcesSection', () => ({ SourcesSection: () => null }));

import { dataStatusStore } from '@/stores/dataStatus';
import { Component as SettingsPage } from './SettingsPage';

afterEach(() => {
  cleanup();
  loader.verifyFullOffline.mockReset();
  dataStatusStore.setState({ phase: 'idle', error: undefined });
});

describe('SettingsPage offline compendium before the indexes land', () => {
  it('says the compendium is not downloaded yet, and offers the download', async () => {
    loader.verifyFullOffline.mockRejectedValue(new loader.CompendiumNotDownloadedError());
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<SettingsPage />);
    expect(await screen.findByText('not downloaded yet')).toBeTruthy();
    expect(screen.queryByText('could not be read')).toBeNull();
    expect(screen.getByRole('button', { name: 'Make available offline' })).toBeTruthy();
  });

  it('still says it could not be read when the count itself failed', async () => {
    loader.verifyFullOffline.mockRejectedValue(new Error('QuotaExceededError'));
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<SettingsPage />);
    expect(await screen.findByText('could not be read')).toBeTruthy();
  });
});
