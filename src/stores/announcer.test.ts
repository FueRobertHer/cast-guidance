// A11Y-002: the announcer is how the app speaks without moving focus, and it
// has to be restrained: a burst of edits or a state reported twice must not
// become a burst of speech (#113).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announce,
  CLEAR_MS,
  DEDUPE_MS,
  getAnnouncerState,
  resetAnnouncer,
  THROTTLE_MS,
} from './announcer';

/** Every line spoken so far, still in a region, with its politeness. */
const spoken = () => getAnnouncerState().messages.map((m) => `${m.politeness}: ${m.text}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});

afterEach(() => {
  resetAnnouncer();
  vi.useRealTimers();
});

describe('announce: de-duplication by key', () => {
  it('drops the same words for the same key inside the window', () => {
    announce('Update available', { key: 'update' });
    vi.advanceTimersByTime(DEDUPE_MS - 1);
    announce('Update available', { key: 'update' });
    vi.runOnlyPendingTimers();
    expect(getAnnouncerState().emitted).toBe(1);
  });

  it('says them again once the window has passed', () => {
    announce('Update available', { key: 'update' });
    vi.advanceTimersByTime(DEDUPE_MS);
    announce('Update available', { key: 'update' });
    expect(getAnnouncerState().emitted).toBe(2);
  });

  it('keys on the text when no key is given', () => {
    announce('Saved');
    announce('Saved');
    announce('Imported');
    expect(spoken()).toEqual(['polite: Saved', 'polite: Imported']);
  });

  it('drops a waiting message when the state goes back to what was last said', () => {
    announce('3 results', { key: 'search' });
    announce('4 results', { key: 'search' });
    announce('3 results', { key: 'search' });
    vi.runAllTimers();
    expect(getAnnouncerState().emitted).toBe(1);
  });

  it('lets an event repeat its words when asked', () => {
    announce('Initiative: 15', { key: 'roll', repeat: true });
    vi.advanceTimersByTime(THROTTLE_MS);
    announce('Initiative: 15', { key: 'roll', repeat: true });
    expect(getAnnouncerState().emitted).toBe(2);
  });

  it('ignores empty text', () => {
    announce('   ');
    expect(getAnnouncerState().emitted).toBe(0);
  });
});

describe('announce: throttle', () => {
  it('cuts a burst on one key to its first and last messages', () => {
    for (let hp = 20; hp > 10; hp--) {
      announce(`${hp} of 20 hit points`, { key: 'hp' });
      vi.advanceTimersByTime(50);
    }
    // The first is said at once; the rest wait for the window, and each
    // replaces the one before it.
    expect(spoken()).toEqual(['polite: 20 of 20 hit points']);
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(spoken()).toEqual(['polite: 20 of 20 hit points', 'polite: 11 of 20 hit points']);
    vi.runAllTimers();
    expect(getAnnouncerState().emitted).toBe(2);
  });

  it('holds a message until the window since the last one has passed', () => {
    announce('one', { key: 'k' });
    vi.advanceTimersByTime(THROTTLE_MS / 2);
    announce('two', { key: 'k' });
    expect(getAnnouncerState().emitted).toBe(1);
    vi.advanceTimersByTime(THROTTLE_MS / 2 - 1);
    expect(getAnnouncerState().emitted).toBe(1);
    vi.advanceTimersByTime(1);
    expect(getAnnouncerState().emitted).toBe(2);
  });

  it('throttles each key on its own', () => {
    announce('Update available', { key: 'update' });
    announce('Imported brew.json', { key: 'import' });
    expect(getAnnouncerState().emitted).toBe(2);
  });

  it('waits for a quiet spell when asked to settle', () => {
    announce('3 results', { key: 'search', settleMs: 750 });
    vi.advanceTimersByTime(500);
    announce('2 results', { key: 'search', settleMs: 750 });
    vi.advanceTimersByTime(749);
    expect(getAnnouncerState().emitted).toBe(0);
    vi.advanceTimersByTime(1);
    expect(spoken()).toEqual(['polite: 2 results']);
  });
});

describe('announce: politeness', () => {
  it('is polite unless asked otherwise', () => {
    announce('Imported');
    expect(getAnnouncerState().messages[0]?.politeness).toBe('polite');
  });

  it('speaks an assertive message at once, past the throttle and the settle', () => {
    announce('Saving…', { key: 'save' });
    announce('Save failed', { key: 'save', politeness: 'assertive', settleMs: 5000 });
    expect(spoken()).toEqual(['polite: Saving…', 'assertive: Save failed']);
  });

  it('still de-duplicates an assertive message', () => {
    announce('Save failed', { key: 'save', politeness: 'assertive' });
    announce('Save failed', { key: 'save', politeness: 'assertive' });
    expect(getAnnouncerState().emitted).toBe(1);
  });
});

describe('announce: the regions', () => {
  it('clears a line from its region after a while, without forgetting it was said', () => {
    announce('Imported');
    vi.advanceTimersByTime(CLEAR_MS);
    expect(getAnnouncerState().messages).toEqual([]);
    expect(getAnnouncerState().emitted).toBe(1);
  });

  it('gives a repeated line a new identity, so a reader hears it as an addition', () => {
    announce('Initiative: 15', { key: 'roll', repeat: true });
    vi.advanceTimersByTime(THROTTLE_MS);
    announce('Initiative: 15', { key: 'roll', repeat: true });
    const [a, b] = getAnnouncerState().messages;
    expect(a?.text).toBe(b?.text);
    expect(a?.id).not.toBe(b?.id);
  });
});
