import { useEffect, useRef, useState } from 'react';
import type { CharacterDoc } from '@/engine/types';
import { contentKey } from './docDiff';

/** What an undo bar says about the change it can take back. */
export interface UndoNotice {
  title: string;
  detail?: string;
}

type Bar<S> =
  | ({ kind: 'offer'; before: S; after: S } & UndoNotice)
  | { kind: 'undone'; title: string; state: S }
  | null;

export interface UndoOffer<S> {
  /** The change the bar offers to take back, or null. */
  pending: UndoNotice | null;
  /** The title of the change just taken back, until anything else changes. */
  undone: string | null;
  /** Offer to take a change back. Replaces whatever was offered before. */
  offer(before: S, after: S, title: string, detail?: string): void;
  /** Put `before` back, if nothing has changed since. Says whether it did. */
  run(): boolean;
  dismiss(): void;
}

/**
 * A one-level undo for a destructive change, kept as page state (UX-004).
 *
 * The offer lasts until the state moves on from what the change left (the
 * next edit), or the page unmounts; there is no timer, so nobody has to race
 * a fading toast. Undo re-checks that nothing changed in between, so it can
 * never put back a snapshot over an edit made after it.
 *
 * Generic over the state, so a page with more than a document (the creator's
 * draft plus its equipment picks) can offer the same thing. `same` decides
 * what counts as a change; for a character use {@link sameForUndo}.
 *
 * Get `before` and `after` from the one run of the change (see
 * {@link captureUpdate}), never by running a recipe a second time: recipes
 * read clocks and dice, and a second run need not land where the first did.
 */
export function useUndoOffer<S>({
  current,
  same,
  restore,
}: {
  /** The state as it is now; null while there is none (loading, closed). */
  current: S | null;
  same: (a: S, b: S) => boolean;
  /** Put a snapshot back. The label names the undo for history. */
  restore: (before: S, label: string) => void;
}): UndoOffer<S> {
  const [bar, setBar] = useState<Bar<S>>(null);
  // Mirrors of the latest state and props for handlers and the effect below,
  // which must not wait for a render to see an offer made a moment ago.
  const barRef = useRef<Bar<S>>(null);
  const latest = useRef({ current, same, restore });
  latest.current = { current, same, restore };

  useEffect(() => {
    const b = barRef.current;
    if (b === null) return;
    const anchor = b.kind === 'offer' ? b.after : b.state;
    if (current === null || !latest.current.same(current, anchor)) {
      barRef.current = null;
      setBar(null);
    }
  }, [current]);

  const show = (next: Bar<S>) => {
    barRef.current = next;
    setBar(next);
  };

  return {
    pending: bar?.kind === 'offer' ? { title: bar.title, detail: bar.detail } : null,
    undone: bar?.kind === 'undone' ? bar.title : null,
    offer: (before, after, title, detail) => show({ kind: 'offer', before, after, title, detail }),
    run: () => {
      const b = barRef.current;
      if (b === null || b.kind !== 'offer') return false;
      const now = latest.current.current;
      if (now === null || !latest.current.same(now, b.after)) {
        show(null);
        return false;
      }
      show({ kind: 'undone', title: b.title, state: b.before });
      latest.current.restore(b.before, `Undo: ${b.title}`);
      return true;
    },
    dismiss: () => show(null),
  };
}

/**
 * Whether two snapshots of a character are the same for undo. Content as
 * history compares it, except current HP while it still follows the maximum
 * (`hpInitialized === false`): the sheet writes that by itself after any change
 * that moves max HP, and that write must not count as the player moving on.
 */
export function sameForUndo(a: CharacterDoc, b: CharacterDoc): boolean {
  return undoKey(a) === undoKey(b);
}

function undoKey(doc: CharacterDoc): string {
  if (doc.play.hpInitialized !== false) return contentKey(doc);
  return contentKey({ ...doc, play: { ...doc.play, currentHp: 0 } });
}

/**
 * Apply `recipe` once through `apply` (a doc updater, say) and keep copies of
 * the state on either side of it. Undefined when `apply` never ran the recipe,
 * as an updater does while nothing is loaded.
 */
export function captureUpdate<S>(
  apply: (recipe: (state: S) => void) => void,
  recipe: (state: S) => void,
): { before: S; after: S } | undefined {
  const seen: { before?: S; after?: S } = {};
  apply((state) => {
    seen.before = structuredClone(state);
    recipe(state);
    seen.after = structuredClone(state);
  });
  return seen.before === undefined || seen.after === undefined
    ? undefined
    : { before: seen.before, after: seen.after };
}
