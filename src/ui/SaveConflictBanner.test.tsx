// @vitest-environment jsdom
// REL-007 (#98): a save another tab got ahead of is refused, and this banner
// is the person's way out of it. Said once (A11Y-002), as the save-error
// banner is, and the outcome once.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import {
  type CharacterSessionState,
  type ConflictOutcome,
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

/** A resolution that ends the conflict, as the session does, with `outcome`. */
function resolving(outcome: ConflictOutcome | undefined) {
  return vi.fn<Resolve>(async (id) => {
    const { [id]: _, ...rest } = characterSessionStore.getState().saveConflicts;
    characterSessionStore.setState({ saveConflicts: rest });
    return outcome;
  });
}

function renderBanner(resolve: Resolve = resolving('reloaded')) {
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
    ['Reload stored version', changed, 'reload', 'reloaded'],
    ['Keep mine (overwrite)', changed, 'overwrite', 'kept'],
    ['Discard my edits', deleted, 'reload', 'discarded'],
    ['Keep mine (restore it)', deleted, 'overwrite', 'kept'],
  ] as const)('%s resolves with %s, says so once, and lands on the heading', async (button, kind, choice, outcome) => {
    const said = CONFLICT_RESOLVED_TEXT[outcome];
    const resolve = renderBanner(resolving(outcome));
    conflict({ c1: kind });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: button }));
    });
    expect(resolve).toHaveBeenCalledWith('c1', choice);
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual([said]);
    expect(getAnnouncerState().emitted).toBe(1);
    expect(document.activeElement?.id).toBe('sheet-title');
  });

  it('says what came of it, not what was pressed', async () => {
    // Discard on a deleted character that another tab brought back loads it.
    renderBanner(resolving('reloaded'));
    conflict({ c1: deleted });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard my edits' }));
    });
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual([
      CONFLICT_RESOLVED_TEXT.reloaded,
    ]);
  });

  it('keeps focus on its buttons, silently, when the choice did not go through', async () => {
    // Refused again: the session raises the conflict anew, so the banner
    // goes and comes back, and focus must not be left on the page body.
    renderBanner(
      vi.fn<Resolve>(async () => {
        characterSessionStore.setState({ saveConflicts: {} });
        characterSessionStore.setState({ saveConflicts: { c1: { ...changed } } });
        return undefined;
      }),
    );
    conflict({ c1: changed });
    const button = screen.getByRole('button', { name: 'Keep mine (overwrite)' });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(getAnnouncerState().emitted).toBe(0);
    expect(document.activeElement?.textContent).toBe('Reload stored version');
  });

  it('moves focus to the heading when it goes away without a resolution', async () => {
    // Keep mine whose save then failed for lack of space: the save error
    // banner takes over, and this one goes.
    renderBanner(resolving(undefined));
    conflict({ c1: changed });
    const button = screen.getByRole('button', { name: 'Keep mine (overwrite)' });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(getAnnouncerState().emitted).toBe(0);
    expect(document.activeElement?.id).toBe('sheet-title');
  });

  it('with another conflict waiting, says nothing over its alert and keeps focus on it', async () => {
    renderBanner(resolving('reloaded'));
    conflict({ c1: changed, c2: { kind: 'changed', name: 'Bram' } });
    const listener = listenForAnnouncements();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload stored version' }));
    });
    listener.stop();
    expect(getAnnouncerState().emitted).toBe(0);
    // The next one is a new alert, said once.
    expect(listener.heard).toHaveLength(1);
    expect(listener.heard[0]).toContain(conflictText({ kind: 'changed', name: 'Bram' }, 1));
    expect(screen.getByRole('alert').textContent).toContain('Bram was changed');
    expect(document.activeElement?.textContent).toBe('Reload stored version');
  });

  it('says so when the stored copy could not be read, and stays with its buttons', async () => {
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
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual(['Reload failed. read failed']);
    expect(document.activeElement?.textContent).toBe('Reload stored version');
  });

  it('names an unnamed character as this one', () => {
    expect(conflictText({ kind: 'deleted', name: ' ' }, 1)).toBe(
      'This character was deleted in another tab. Your edits here have not been saved.',
    );
  });
});
