import { describe, expect, it } from 'vitest';
import { activePeerCount, applyPeerEvent, type PeerEvent } from './multiTab';

const self = 'me';

describe('applyPeerEvent', () => {
  it('records a peer on ping and refreshes its timestamp', () => {
    let peers = applyPeerEvent(new Map(), { type: 'ping', tabId: 'a', at: 100 }, self);
    expect(peers.get('a')).toBe(100);
    peers = applyPeerEvent(peers, { type: 'ping', tabId: 'a', at: 250 }, self);
    expect(peers.get('a')).toBe(250);
  });

  it('removes a peer on bye', () => {
    const start = new Map([['a', 100]]);
    expect(applyPeerEvent(start, { type: 'bye', tabId: 'a', at: 200 }, self).has('a')).toBe(false);
  });

  it('ignores events from self', () => {
    const start = new Map([['a', 100]]);
    for (const type of ['ping', 'bye'] as const) {
      const ev = { type, tabId: self, at: 300 } as PeerEvent;
      expect(applyPeerEvent(start, ev, self)).toEqual(start);
    }
  });

  it('does not mutate the input map', () => {
    const start = new Map([['a', 100]]);
    applyPeerEvent(start, { type: 'ping', tabId: 'b', at: 200 }, self);
    expect([...start.keys()]).toEqual(['a']);
  });
});

describe('activePeerCount', () => {
  it('counts only peers within the staleness window', () => {
    const peers = new Map([
      ['fresh', 9500],
      ['stale', 1000],
    ]);
    expect(activePeerCount(peers, 10_000, 6000)).toBe(1);
  });

  it('is zero for an empty or fully-stale map', () => {
    expect(activePeerCount(new Map(), 10_000, 6000)).toBe(0);
    expect(activePeerCount(new Map([['a', 0]]), 10_000, 6000)).toBe(0);
  });
});
