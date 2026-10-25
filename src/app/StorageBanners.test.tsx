// @vitest-environment jsdom
// A11Y-002: a recovered save is said once per recovery. Each recovery is its
// own event, so two inside the announcer's de-duplication window are both said.
// REL-007 (#98): a refused save is not a recovery, and its banner stands aside
// for the database lifecycle banner as the save-error banner does.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { characterSessionStore } from '@/stores/characterSession';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
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
  characterSessionStore.setState({ saveErrors: {}, saveConflicts: {} });
  dbLifecycleStore.setState({ state: 'open' });
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

  it('says nothing when a failed save leaves the list because it was refused, not saved', () => {
    render(<StorageBanners />);
    fail();
    act(() =>
      characterSessionStore.setState({
        saveErrors: {},
        saveConflicts: { c1: { kind: 'changed', name: 'Wren' } },
      }),
    );
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('changed in another tab');
  });
});

describe('StorageBanners save conflict', () => {
  it('stands aside for the lifecycle banner once the database is closed', () => {
    characterSessionStore.setState({ saveConflicts: { c1: { kind: 'changed', name: 'Wren' } } });
    render(<StorageBanners />);
    expect(screen.getByRole('alert').textContent).toContain('changed in another tab');

    act(() => dbLifecycleStore.setState({ state: 'deleted' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('saved data was cleared');
  });
});
