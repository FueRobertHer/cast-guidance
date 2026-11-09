// @vitest-environment jsdom
// A11Y-002: the roll and notice snackbars mount with their text, and a live
// region that mounts with its text is announced unreliably. So both are plain
// visuals and their words go through the announcer, which is mounted from boot.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { diceTrayStore } from '@/stores/diceTray';
import { noticeStore, notify, notifyFailure } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { NoticeToast } from './NoticeToast';
import { ROLL_TOAST_MS, RollToast, rollAnnouncement } from './RollToast';

const LIVE = '[aria-live],[role="status"],[role="alert"],output';
const spoken = () => getAnnouncerState().messages.map((m) => m.text);

const roll = (total: number, natural?: number): RollResult => ({
  expr: '1d20+5',
  label: 'Initiative',
  total,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: total - 5, kept: true }] },
    { kind: 'mod', value: 5 },
  ],
  meta: natural === undefined ? undefined : { d20: { natural } },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  noticeStore.setState({ notice: null, seq: 0 });
});

describe('RollToast', () => {
  it('shows a roll without a region of its own and says it through the announcer', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(25, 20)));
    const toast = screen.getByText('Initiative').closest('div.fixed');
    expect(toast).not.toBeNull();
    expect(toast?.closest(LIVE)).toBeNull();
    expect(toast?.querySelector(LIVE)).toBeNull();
    expect(spoken()).toEqual(['Initiative, natural 20: 25. Rolled 20, plus 5']);
  });

  it('says the same result twice when it is rolled twice', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    act(() => rollLogStore.getState().append(roll(15)));
    expect(spoken()).toEqual([
      'Initiative: 15. Rolled 10, plus 5',
      'Initiative: 15. Rolled 10, plus 5',
    ]);
  });

  it('does not say an older roll again when the newest is removed from the log', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    act(() => rollLogStore.getState().append(roll(12)));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    // Deleting an accidental roll hands the toast the one before it, with no
    // new roll made.
    const newest = rollLogStore.getState().rolls[0]?.id ?? '';
    act(() => rollLogStore.getState().remove(newest));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(getAnnouncerState().emitted).toBe(2);
    // Nor does it show it: the toast still has the roll that was made.
    expect(screen.queryByText('12')).not.toBeNull();
    expect(screen.queryByText('15')).toBeNull();
  });

  it('says a natural 20 and a natural 1 in words', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(25, 20)));
    expect(screen.getByText('Natural 20!')).toBeTruthy();
    act(() => rollLogStore.getState().append(roll(6, 1)));
    expect(screen.getByText('Natural 1')).toBeTruthy();
    expect(screen.queryByText('Natural 20!')).toBeNull();
  });

  it('says a crit inside the crit range, and the damage a crit doubled, in words', () => {
    render(<RollToast />);
    const swing: RollResult = {
      ...roll(24, 19),
      label: 'Longsword attack',
      kind: 'd20',
      meta: { d20: { natural: 19 }, attack: { by: 'c1', of: 'Longsword', crit: true } },
    };
    act(() => rollLogStore.getState().append(swing));
    expect(screen.getByText('Critical hit!')).toBeTruthy();
    expect(screen.queryByText('Natural 20!')).toBeNull();
    expect(spoken().at(-1)).toBe('Longsword attack, critical hit: 24. Rolled 19, plus 5');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    const dealt: RollResult = {
      expr: '1d8+3',
      label: 'Longsword slashing damage',
      kind: 'damage',
      total: 11,
      at: 0,
      terms: [
        {
          kind: 'dice',
          sign: 1,
          sides: 8,
          rolls: [
            { v: 3, kept: true },
            { v: 5, kept: true },
          ],
        },
        { kind: 'mod', value: 3 },
      ],
      meta: { critical: true },
    };
    act(() => rollLogStore.getState().append(dealt));
    expect(screen.getByText('Critical')).toBeTruthy();
    expect(spoken().at(-1)).toBe('Longsword slashing damage, critical: 11. Rolled 3, 5, plus 3');
    // Landed with the attack it waited on, under it: it says so there too.
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    act(() => rollLogStore.getState().append({ ...swing, id: 'a1' }));
    act(() => rollLogStore.getState().append({ ...dealt, meta: { critical: true, withRoll: 'a1' } }));
    expect(screen.getByText(/^Longsword slashing damage, critical:/)).toBeTruthy();
  });

  it('stays four seconds', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS - 1));
    expect(screen.queryByText('Initiative')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Initiative')).toBeNull();
  });

  it('waits while the pointer is on it, then gives four seconds more (WCAG 2.2.1)', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    const toast = screen.getByText('Initiative').closest('div.fixed');
    if (toast === null) throw new Error('no toast');
    fireEvent.pointerEnter(toast, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS * 3));
    expect(screen.queryByText('Initiative')).not.toBeNull();
    fireEvent.pointerLeave(toast, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS - 1));
    expect(screen.queryByText('Initiative')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Initiative')).toBeNull();
    // Waiting is not a second announcement.
    expect(getAnnouncerState().emitted).toBe(1);
  });

  it('does not wait for a tap, which has no leave after it', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    const toast = screen.getByText('Initiative').closest('div.fixed');
    if (toast === null) throw new Error('no toast');
    fireEvent.pointerEnter(toast, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS));
    expect(screen.queryByText('Initiative')).toBeNull();
  });

  describe('where there is hover', () => {
    const realMatchMedia = window.matchMedia;
    const realMatches = Element.prototype.matches;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(hover: hover)',
      })) as unknown as typeof window.matchMedia;
      // jsdom never hovers: the toast is under the pointer from the start.
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ':hover'
          ? this.classList.contains('fixed')
          : realMatches.call(this, selector);
      });
    });
    afterEach(() => {
      window.matchMedia = realMatchMedia;
      vi.restoreAllMocks();
    });

    it('waits for a mouse that rested where the toast rose, with no enter event', () => {
      render(<RollToast />);
      act(() => rollLogStore.getState().append(roll(15)));
      act(() => vi.advanceTimersByTime(ROLL_TOAST_MS * 2));
      expect(screen.queryByText('Initiative')).not.toBeNull();
    });

    it('does not wait on the hover a finger leaves on what it tapped', () => {
      render(<RollToast />);
      act(() => rollLogStore.getState().append(roll(15)));
      const toast = screen.getByText('Initiative').closest('div.fixed');
      if (toast === null) throw new Error('no toast');
      fireEvent.pointerDown(toast, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(ROLL_TOAST_MS));
      expect(screen.queryByText('Initiative')).toBeNull();
    });
  });

  it('names a natural 20 only on a d20 roll', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append({ ...roll(25, 20), kind: 'damage' }));
    expect(screen.queryByText('Natural 20!')).toBeNull();
    expect(spoken()).toEqual(['Initiative: 25. Rolled 20, plus 5']);
  });

  it('shows a heal as a heal', () => {
    render(<RollToast />);
    act(() =>
      rollLogStore.getState().append({
        ...roll(9),
        label: 'Hit die (d8)',
        kind: 'heal',
        meta: undefined,
      }),
    );
    const total = screen.getByText('9');
    expect(total.className).toContain('text-heal');
  });
});

