// @vitest-environment jsdom
// Presence between tabs (REL-007) over a real BroadcastChannel. Node's channel
// delivers between instances in one process, so two hooks stand in for two tabs.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, type PeerEvent, STALE_MS } from './multiTab';
import { useOpenElsewhere } from './useOpenElsewhere';

/** Raw channels a test opened to play a misbehaving tab. */
const ghosts: BroadcastChannel[] = [];

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

    await waitFor(() => {
      expect(one.result.current).toBe(true);
      expect(two.result.current).toBe(true);
    });
  });

  it('clears the warning at once when the other tab closes', async () => {
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c1'));
    await waitFor(() => expect(one.result.current).toBe(true));

    two.unmount();

    // waitFor gives up after a second, well inside STALE_MS, so only the
    // goodbye can clear it: a heartbeat would still find the peer fresh.
    expect(STALE_MS).toBeGreaterThan(1_000);
    await waitFor(() => expect(one.result.current).toBe(false));
  });

  it('ages out a tab that went silent without saying goodbye', async () => {
    // The heartbeat and the clock are faked here; message delivery stays real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const one = renderHook(() => useOpenElsewhere('c1'));
    // A tab that pings once and then crashes. A channel only hears messages
    // posted after it opens, so the first thing it hears is the hook's answer.
    const ghost = new BroadcastChannel('cast-guidance:char:c1');
    ghosts.push(ghost);
    let answered = false;
    ghost.onmessage = () => {
      answered = true;
    };
    ghost.postMessage({ type: 'ping', tabId: 'ghost', at: Date.now() } satisfies PeerEvent);
    await act(async () => {
      await vi.waitFor(() => expect(answered).toBe(true));
    });
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
  });

  it('keeps different characters apart', async () => {
    const other = renderHook(() => useOpenElsewhere('c2'));
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c1'));

    // Once the c1 pair has heard each other, c2's earlier ping has had its
    // chance to arrive too.
    await waitFor(() => {
      expect(one.result.current).toBe(true);
      expect(two.result.current).toBe(true);
    });
    expect(other.result.current).toBe(false);
  });

  it('reports nothing without a character', async () => {
    const none = renderHook(() => useOpenElsewhere(undefined));
    const alsoNone = renderHook(() => useOpenElsewhere(undefined));
    const one = renderHook(() => useOpenElsewhere('c1'));
    const two = renderHook(() => useOpenElsewhere('c1'));

    await waitFor(() => {
      expect(one.result.current).toBe(true);
      expect(two.result.current).toBe(true);
    });
    expect(none.result.current).toBe(false);
    expect(alsoNone.result.current).toBe(false);
  });
});
