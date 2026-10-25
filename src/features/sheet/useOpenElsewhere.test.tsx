// @vitest-environment jsdom
// Presence between tabs (REL-007) over a real BroadcastChannel. Node's channel
// delivers between instances in one process, so two hooks stand in for two tabs.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, type PeerEvent, STALE_MS } from './multiTab';
import { useOpenElsewhere } from './useOpenElsewhere';

/** Let queued channel messages arrive, using the real timer the fakes leave alone. */
async function deliver(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** Raw channels a test opened to play a misbehaving tab. */
const ghosts: BroadcastChannel[] = [];

beforeEach(() => {
  // Only the heartbeat and the clock are faked; message delivery stays real.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  // Close every hook's channel even when a test fails, so no tab leaks into the next test.
  cleanup();
  for (const channel of ghosts.splice(0)) channel.close();
  vi.useRealTimers();
});

describe('useOpenElsewhere', () => {
  it('runs against the real BroadcastChannel', () => {
    expect(typeof BroadcastChannel).toBe('function');
  });

  it('reports two tabs on the same character to each other', async () => {
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c1'));
    await deliver();

    expect(one.result.current).toBe(true);
    expect(two.result.current).toBe(true);
    one.unmount();
    two.unmount();
  });

  it('clears the warning at once when the other tab closes', async () => {
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c1'));
    await deliver();
    expect(one.result.current).toBe(true);

    two.unmount();
    await deliver();

    // No heartbeat has run: the goodbye alone cleared it.
    expect(one.result.current).toBe(false);
    one.unmount();
  });

  it('ages out a tab that went silent without saying goodbye', async () => {
    const one = renderHook(() => useOpenElsewhere('c1'));
    // A tab that pings once and then crashes.
    const ghost = new BroadcastChannel('cast-guidance:char:c1');
    ghosts.push(ghost);
    ghost.postMessage({ type: 'ping', tabId: 'ghost', at: Date.now() } satisfies PeerEvent);
    await deliver();
    expect(one.result.current).toBe(true);

    // Still fresh after one beat.
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(one.result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(STALE_MS);
    });
    expect(one.result.current).toBe(false);
    one.unmount();
  });

  it('keeps different characters apart', async () => {
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c2'));
    await deliver();

    expect(one.result.current).toBe(false);
    expect(two.result.current).toBe(false);
    one.unmount();
    two.unmount();
  });

  it('reports nothing without a character', async () => {
    const one = renderHook(() => useOpenElsewhere(undefined));
    const two = renderHook(() => useOpenElsewhere(undefined));
    await deliver();

    expect(one.result.current).toBe(false);
    expect(two.result.current).toBe(false);
    one.unmount();
    two.unmount();
  });
});
