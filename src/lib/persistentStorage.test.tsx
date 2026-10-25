// @vitest-environment jsdom
// UX-002: the persistent-storage control reports what the browser said, and
// a browser that cannot answer, or throws, is not a crash.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePersistentStorage } from './persistentStorage';

/** jsdom has no `navigator.storage`, so each test installs the one it needs. */
function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
}

afterEach(() => {
  stubStorage(undefined);
});

describe('usePersistentStorage', () => {
  it('is unsupported without the Storage API', () => {
    stubStorage(undefined);
    const { result } = renderHook(() => usePersistentStorage());
    expect(result.current.state).toBe('unsupported');
  });

  it('reads an existing grant as persisted', async () => {
    stubStorage({ persisted: () => Promise.resolve(true) });
    const { result } = renderHook(() => usePersistentStorage());
    await waitFor(() => expect(result.current.state).toBe('persisted'));
  });

  it('is best-effort until asked, then reports the answer', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({ persisted: () => Promise.resolve(false), persist });
    const { result } = renderHook(() => usePersistentStorage());
    await waitFor(() => expect(result.current.state).toBe('best-effort'));

    await act(() => result.current.request());
    expect(persist).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('persisted');
  });

  it('reports a refusal as denied', async () => {
    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) });
    const { result } = renderHook(() => usePersistentStorage());
    await waitFor(() => expect(result.current.state).toBe('best-effort'));
    await act(() => result.current.request());
    expect(result.current.state).toBe('denied');
  });

  it('survives a rejected check and a rejected request', async () => {
    stubStorage({
      persisted: () => Promise.reject(new Error('nope')),
      persist: () => Promise.reject(new Error('nope')),
    });
    const { result } = renderHook(() => usePersistentStorage());
    await waitFor(() => expect(result.current.state).toBe('best-effort'));
    await act(() => result.current.request());
    expect(result.current.state).toBe('denied');
    expect(result.current.requesting).toBe(false);
  });
});
