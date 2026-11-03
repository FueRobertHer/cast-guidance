// @vitest-environment jsdom
// The roster card's long press (DS-001): a held finger opens the card's
// actions, and nothing else about the card changes for a tap, a mouse or a
// keyboard.
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, useLongPress } from './useLongPress';

const held = vi.fn();
const clicked = vi.fn();

function Target() {
  const hold = useLongPress(held);
  return (
    <button type="button" {...hold} onClick={clicked}>
      Card
    </button>
  );
}

function press(pointerType = 'touch', at = { x: 0, y: 0 }) {
  fireEvent.pointerDown(screen.getByRole('button'), {
    pointerType,
    isPrimary: true,
    clientX: at.x,
    clientY: at.y,
  });
}

/** A context menu event, and whether a handler kept the browser's own menu away. */
function contextMenu(): boolean {
  const target = screen.getByRole('button');
  const event = createEvent.contextMenu(target);
  fireEvent(target, event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
  render(<Target />);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  held.mockClear();
  clicked.mockClear();
});

describe('useLongPress', () => {
  it('runs once a finger has rested long enough', () => {
    press();
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(held).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(held).toHaveBeenCalledOnce();
  });

  it('works for a pen, and leaves a mouse to its own right-click', () => {
    press('pen');
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(held).toHaveBeenCalledOnce();

    press('mouse');
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(held).toHaveBeenCalledOnce();
    // The browser's menu (open in a new tab) stays.
    expect(contextMenu()).toBe(false);
  });

  it('is not a hold once the finger lifts, drifts, or the browser takes the gesture', () => {
    const button = screen.getByRole('button');
    press();
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    press();
    fireEvent.pointerMove(button, { clientX: 8, clientY: 8 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    // A scroll: the browser cancels the pointer when it starts panning.
    press();
    fireEvent.pointerCancel(button);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(held).not.toHaveBeenCalled();

    // A small wobble is still holding still.
    press();
    fireEvent.pointerMove(button, { clientX: 4, clientY: 5 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(held).toHaveBeenCalledOnce();
  });

  it("takes the place of Android's own long-press menu, at its timing", () => {
    press();
    act(() => vi.advanceTimersByTime(300));
    expect(contextMenu()).toBe(true);
    expect(held).toHaveBeenCalledOnce();
    // The timer it replaced does not run it again.
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(held).toHaveBeenCalledOnce();
  });

  it('swallows the click a lift sends after a hold, and no other', () => {
    const button = screen.getByRole('button');
    press();
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    // A menu that follows the hold is not the browser's either.
    expect(contextMenu()).toBe(true);
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(clicked).not.toHaveBeenCalled();

    fireEvent.click(button, { detail: 1 });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('never eats a keyboard click, even after a hold whose click never came', () => {
    press();
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    // Android sends no click after a long press; Enter on the card later does (detail 0).
    fireEvent.click(screen.getByRole('button'), { detail: 0 });
    expect(clicked).toHaveBeenCalledOnce();
  });
});
