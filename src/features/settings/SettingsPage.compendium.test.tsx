// @vitest-environment jsdom
// PWA-001: on a device whose first download never got anywhere, counting the
// offline compendium fails (the indexes it counts against are not there
// either), and the row read "could not be read", as if storage were broken.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({ bytes: 0 }));

vi.mock('@/data5e/loader', () => ({
  downloadAllPacks: vi.fn(() => Promise.resolve()),
  getActiveTag: () => 'v2.32.0',
  listAvailableTags: vi.fn(() => Promise.resolve([])),
  updateToTag: vi.fn(() => Promise.resolve()),
  verifyFullOffline: () => Promise.reject(new Error('failed to fetch "class/index.json"')),
}));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/db/dataCacheRepo', () => ({
  dataCacheRepo: { totalBytes: () => Promise.resolve(cache.bytes) },
}));
vi.mock('@/db/reset', () => ({ resetAppData: vi.fn() }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true) }));
vi.mock('./SourcesSection', () => ({ SourcesSection: () => null }));

import { dataStatusStore } from '@/stores/dataStatus';
import { Component as SettingsPage } from './SettingsPage';

afterEach(() => {
  cleanup();
  cache.bytes = 0;
  dataStatusStore.setState({ phase: 'idle', error: undefined });
});

describe('SettingsPage offline compendium before any download', () => {
  it('says the compendium is not downloaded yet, and offers the download', async () => {
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<SettingsPage />);
    expect(await screen.findByText('not downloaded yet')).toBeTruthy();
    expect(screen.queryByText('could not be read')).toBeNull();
    expect(screen.getByRole('button', { name: 'Make available offline' })).toBeTruthy();
  });

  it('still says it could not be read when there is data it failed to count', async () => {
    cache.bytes = 4096;
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    render(<SettingsPage />);
    expect(await screen.findByText('could not be read')).toBeTruthy();
  });
});
