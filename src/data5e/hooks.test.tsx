// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Control the registry the hook awaits.
const {
  getRegistry,
  ensureSearchIndex,
  lost,
  ensureTypePacks,
  repairTypePacks,
  invalidateRegistry,
  refreshing,
} = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  ensureSearchIndex: vi.fn(),
  ensureTypePacks: vi.fn(),
  repairTypePacks: vi.fn(),
  invalidateRegistry: vi.fn(),
  /** Stands in for the client's worker-loss subscription. */
  lost: new Set<() => void>(),
  /** Stands in for the registry module's rebuild-in-flight signal. */
  refreshing: { value: false, listeners: new Set<() => void>() },
}));

/** Move the fake signal and tell whoever subscribed, as the real one does. */
function setRefreshing(value: boolean): void {
  refreshing.value = value;
  for (const fn of [...refreshing.listeners]) fn();
}

vi.mock('./loader', () => ({ ensureTypePacks, repairTypePacks }));
vi.mock('./registry', () => ({
  getRegistry,
  ensureRegistry: getRegistry,
  registrySignature: () => 'sig',
  invalidateRegistry,
  holdRegistryRefreshing: () => () => undefined,
  isRegistryRefreshing: () => refreshing.value,
  subscribeRegistryRefreshing: (fn: () => void) => {
    refreshing.listeners.add(fn);
    return () => {
      refreshing.listeners.delete(fn);
    };
  },
}));
vi.mock('./search/client', () => ({
  ensureSearchIndex,
  onSearchIndexLost: (fn: () => void) => {
    lost.add(fn);
    return () => {
      lost.delete(fn);
    };
  },
}));

import { dataStatusStore } from '@/stores/dataStatus';
import { useRegistryRefreshing, useRegistryState, useSearchState, useTypePacks } from './hooks';

const fakeRegistry = { byType: () => [], get: () => undefined } as never;

afterEach(() => {
  // Unmount first: a hook left mounted keeps its store subscription and
  // re-runs on every later dispatch, inflating call counts in other tests.
  cleanup();
  getRegistry.mockReset();
  ensureSearchIndex.mockReset();
  ensureTypePacks.mockReset().mockResolvedValue(undefined);
  repairTypePacks.mockReset().mockResolvedValue(undefined);
  invalidateRegistry.mockReset();
  lost.clear();
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

  it('drops out of ready when the worker behind the index is lost', async () => {
    // Nothing fails at this point: the build resolved long ago. Without the
    // subscription the box keeps saying it is ready and answers nothing.
    ensureSearchIndex.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSearchState(fakeRegistry));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      for (const fn of lost) fn();
    });
    expect(result.current.status).toBe('error');

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('stops listening for that loss once it is unmounted', async () => {
    ensureSearchIndex.mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSearchState(fakeRegistry));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();
    expect(lost.size).toBe(0);
  });
});

