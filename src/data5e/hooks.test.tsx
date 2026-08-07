// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Control the registry the hook awaits.
const { getRegistry, ensureSearchIndex } = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  ensureSearchIndex: vi.fn(),
}));
vi.mock('./registry', () => ({
  getRegistry,
  ensureRegistry: getRegistry,
  registrySignature: () => 'sig',
  invalidateRegistry: () => undefined,
}));
vi.mock('./search/client', () => ({ ensureSearchIndex }));

import { dataStatusStore } from '@/stores/dataStatus';
import { useRegistryState, useSearchState } from './hooks';

const fakeRegistry = { byType: () => [], get: () => undefined } as never;

afterEach(() => {
  // Unmount first: a hook left mounted keeps its store subscription and
  // re-runs on every later dispatch, inflating call counts in other tests.
  cleanup();
  getRegistry.mockReset();
  ensureSearchIndex.mockReset();
  dataStatusStore.setState({ packs: {}, filesDone: 0, filesTotal: 0, phase: 'idle' });
});

describe('useRegistryState', () => {
  it('reaches ready with the resolved registry', async () => {
    getRegistry.mockResolvedValue(fakeRegistry);
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.registry).toBe(fakeRegistry);
    expect(result.current.error).toBeNull();
  });

  it('captures a failure as an error status with the message', async () => {
    getRegistry.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('offline');
  });

  it('recovers when retry() succeeds after a failure', async () => {
    getRegistry.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('error'));

    getRegistry.mockResolvedValue(fakeRegistry);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
    expect(result.current.registry).toBe(fakeRegistry);
  });
});

describe('useRegistryState refresh triggers', () => {
  it('rebuilds as the drain reports progress', async () => {
    getRegistry.mockResolvedValue(fakeRegistry);
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getRegistry).toHaveBeenCalledTimes(1);

    act(() => dataStatusStore.getState().fileDone());
    await waitFor(() => expect(getRegistry).toHaveBeenCalledTimes(2));
  });

  it('ignores pack state changes, which never add anything to read', async () => {
    // Files only reach IndexedDB through a fetch that already ticks filesDone,
    // so refreshing on pack readiness would re-read the entire cached
    // compendium (~30 packs x every mounted consumer) to find nothing new.
    getRegistry.mockResolvedValue(fakeRegistry);
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => dataStatusStore.getState().setPack('items-full', 'downloading'));
    act(() => dataStatusStore.getState().setPack('items-full', 'ready'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getRegistry).toHaveBeenCalledTimes(1);
  });
});

describe('useSearchState', () => {
  it('stays idle with a null registry', () => {
    const { result } = renderHook(() => useSearchState(null));
    expect(result.current.status).toBe('idle');
    expect(ensureSearchIndex).not.toHaveBeenCalled();
  });

  it('builds to ready when the index resolves', async () => {
    ensureSearchIndex.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSearchState(fakeRegistry));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
  });

  it('surfaces a build failure and recovers on retry', async () => {
    ensureSearchIndex.mockRejectedValueOnce(new Error('worker died'));
    const { result } = renderHook(() => useSearchState(fakeRegistry));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('worker died');

    ensureSearchIndex.mockResolvedValue(undefined);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
