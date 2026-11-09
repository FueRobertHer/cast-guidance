import { afterEach, describe, expect, it, vi } from 'vitest';
import { freeStorage } from './storageRoom';

function storage(estimate: () => Promise<StorageEstimate>) {
  vi.stubGlobal('navigator', { storage: { estimate } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('freeStorage', () => {
  it('is the quota less what is used, never below nothing', async () => {
    storage(async () => ({ usage: 30, quota: 100 }));
    expect(await freeStorage()).toBe(70);
    storage(async () => ({ usage: 130, quota: 100 }));
    expect(await freeStorage()).toBe(0);
  });

  it('cannot say without the Storage API, a working estimate, or real numbers', async () => {
    vi.stubGlobal('navigator', {});
    expect(await freeStorage()).toBeUndefined();
    storage(() => Promise.reject(new Error('no')));
    expect(await freeStorage()).toBeUndefined();
    storage(async () => ({ quota: 100 }));
    expect(await freeStorage()).toBeUndefined();
    storage(async () => ({ usage: 1, quota: Number.POSITIVE_INFINITY }));
    expect(await freeStorage()).toBeUndefined();
    storage(async () => ({ usage: 0, quota: 0 }));
    expect(await freeStorage()).toBeUndefined();
  });
});