describe('useRegistryRefreshing', () => {
  it('follows the registry module\u2019s signal', async () => {
    setRefreshing(false);
    const { result } = renderHook(() => useRegistryRefreshing());
    expect(result.current).toBe(false);

    act(() => setRefreshing(true));
    expect(result.current).toBe(true);

    act(() => setRefreshing(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useRegistryRefreshing());
    expect(refreshing.listeners.size).toBe(1);
    unmount();
    expect(refreshing.listeners.size).toBe(0);
  });

  it('is not something useRegistryState subscribes to on its behalf', async () => {
    // The whole reason this is a hook of its own. The registry rebuilds once
    // per file a background drain lands, so the flag moves hundreds of times
    // during an install, and it used to be state inside the shared hook: every
    // page reading the registry re-rendered for a value only the library looks
    // at, and `useRegistry` discarded it at ten call sites. A subscription
    // taken here is the thing that must not come back.
    getRegistry.mockResolvedValue(fakeRegistry);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useRegistryState();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(refreshing.listeners.size).toBe(0);

    const settled = renders;
    act(() => setRefreshing(true));
    act(() => setRefreshing(false));
    expect(renders).toBe(settled);
  });
});

describe('useRegistryState refresh reporting', () => {
  it('keeps the registry it has when a later rebuild fails', async () => {
    // The rebuild re-runs as downloads land. One that throws must not blank a
    // page that is rendering correctly from the registry already in hand.
    getRegistry.mockResolvedValueOnce(fakeRegistry);
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    getRegistry.mockRejectedValue(new Error('QuotaExceededError'));
    act(() => dataStatusStore.getState().fileDone());

    // Still usable, and the failure is still reported rather than swallowed:
    // the pages that cannot render without it read `error`.
    await waitFor(() => expect(result.current.error).toBe('QuotaExceededError'));
    expect(result.current.status).toBe('ready');
    expect(result.current.registry).toBe(fakeRegistry);
  });

  it('reports an error when there is no registry to fall back on', async () => {
    getRegistry.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('useTypePacks', () => {
  it('reaches ready once this type has everything it needs', async () => {
    const { result } = renderHook(() => useTypePacks('spell'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(ensureTypePacks).toHaveBeenCalledWith('spell');
    expect(result.current.error).toBeNull();
  });

  it('captures the failure the page used to drop on the floor', async () => {
    // The library started this download with a bare `void ensureTypePacks()`,
    // so a rejection had nowhere to land and the section simply stayed empty.
    ensureTypePacks.mockRejectedValue(new Error('HTTP 503'));
    const { result } = renderHook(() => useTypePacks('spell'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('HTTP 503');
    expect(result.current.offline).toBe(false);
  });

  it('marks a failure as offline when that is what it was', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    ensureTypePacks.mockRejectedValue(new Error('Failed to fetch'));
    const { result } = renderHook(() => useTypePacks('spell'));

    await waitFor(() => expect(result.current.offline).toBe(true));
    onLine.mockRestore();
  });

  it('clears the offline mark once a retry succeeds', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    ensureTypePacks.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderHook(() => useTypePacks('spell'));
    await waitFor(() => expect(result.current.offline).toBe(true));

    onLine.mockReturnValue(true);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.offline).toBe(false);
    onLine.mockRestore();
  });

  it('repairs through the re-download, not the ordinary ensure', async () => {
    const { result } = renderHook(() => useTypePacks('spell'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    ensureTypePacks.mockClear();

    act(() => result.current.repair());
    await waitFor(() => expect(repairTypePacks).toHaveBeenCalledWith('spell'));
    expect(ensureTypePacks).not.toHaveBeenCalled();
  });

  it('does not carry a repair over to the next section', async () => {
    // Navigating away mid-repair used to leave the repair flag set, because
    // the only thing that cleared it was the settle handler the unmounted run
    // skips. The next section the user opened was then re-downloaded without
    // anyone asking for it, and a re-download is destructive work.
    let settle = (): void => undefined;
    repairTypePacks.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ type }: { type: string }) => useTypePacks(type), {
      initialProps: { type: 'spell' },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.repair());
    await waitFor(() => expect(repairTypePacks).toHaveBeenCalledWith('spell'));

    // The user navigates to another section while that repair is still running.
    rerender({ type: 'item' });
    await waitFor(() => expect(ensureTypePacks).toHaveBeenCalledWith('item'));
    expect(repairTypePacks).not.toHaveBeenCalledWith('item');
    settle();
  });

  it('goes back to the ordinary ensure after a repair', async () => {
    // `repair` is one action, not a mode: leaving it on would throw the cache
    // away again on the next retry, turning a hiccup into a full re-download.
    const { result } = renderHook(() => useTypePacks('spell'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.repair());
    await waitFor(() => expect(repairTypePacks).toHaveBeenCalledOnce());

    repairTypePacks.mockClear();
    ensureTypePacks.mockClear();
    act(() => result.current.retry());
    await waitFor(() => expect(ensureTypePacks).toHaveBeenCalledOnce());
    expect(repairTypePacks).not.toHaveBeenCalled();
  });

  it('makes a repaired section visible instead of only fixing the disk', async () => {
    // A repair changes bodies and no paths, and the registry's signature is
    // built from paths: without invalidating it, the page that asked for the
    // repair goes on reading the poisoned registry and saying the entity is
    // missing until the app is reloaded.
    const onRepaired = vi.fn();
    const { result } = renderHook(() => useTypePacks('spell', onRepaired));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.repair());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(invalidateRegistry).toHaveBeenCalledOnce();
    expect(onRepaired).toHaveBeenCalledOnce();
  });

  it('does not invalidate anything for an ordinary retry', async () => {
    const onRepaired = vi.fn();
    const { result } = renderHook(() => useTypePacks('spell', onRepaired));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.retry());
    await waitFor(() => expect(ensureTypePacks).toHaveBeenCalledTimes(2));
    expect(invalidateRegistry).not.toHaveBeenCalled();
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it('still refreshes what the page reads when a repair fails part way', async () => {
    // A repair writes rows as it goes, and its `Promise.all` rejects on the
    // first failure while the siblings finish writing theirs. If only success
    // refreshed the registry, it would be left serving bodies that are no
    // longer on disk, and no retry could dislodge it: nothing is missing, so
    // the retry fetches nothing and the signature never changes.
    const onRepaired = vi.fn();
    const { result } = renderHook(() => useTypePacks('spell', onRepaired));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    repairTypePacks.mockRejectedValue(new Error('HTTP 503'));
    act(() => result.current.repair());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(invalidateRegistry).toHaveBeenCalledOnce();
    expect(onRepaired).toHaveBeenCalledOnce();
  });

  it('treats a repair as one press, not a standing mode', async () => {
    // Returning to a section you repaired re-entered the effect with the same
    // attempt still asking for a repair, so a back-button press re-downloaded
    // the whole section.
    const { result, rerender } = renderHook(({ type }: { type: string }) => useTypePacks(type), {
      initialProps: { type: 'spell' },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.repair());
    await waitFor(() => expect(repairTypePacks).toHaveBeenCalledOnce());

    rerender({ type: 'item' });
    await waitFor(() => expect(ensureTypePacks).toHaveBeenCalledWith('item'));
    rerender({ type: 'spell' });
    await waitFor(() => expect(ensureTypePacks).toHaveBeenCalledTimes(3));

    expect(repairTypePacks).toHaveBeenCalledOnce();
  });

  it('asks for nothing at all without a type', async () => {
    const { result } = renderHook(() => useTypePacks(undefined));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(ensureTypePacks).not.toHaveBeenCalled();
  });
});
