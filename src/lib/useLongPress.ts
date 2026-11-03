import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

/** How long a finger rests before a press counts as held: Android's own default. */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may drift and still be holding still. Larger than Android's
 * touch slop (8dp), since a held thumb wanders more than a tapping one.
 */
const SLOP_PX = 10;

export interface LongPressHandlers {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onContextMenu(e: MouseEvent): void;
  onClickCapture(e: MouseEvent): void;
}

/**
 * Press and hold with a finger or a pen to run `onLongPress`, the way a phone
 * opens a list item's menu. A shortcut only: whatever it opens needs a button
 * too, because a hold cannot be found by sight, made with a keyboard or made
 * by a switch.
 *
 * A mouse is left alone, so a right-click on a link keeps the browser's menu
 * (open in a new tab). A scroll ends the hold, since the browser cancels the
 * pointer when it takes the gesture over. Spread the handlers on the element.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const latest = useRef(onLongPress);
  useLayoutEffect(() => {
    latest.current = onLongPress;
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number }>(undefined);
  /** A finger is down and has not yet moved off or been lifted. */
  const pressing = useRef(false);
  /** The hold ran, so the click a lift may still send is not a tap. */
  const held = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(() => {
    const release = () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      start.current = undefined;
      pressing.current = false;
    };
    const fire = () => {
      release();
      held.current = true;
      latest.current();
    };
    return {
      onPointerDown: (e) => {
        held.current = false;
        release();
        if (e.pointerType === 'mouse' || !e.isPrimary) return;
        pressing.current = true;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(fire, LONG_PRESS_MS);
      },
      onPointerMove: (e) => {
        const from = start.current;
        if (from !== undefined && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX) {
          release();
        }
      },
      onPointerUp: release,
      onPointerCancel: release,
      // Android Chrome sends its own long-press as a context menu: that menu
      // (open in a new tab, copy link) would cover this one, so the hold
      // takes its place, at the platform's own timing if that comes first.
      onContextMenu: (e) => {
        if (pressing.current) {
          e.preventDefault();
          fire();
        } else if (held.current) {
          e.preventDefault();
        }
      },
      // A lift after a hold can still click, which on a link would open it
      // behind the menu that just appeared. A keyboard's click (detail 0) is
      // never one of those, so a hold whose click never came cannot eat it.
      onClickCapture: (e) => {
        if (!held.current) return;
        held.current = false;
        if (e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
    };
  }, []);
}
