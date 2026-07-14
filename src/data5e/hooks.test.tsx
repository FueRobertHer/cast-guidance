// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Control the registry the hook awaits.
const { getRegistry } = vi.hoisted(() => ({ getRegistry: vi.fn() }));
vi.mock('./registry', () => ({
  getRegistry,
  ensureRegistry: getRegistry,
  registrySignature: () => 'sig',
  invalidateRegistry: () => undefined,
}));

import { useRegistryState } from './hooks';

const fakeRegistry = { byType: () => [], get: () => undefined } as never;

afterEach(() => getRegistry.mockReset());

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
