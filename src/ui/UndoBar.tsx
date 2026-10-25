import { useLayoutEffect, useRef } from 'react';
import type { UndoNotice } from '@/lib/useUndoOffer';

/**
 * The line that offers to take back a destructive change, in the page next to
 * where it happened (UX-004). Pair it with `useUndoOffer`.
 *
 * The status region stays mounted and only its content comes and goes, so a
 * screen reader hears each offer as it is inserted. It is also where focus
 * goes after Undo: the button disappears with the offer, and focus left on it
 * would fall to the page body. The region then says what was undone.
 *
 * A change whose own control goes away with it (a line that hides, a card
 * that unmounts) bumps `focusRequest`, and focus moves to the new offer's
 * Undo button instead of falling to the page body.
 */
export function UndoBar({
  pending,
  undone,
  onUndo,
  focusRequest = 0,
}: {
  pending: UndoNotice | null;
  undone: string | null;
  onUndo: () => void;
  /** Bump to move focus to the Undo button once the offer shows. */
  focusRequest?: number;
}) {
  const region = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusAfterUndo = useRef(false);
  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    undoButton.current?.focus();
  }, [focusRequest]);
  // Only once the region says what was undone: focusing it in the click
  // handler, before React re-renders, had a screen reader read the stale offer
  // first and then announce again.
  useLayoutEffect(() => {
    if (!focusAfterUndo.current || undone === null) return;
    focusAfterUndo.current = false;
    region.current?.focus();
  }, [undone]);
  return (
    <div
      ref={region}
      role="status"
      tabIndex={-1}
      className="rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {pending !== null ? (
        <div className="flex items-center gap-2 rounded-lg border border-surface-2 bg-surface/95 px-3 py-2 text-xs backdrop-blur">
          <span className="min-w-0 flex-1">
            {pending.title}
            {pending.detail !== undefined && (
              <span className="text-ink-muted"> · {pending.detail}</span>
            )}
          </span>
          <button
            ref={undoButton}
            type="button"
            aria-label={`Undo: ${pending.title}`}
            onClick={() => {
              focusAfterUndo.current = true;
              onUndo();
            }}
            className="shrink-0 rounded-lg bg-surface-2 px-3 py-1 font-semibold"
          >
            Undo
          </button>
        </div>
      ) : undone !== null ? (
        <div className="rounded-lg bg-surface/95 px-3 py-2 text-xs text-ink-muted backdrop-blur">
          Undone: {undone}
        </div>
      ) : null}
    </div>
  );
}
