import { useEffect, useState } from 'react';
import { activePeerCount, applyPeerEvent, HEARTBEAT_MS, type PeerEvent } from './multiTab';

/**
 * True while the same character is open in another tab/window (REL-007), via a
 * per-character BroadcastChannel heartbeat. Used to warn that concurrent edits
 * can overwrite each other. Peers age out by staleness, so a closed/crashed tab
 * clears the warning even if its `bye` is never delivered. No-op where
 * BroadcastChannel is unavailable (returns false).
 */
export function useOpenElsewhere(charId: string | undefined): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (charId === undefined || typeof BroadcastChannel === 'undefined') return;
    const selfId = crypto.randomUUID();
    const channel = new BroadcastChannel(`cast-guidance:char:${charId}`);
    let peers = new Map<string, number>();

    const recompute = () => setActive(activePeerCount(peers, Date.now()) > 0);
    const ping = () =>
      channel.postMessage({ type: 'ping', tabId: selfId, at: Date.now() } satisfies PeerEvent);
    const bye = () =>
      channel.postMessage({ type: 'bye', tabId: selfId, at: Date.now() } satisfies PeerEvent);

    channel.onmessage = (e: MessageEvent<PeerEvent>) => {
      const ev = e.data;
      if (ev.tabId === selfId) return;
      const isNew = !peers.has(ev.tabId);
      // Stamp with the receiver's clock so staleness is skew-free (same machine).
      peers = applyPeerEvent(peers, { ...ev, at: Date.now() }, selfId);
      // Answer a newcomer's first ping so it learns of us without waiting a beat.
      if (ev.type === 'ping' && isNew) ping();
      recompute();
    };

    ping();
    const beat = setInterval(() => {
      ping();
      recompute(); // re-evaluate so a peer gone silent ages out of the warning
    }, HEARTBEAT_MS);
    window.addEventListener('pagehide', bye);

    return () => {
      clearInterval(beat);
      bye();
      window.removeEventListener('pagehide', bye);
      channel.close();
    };
  }, [charId]);

  return active;
}
