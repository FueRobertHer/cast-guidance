// @vitest-environment jsdom
// REL-007 (#98): a save another tab got ahead of is refused, and this banner
// is the person's way out of it. Said once (A11Y-002), as the save-error
// banner is, and the outcome once.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import {
  type CharacterSessionState,
  characterSessionStore,
  type SaveConflict,
} from '@/stores/characterSession';
import { noticeStore } from '@/stores/notices';
import { listenForAnnouncements } from '../../tests-fixtures/announcements';
import { CONFLICT_RESOLVED_TEXT, conflictText, SaveConflictBanner } from './SaveConflictBanner';

const changed: SaveConflict = { kind: 'changed', name: 'Wren' };
const deleted: SaveConflict = { kind: 'deleted', name: 'Wren' };

const conflict = (saveConflicts: Record<string, SaveConflict>) =>
  act(() => characterSessionStore.setState({ saveConflicts }));

type Resolve = CharacterSessionState['resolveConflict'];

function renderBanner(resolve: Resolve = vi.fn<Resolve>(async () => true)) {
  render(
    <>
      <h1 id="sheet-title" tabIndex={-1}>
        Wren
      </h1>
      <SaveConflictBanner resolve={resolve} />
    </>,
  );
  return resolve;
}

beforeEach(() => {
  resetAnnouncer();
  noticeStore.setState({ notice: null, seq: 0 });
  // The focus move waits a frame; run it at once.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  characterSessionStore.setState({ saveConflicts: {} });
  resetAnnouncer();
  vi.restoreAllMocks();
});

describe('SaveConflictBanner', () => {
  it('is absent while nothing is refused', () => {
    renderBanner();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what happened and offers both ways out, in one alert', () => {
    renderBanner();
    conflict({ c1: changed });

    const alert = screen.getByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert.textContent).toContain(
      'Wren was changed in another tab. Your edits here have not been saved. Both versions stay in History.',
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Reload stored version', 'Keep mine (overwrite)']);
    // The main action is the filled one.
    expect(screen.getByRole('button', { name: 'Reload stored version' }).className).toContain(
      'bg-accent-fill',
    );
  });

  it('offers the deleted choices for a character deleted in another tab', () => {
    renderBanner();
    conflict({ c1: deleted });
    expect(screen.getByRole('alert').textContent).toContain(
      'Wren was deleted in another tab. Your edits here have not been saved.',
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Discard my edits',
      'Keep mine (restore it)',
    ]);
  });

  it('counts the characters affected, and acts on the first', async () => {
    const resolve = renderBanner();
    conflict({ c1: changed, c2: { kind: 'changed', name: 'Bram' } });
    expect(screen.getByRole('alert').textContent).toContain('(2 characters affected)');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep mine (overwrite)' }));
    });
    expect(resolve).toHaveBeenCalledWith('c1', 'overwrite');
  });

  it('stays the same alert, with the same words, while the conflict lasts', () => {
    renderBanner();
    const listener = listenForAnnouncements();
    conflict({ c1: changed });
    const alert = screen.getByRole('alert');
    const text = alert.textContent;
    // Edits keep arriving while it is up; the session publishes each.
    for (let i = 0; i < 3; i++) {
      act(() =>
        characterSessionStore.setState({ saveStatus: 'conflict', saveConflicts: { c1: changed } }),
      );
    }
    listener.stop();
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toBe(text);
    // Said once, by the alert itself, and not through the announcer too.
    expect(listener.heard).toHaveLength(1);
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it.each([
    ['Reload stored version', changed, 'reload', CONFLICT_RESOLVED_TEXT.reload],
    ['Keep mine (overwrite)', changed, 'overwrite', CONFLICT_RESOLVED_TEXT.overwrite],
    ['Discard my edits', deleted, 'reload', CONFLICT_RESOLVED_TEXT.discard],
    ['Keep mine (restore it)', deleted, 'overwrite', CONFLICT_RESOLVED_TEXT.overwrite],
  ] as const)('%s resolves with %s, says so once, and lands on the heading', async (button, kind, choice, said) => {
    const resolve = renderBanner();
    conflict({ c1: kind });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: button }));
    });
    expect(resolve).toHaveBeenCalledWith('c1', choice);
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual([said]);
    expect(getAnnouncerState().emitted).toBe(1);
    expect(document.activeElement?.id).toBe('sheet-title');
  });

  it('neither speaks nor moves focus when the choice did not go through', async () => {
    renderBanner(vi.fn<Resolve>(async () => false));
    conflict({ c1: changed });
    const button = screen.getByRole('button', { name: 'Keep mine (overwrite)' });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(getAnnouncerState().emitted).toBe(0);
    expect(document.activeElement).toBe(button);
  });

  it('says so when the stored copy could not be read', async () => {
    renderBanner(
      vi.fn<Resolve>(async () => {
        throw new Error('read failed');
      }),
    );
    conflict({ c1: changed });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload stored version' }));
    });
    expect(noticeStore.getState().notice).toMatchObject({ title: 'Reload failed', tone: 'warn' });
  });

  it('names an unnamed character as this one', () => {
    expect(conflictText({ kind: 'deleted', name: ' ' }, 1)).toBe(
      'This character was deleted in another tab. Your edits here have not been saved.',
    );
  });
});
