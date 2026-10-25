// The batching behind DATA-003: files landing during a download are gathered,
// and consumers are told about them once per window rather than once per file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANDING_FLUSH_MS } from './config';

/** A fresh copy of the module, so counters and timers start from nothing. */
async function fresh() {
  vi.resetModules();
  const landing = await import('./landing');
  const bumps = vi.fn();
  landing.subscribeRevision(bumps);
  return { ...landing, bumps };
}

beforeEach(() => {
  // Only the timer the module sets; nothing else here depends on the clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('landing files', () => {
  it('tells consumers once per window, however many files land in it', async () => {
    const { noteFileLanded, getRevision, getLandedCount, bumps } = await fresh();

    for (let i = 0; i < 100; i++) noteFileLanded();
    expect(getLandedCount()).toBe(100);
    expect(getRevision()).toBe(0);
    expect(bumps).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LANDING_FLUSH_MS - 1);
    expect(bumps).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(bumps).toHaveBeenCalledOnce();
    expect(getRevision()).toBe(100);
  });

  it('starts the window at the first landing, not the latest', async () => {
    // A trailing timer restarted by every file would never fire while a drain
    // kept landing them, and the registry would wait for the whole download.
    const { noteFileLanded, bumps } = await fresh();

    noteFileLanded();
    vi.advanceTimersByTime(LANDING_FLUSH_MS - 10);
    noteFileLanded();
    vi.advanceTimersByTime(10);
    expect(bumps).toHaveBeenCalledOnce();
  });

  it('hands the landings over at once on a flush, and the timer then has nothing to do', async () => {
    const { noteFileLanded, flushLanded, getRevision, bumps } = await fresh();

    noteFileLanded();
    noteFileLanded();
    flushLanded();
    expect(getRevision()).toBe(2);
    expect(bumps).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(LANDING_FLUSH_MS * 2);
    expect(bumps).toHaveBeenCalledOnce();
  });

  it('does nothing on a flush with nothing landed', async () => {
    const { noteFileLanded, flushLanded, bumps } = await fresh();

    flushLanded();
    expect(bumps).not.toHaveBeenCalled();

    noteFileLanded();
    flushLanded();
    flushLanded();
    expect(bumps).toHaveBeenCalledOnce();
  });

  it('tells consumers at once when the data changed as a whole', async () => {
    const { markDataChanged, getRevision, getLandedCount, bumps } = await fresh();

    markDataChanged();
    expect(getLandedCount()).toBe(1);
    expect(getRevision()).toBe(1);
    expect(bumps).toHaveBeenCalledOnce();
  });

  it('reports every landing to its own listeners, unflushed', async () => {
    const { noteFileLanded, subscribeLanded, subscribeRevision } = await fresh();
    const landed = vi.fn();
    const off = subscribeLanded(landed);

    noteFileLanded();
    noteFileLanded();
    expect(landed).toHaveBeenCalledTimes(2);

    off();
    noteFileLanded();
    expect(landed).toHaveBeenCalledTimes(2);

    const revision = vi.fn();
    subscribeRevision(revision)();
    vi.advanceTimersByTime(LANDING_FLUSH_MS);
    expect(revision).not.toHaveBeenCalled();
  });

  it('keeps telling the rest when one listener throws', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { flushLanded, noteFileLanded, subscribeRevision, getRevision, bumps } = await fresh();
    subscribeRevision(() => {
      throw new Error('a listener came apart');
    });
    const after = vi.fn();
    subscribeRevision(after);

    noteFileLanded();
    flushLanded();
    expect(getRevision()).toBe(1);
    expect(bumps).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalled();
    reported.mockRestore();
  });
});
