import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * The one way the app speaks to a screen reader without moving focus (A11Y-002).
 *
 * Text added to a live region that mounts with it is announced unreliably, so
 * a toast that renders `role="status"` the moment it appears may say nothing
 * at all, or say it twice. `LiveAnnouncer` keeps two regions mounted from boot
 * and this store feeds them, which is the pattern every screen reader handles.
 *
 * Restraint is the point (#113): over-announcing during a drain or a run of HP
 * taps is worse than silence. So each message has a key, and per key:
 *
 * - **De-duplication.** The same text again within {@link DEDUPE_MS} of the
 *   last time it was said is dropped, so a component that re-renders, or a
 *   state that is reported twice, is heard once. Events that really happen
 *   twice with the same words (two identical dice results) pass `repeat`.
 * - **Throttle.** A key speaks at most once per {@link THROTTLE_MS}. A message
 *   inside the window waits for its end, and a later one with the same key
 *   replaces it, so a burst is heard as its first and last messages only.
 * - **Settle.** `settleMs` holds a message back until the key has been quiet
 *   that long, for values that change in runs.
 * - **Politeness.** Assertive messages skip the throttle and the settle (they
 *   are failures that need hearing now). De-duplication still applies.
 */
export type Politeness = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** Groups messages about one thing. Defaults to the text itself. */
  key?: string;
  politeness?: Politeness;
  /** Wait until this key has been quiet this long before speaking. */
  settleMs?: number;
  /** Speak even when the same words were just said: a new event, not a repeat. */
  repeat?: boolean;
}

export interface Announcement {
  id: number;
  text: string;
  politeness: Politeness;
}

export interface AnnouncerState {
  /** What the regions hold now; each line leaves after {@link CLEAR_MS}. */
  messages: Announcement[];
  /** Every message ever spoken, in order. For tests and diagnostics. */
  emitted: number;
}

/** Identical text for a key inside this window is dropped. */
export const DEDUPE_MS = 3000;
/** A key speaks at most once per window. */
export const THROTTLE_MS = 1000;
/**
 * How long a spoken line stays in its region. Long enough for a slow reader to
 * reach it, short enough that the region does not grow without end. Removal
 * is not announced (`aria-relevant="additions"`).
 */
export const CLEAR_MS = 7000;

interface Slot {
  lastText?: string;
  lastAt: number;
  pending?: ReturnType<typeof setTimeout>;
}

export const announcerStore = createStore<AnnouncerState>(() => ({ messages: [], emitted: 0 }));

const slots = new Map<string, Slot>();
const removals = new Set<ReturnType<typeof setTimeout>>();
let nextId = 1;

function emit(key: string, text: string, politeness: Politeness): void {
  const slot = slots.get(key) ?? { lastAt: Number.NEGATIVE_INFINITY };
  const spokenAt = Date.now();
  slot.lastText = text;
  slot.lastAt = spokenAt;
  slots.set(key, slot);
  const id = nextId++;
  announcerStore.setState((s) => ({
    messages: [...s.messages, { id, text, politeness }],
    emitted: s.emitted + 1,
  }));
  const removal = setTimeout(() => {
    removals.delete(removal);
    announcerStore.setState((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
    // Forget a key nobody has used since, so per-event keys do not pile up.
    const current = slots.get(key);
    if (current !== undefined && current.pending === undefined && current.lastAt === spokenAt)
      slots.delete(key);
  }, CLEAR_MS);
  removals.add(removal);
}

/** Say `text` to a screen reader, within the rules above. */
export function announce(text: string, options: AnnounceOptions = {}): void {
  const words = text.trim();
  if (words === '') return;
  const key = options.key ?? words;
  const politeness = options.politeness ?? 'polite';
  const now = Date.now();
  const slot = slots.get(key) ?? { lastAt: Number.NEGATIVE_INFINITY };
  slots.set(key, slot);

  // A newer message about the same thing supersedes one still waiting.
  clearTimeout(slot.pending);
  slot.pending = undefined;

  if (options.repeat !== true && slot.lastText === words && now - slot.lastAt < DEDUPE_MS) return;

  if (politeness === 'assertive') {
    emit(key, words, politeness);
    return;
  }

  const at = Math.max(now + (options.settleMs ?? 0), slot.lastAt + THROTTLE_MS);
  if (at <= now) {
    emit(key, words, politeness);
    return;
  }
  slot.pending = setTimeout(() => {
    slot.pending = undefined;
    emit(key, words, politeness);
  }, at - now);
}

/** Drop a message still waiting under `key`, for a state that is gone before it was said. */
export function cancelAnnouncement(key: string): void {
  const slot = slots.get(key);
  if (slot === undefined) return;
  clearTimeout(slot.pending);
  slot.pending = undefined;
}

/** A snapshot of the regions' contents, for tests. */
export function getAnnouncerState(): AnnouncerState {
  return announcerStore.getState();
}

/** Forget everything said and cancel everything waiting. For tests. */
export function resetAnnouncer(): void {
  for (const slot of slots.values()) clearTimeout(slot.pending);
  for (const removal of removals) clearTimeout(removal);
  slots.clear();
  removals.clear();
  announcerStore.setState({ messages: [], emitted: 0 });
}

export function useAnnouncer<T>(selector: (s: AnnouncerState) => T): T {
  return useStore(announcerStore, selector);
}
