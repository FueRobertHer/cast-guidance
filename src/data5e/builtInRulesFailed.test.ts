import { afterEach, describe, expect, it, vi } from 'vitest';

// A file that fails to load: a chunk the network or the cache lost.
vi.mock('../rules/cast-guidance/curated.json', () => {
  throw new Error('chunk lost');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('built-in rule sets that do not load', () => {
  it('count none, say so, and are tried again on the next call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadBuiltInRules } = await import('./builtInRules');
    const first = await loadBuiltInRules();
    expect(first).toEqual({ sets: [], failed: true });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe('The built-in rules did not load:');
    const second = await loadBuiltInRules();
    expect(second).not.toBe(first);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
