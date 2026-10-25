// @vitest-environment jsdom
// The drawer is mounted on every tab of every character, so what it does while
// closed is paid on every screen inside a character. A live query re-runs
// whenever the table it read changes, and every autosave writes a snapshot, so
// a query left running here re-read the fifty kept character documents on
// every change the player made and re-rendered a list nobody had opened.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';

const { list, restore, session } = vi.hoisted(() => ({
  list: vi.fn(),
  restore: vi.fn(),
  session: { doc: null as CharacterDoc | null },
}));
vi.mock('@/db/historyRepo', () => ({ historyRepo: { list } }));
vi.mock('@/stores/characterSession', () => ({
  characterSessionStore: { getState: () => ({ restore, flush: async () => undefined }) },
  useCharacterSession: <T,>(select: (s: { doc: CharacterDoc | null }) => T) => select(session),
}));
// Stands in for Dexie's live query: runs the query, returns what it resolves.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

// vaul reads this on open and jsdom does not provide it.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

import { HistoryDrawer } from './HistoryDrawer';

afterEach(() => {
  cleanup();
  list.mockReset();
  restore.mockReset();
  session.doc = null;
});

describe('the history drawer while closed', () => {
  it('does not query the history', () => {
    list.mockReturnValue([]);
    render(<HistoryDrawer charId="c1" />);
    expect(list).not.toHaveBeenCalled();
  });

  it('queries once it is opened', async () => {
    list.mockReturnValue([{ id: 'h1', charId: 'c1', at: Date.now(), label: 'Edited', doc: {} }]);
    render(<HistoryDrawer charId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(list).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Edited')).toBeTruthy();
  });
});

describe('restoring from history (UX-005)', () => {
  const withHp = (hp: number): CharacterDoc => {
    const doc = newCharacterDoc('c1', 'Wren', 't');
    doc.play.currentHp = hp;
    return doc;
  };
  const row = (id: string, label: string, doc: CharacterDoc) => ({
    id,
    charId: 'c1',
    at: Date.now(),
    label,
    doc,
  });
  const open = async () => {
    render(<HistoryDrawer charId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Character history' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  };

  it('previews what restoring would change before offering Restore', async () => {
    session.doc = withHp(12);
    const older = withHp(20);
    list.mockReturnValue([row('h2', 'HP 20→12', withHp(12)), row('h1', 'Long rest', older)]);
    await open();

    // Nothing restores on the first tap any more.
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    const preview = screen.getByRole('button', { name: /^Preview "Long rest"/ });
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(preview);

    expect(preview.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listitem').textContent).toBe('HP 12 → 20');
    fireEvent.click(screen.getByRole('button', { name: /^Restore "Long rest"/ }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(older));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers no Restore for an entry that already matches the character', async () => {
    // Compared with what is on screen, not the newest row, which can lag an
    // edit still waiting on the debounce: here the newest row is behind.
    session.doc = withHp(12);
    list.mockReturnValue([row('h2', 'HP 20→15', withHp(15)), row('h1', 'HP 20→12', withHp(12))]);
    await open();

    expect(screen.getAllByText('same as now')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Preview "HP 20→12"/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Preview "HP 20→15"/ })).toBeTruthy();
  });

  it('compares nothing against a character it is not showing', async () => {
    // Right after a route change the session can still hold the last character.
    session.doc = { ...withHp(12), id: 'someone-else' };
    list.mockReturnValue([row('h2', 'HP 20→12', withHp(12)), row('h1', 'Long rest', withHp(20))]);
    await open();

    expect(screen.queryByText('same as now')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Preview/ })).toBeNull();
  });
});