describe('RollToast with a dice tray on the page', () => {
  let unmountTray: () => void = () => undefined;
  beforeEach(() => {
    unmountTray = diceTrayStore.getState().mount();
  });
  afterEach(() => {
    unmountTray();
    diceTrayStore.setState({ open: false, view: 'roll', returnTo: null });
  });

  const toastButton = () => screen.getByRole('button', { name: /^Initiative: 15\./ });

  it('is a button named as the roll is said, that opens the tray on History', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    expect(toastButton().getAttribute('aria-label')).toBe(
      'Initiative: 15. Rolled 10, plus 5. Open roll history',
    );
    expect(toastButton().closest(LIVE)).toBeNull();
    fireEvent.pointerDown(toastButton());
    fireEvent.click(toastButton());
    expect(diceTrayStore.getState()).toMatchObject({ open: true, view: 'history' });
    // The tray hands focus back to what had it before the toast was pressed.
    expect(diceTrayStore.getState().returnTo).toBe(opener);
    expect(screen.queryByText('Initiative')).toBeNull();
    opener.remove();
  });

  it('waits while it has focus', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    act(() => toastButton().focus());
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS * 2));
    expect(screen.queryByText('Initiative')).not.toBeNull();
    act(() => toastButton().blur());
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS));
    expect(screen.queryByText('Initiative')).toBeNull();
    expect(getAnnouncerState().emitted).toBe(1);
  });
});

