// @vitest-environment jsdom
// A11Y-002: the roll and notice snackbars mount with their text, and a live
// region that mounts with its text is announced unreliably. So both are plain
// visuals and their words go through the announcer, which is mounted from boot.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { noticeStore, notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { NoticeToast } from './NoticeToast';
import { RollToast } from './RollToast';

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
    expect(spoken()).toEqual(['Initiative, Nat 20!: 25 ([20] +5)']);
  });

  it('says the same result twice when it is rolled twice', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(roll(15)));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    act(() => rollLogStore.getState().append(roll(15)));
    expect(spoken()).toEqual(['Initiative: 15 ([10] +5)', 'Initiative: 15 ([10] +5)']);
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
  });
});

describe('NoticeToast', () => {
  it('shows a notice without a region of its own and says it through the announcer', () => {
    render(<NoticeToast />);
    act(() => notify({ title: 'Short rest', detail: 'Restored Second Wind', tone: 'good' }));
    const toast = screen.getByText('Short rest').closest('div.fixed');
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
