/**
 * Multi-tab presence for a single character (REL-007). Each open sheet
 * heartbeats on a per-character BroadcastChannel; when two tabs have the same
 * character open, both show a non-blocking warning so a save in one tab can't
 * silently clobber an edit in the other. Guidance, not a hard lock.
 *
 * Presence is tracked with last-seen timestamps and a staleness window, so a
 * tab that closes (or crashes) ages out even if its best-effort `bye` is lost —
 * no reliance on a delivered close message.
 */

export type PeerEvent =
  | { type: 'ping'; tabId: string; at: number }
  | { type: 'bye'; tabId: string; at: number };

/** Broadcast a `ping` at least this often so peers stay fresh. */
export const HEARTBEAT_MS = 2000;
/** Drop a peer not heard from within this window. */
export const STALE_MS = 6000;

/**
 * Pure: fold a received peer event into the last-seen map. Events from self are
 * ignored; `ping` records freshness, `bye` removes the peer. Returns a new map.
 */
export function applyPeerEvent(
  peers: ReadonlyMap<string, number>,
  event: PeerEvent,
  selfId: string,
): Map<string, number> {
  const next = new Map(peers);
  if (event.tabId === selfId) return next;
  if (event.type === 'bye') next.delete(event.tabId);
  else next.set(event.tabId, event.at);
  return next;
}

/** Pure: peers seen within the staleness window, given the current time. */
export function activePeerCount(
  peers: ReadonlyMap<string, number>,
  now: number,
  staleMs: number = STALE_MS,
): number {
  let count = 0;
  for (const lastSeen of peers.values()) if (now - lastSeen <= staleMs) count += 1;
  return count;
}