describe('NoticeToast', () => {
  it('shows a notice without a region of its own and says it through the announcer', () => {
    render(<NoticeToast />);
    act(() => notify({ title: 'Short rest', detail: 'Restored Second Wind', tone: 'good' }));
    const toast = screen.getByTestId('notice-toast');
    expect(toast.textContent).toContain('Short rest');
    expect(toast).not.toBeNull();
    expect(toast?.closest(LIVE)).toBeNull();
    expect(toast?.querySelector(LIVE)).toBeNull();
    expect(spoken()).toEqual(['Short rest. Restored Second Wind']);
  });

  it('says a repeated notice again, once the key has been quiet', () => {
    act(() => notify({ title: 'Short rest', detail: 'Nothing to restore', tone: 'info' }));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    act(() => notify({ title: 'Short rest', detail: 'Nothing to restore', tone: 'info' }));
    expect(getAnnouncerState().emitted).toBe(2);
  });
});

describe('rollAnnouncement', () => {
  it('says kept and dropped dice in words, not brackets', () => {
    const advantage: RollResult = {
      expr: '2d20kh1+5',
      label: 'Attack',
      total: 18,
      at: 0,
      terms: [
        {
          kind: 'dice',
          sign: 1,
          sides: 20,
          rolls: [
            { v: 13, kept: true },
            { v: 4, kept: false },
          ],
        },
        { kind: 'mod', value: 5 },
      ],
    };
    expect(rollAnnouncement(advantage)).toBe('Attack: 18. Rolled 13, dropped 4, plus 5');
  });

  it('says a penalty and a second die group with their signs', () => {
    const result: RollResult = {
      expr: '1d8+1d6-1',
      total: 7,
      at: 0,
      terms: [
        { kind: 'dice', sign: 1, sides: 8, rolls: [{ v: 5, kept: true }] },
        { kind: 'dice', sign: 1, sides: 6, rolls: [{ v: 3, kept: true }] },
        { kind: 'mod', value: -1 },
      ],
      meta: { d20: { natural: 1 } },
    };
    expect(rollAnnouncement(result)).toBe('1d8+1d6-1, natural 1: 7. Rolled 5, plus 3, minus 1');
  });
});

// Failures are assertive and on their own key: the shared polite throttle
// would let the second and third in a burst replace each other.
describe('failure notices', () => {
  it('says every failure in a burst, at once, in the assertive region', () => {
    act(() => {
      notify({ title: 'Long rest complete', detail: 'Already at full', tone: 'good' });
      notifyFailure('Rename', new Error('disk full'));
      notifyFailure('Delete', new Error('disk full'));
      notifyFailure('Rename', new Error('disk full'));
    });
    const assertive = getAnnouncerState().messages.filter((m) => m.politeness === 'assertive');
    expect(assertive.map((m) => m.text)).toEqual([
      'Rename failed. disk full',
      'Delete failed. disk full',
      'Rename failed. disk full',
    ]);
    // The polite notice was not held back or replaced by them either.
    expect(spoken()).toContain('Long rest complete. Already at full');
  });
});
