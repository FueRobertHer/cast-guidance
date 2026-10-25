// @vitest-environment jsdom
// A11Y-002: a recovered save is said once per recovery. Each recovery is its
// own event, so two inside the announcer's de-duplication window are both said.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { characterSessionStore } from '@/stores/characterSession';
import { SAVE_RECOVERED_TEXT, StorageBanners } from './AppShell';

const spoken = () => getAnnouncerState().messages.map((m) => m.text);
const fail = () => act(() => characterSessionStore.setState({ saveErrors: { c1: 'disk full' } }));
const recover = () => act(() => characterSessionStore.setState({ saveErrors: {} }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});

afterEach(() => {
  cleanup();
  characterSessionStore.setState({ saveErrors: {} });
  resetAnnouncer();
  vi.useRealTimers();
});

describe('StorageBanners save recovery', () => {
  it('says nothing while saves work, and nothing for the failure itself', () => {
    render(<StorageBanners />);
    recover();
    fail();
    // The failure is the banner's alert, not an announcer line.
    expect(spoken()).toEqual([]);
  });

  it('says each recovery, even two inside the de-duplication window', () => {
    render(<StorageBanners />);
    fail();
    recover();
    act(() => vi.advanceTimersByTime(500));
    fail();
    recover();
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken()).toEqual([SAVE_RECOVERED_TEXT, SAVE_RECOVERED_TEXT]);
  });
});
