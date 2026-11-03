import { useLayoutEffect, useRef } from 'react';
import type { UndoNotice } from '@/lib/useUndoOffer';
import { SnackbarAction, snackbarDetailClass, snackbarProps } from './Snackbar';

/**
 * The line that offers to take back a destructive change, in the page next to
 * where it happened (UX-004), in the snackbar style (DS-001). Pair it with
 * `useUndoOffer`.
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
  // Starts at the value the bar mounts with, so a bar remounted under a
  // request already served does not take focus again.
  const focusHandled = useRef(focusRequest);
  useLayoutEffect(() => {
    if (focusRequest === focusHandled.current) return;
    focusHandled.current = focusRequest;
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
      // The app-wide ring skips `tabindex="-1"`, which this region is, so it
      // draws its own for the focus it takes after Undo (A11Y-001).
      className="rounded-control outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
    >
      {pending !== null ? (
        <div {...snackbarProps(true)}>
          <span className="min-w-0 flex-1">
            {pending.title}
            {/* The detail is a second line to the eye; the separator keeps the
                two apart in what the status region says. */}
            {pending.detail !== undefined && (
              <>
                <span className="sr-only"> · </span>
                <span className={snackbarDetailClass}>{pending.detail}</span>
              </>
            )}
          </span>
          <SnackbarAction
            ref={undoButton}
            aria-label={`Undo: ${pending.title}`}
            onClick={() => {
              focusAfterUndo.current = true;
              onUndo();
            }}
          >
            Undo
          </SnackbarAction>
        </div>
      ) : undone !== null ? (
        <div {...snackbarProps(false)}>Undone: {undone}</div>
      ) : null}
    </div>
  );
}
