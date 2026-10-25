// @vitest-environment jsdom
// UX-004: a destructive change on the sheet offers a one-level undo that lasts
// until the next edit, and only ever puts back a snapshot over the state that
// change left behind.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { captureUpdate, sameForUndo, useUndoOffer } from './useUndoOffer';

interface S {
  n: number;
}
const sameN = (a: S, b: S) => a.n === b.n;
type Props = { current: S | null; same: (a: S, b: S) => boolean };

function setup(start: S = { n: 1 }) {
  const restore = vi.fn<(before: S, label: string) => void>();
  const initialProps: Props = { current: start, same: sameN };
  const view = renderHook(
    ({ current, same }: Props) => useUndoOffer<S>({ current, same, restore }),
    { initialProps },
  );
  const moveTo = (current: S | null, same = sameN) => view.rerender({ current, same });
  return { ...view, restore, moveTo };
}

describe('useUndoOffer', () => {
  it('offers the change it was given', () => {
    const { result, moveTo } = setup();
    moveTo({ n: 2 });
    act(() => result.current.offer({ n: 1 }, { n: 2 }, 'Species: A → B', '2 A picks cleared'));
    expect(result.current.pending).toEqual({
      title: 'Species: A → B',
      detail: '2 A picks cleared',
    });
  });

  it('withdraws the offer at the next edit', () => {
    const { result, moveTo, restore } = setup();
    moveTo({ n: 2 });
    act(() => result.current.offer({ n: 1 }, { n: 2 }, 'Change'));
    moveTo({ n: 3 });
    expect(result.current.pending).toBeNull();
    act(() => void result.current.run());
    expect(restore).not.toHaveBeenCalled();
  });

  it('puts the snapshot back under an undo label, and says so until the next edit', () => {
    const { result, moveTo, restore } = setup();
    moveTo({ n: 2 });
    act(() => result.current.offer({ n: 1 }, { n: 2 }, 'Change'));
    let ran = false;
    act(() => {
      ran = result.current.run();
    });
    expect(ran).toBe(true);
    expect(restore).toHaveBeenCalledWith({ n: 1 }, 'Undo: Change');
    expect(result.current.pending).toBeNull();
    // The restore lands; the bar keeps saying what it undid.
    moveTo({ n: 1 });
    expect(result.current.undone).toBe('Change');
    moveTo({ n: 5 });
    expect(result.current.undone).toBeNull();
  });

  it('re-checks the state before it restores anything', () => {
    // The state reads as moved on without a new value arriving (here, the
    // comparison itself changed), so only the check inside run stands between
    // the click and a restore over it.
    const { result, moveTo, restore } = setup();
    const after = { n: 2 };
    moveTo(after);
    act(() => result.current.offer({ n: 1 }, after, 'Change'));
    moveTo(after, () => false);
    act(() => void result.current.run());
    expect(restore).not.toHaveBeenCalled();
  });

  it('keeps only the latest offer', () => {
    const { result, moveTo, restore } = setup();
    moveTo({ n: 2 });
    act(() => result.current.offer({ n: 1 }, { n: 2 }, 'First'));
    moveTo({ n: 3 });
    act(() => result.current.offer({ n: 2 }, { n: 3 }, 'Second'));
    act(() => void result.current.run());
    expect(restore).toHaveBeenCalledWith({ n: 2 }, 'Undo: Second');
  });

  it('keeps the offer through the sheet syncing current HP to a new maximum', () => {
    const restore = vi.fn();
    const before = newCharacterDoc('c', 'H', 't');
    before.play.hpInitialized = false;
    const after = structuredClone(before);
    after.race = { name: 'Testfolk', source: 'TST' };
    const { result, rerender } = renderHook(
      ({ current }: { current: CharacterDoc }) =>
        useUndoOffer({ current, same: sameForUndo, restore }),
      { initialProps: { current: after } },
    );
    act(() => result.current.offer(before, after, 'Species: none → Testfolk'));
    rerender({ current: { ...after, play: { ...after.play, currentHp: 12 } } });
    expect(result.current.pending?.title).toBe('Species: none → Testfolk');
  });
});

describe('sameForUndo', () => {
  it('ignores current HP only while it follows the maximum', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.play.hpInitialized = false;
    const synced = { ...doc, play: { ...doc.play, currentHp: 9 } };
    expect(sameForUndo(doc, synced)).toBe(true);

    const settled = { ...doc, play: { ...doc.play, hpInitialized: true } };
    expect(sameForUndo(settled, { ...settled, play: { ...settled.play, currentHp: 9 } })).toBe(
      false,
    );
  });
});

describe('captureUpdate', () => {
  it('runs the recipe once and keeps the state either side of it', () => {
    let state = { n: 1 };
    const recipe = vi.fn((s: { n: number }) => {
      s.n += 1;
    });
    const change = captureUpdate<{ n: number }>((r) => {
      const draft = structuredClone(state);
      r(draft);
      state = draft;
    }, recipe);
    expect(recipe).toHaveBeenCalledTimes(1);
    expect(change).toEqual({ before: { n: 1 }, after: { n: 2 } });
    expect(state).toEqual({ n: 2 });
  });

  it('has nothing to report when the updater never ran the recipe', () => {
    expect(captureUpdate(() => undefined, vi.fn())).toBeUndefined();
  });
});
