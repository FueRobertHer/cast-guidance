// @vitest-environment jsdom
// The drawer is mounted on every tab of every character, so what it does while
// closed is paid on every screen inside a character. A live query re-runs
// whenever the table it read changes, and every autosave writes a snapshot, so
// a query left running here re-read the fifty kept character documents on
// every change the player made and re-rendered a list nobody had opened.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/db/historyRepo', () => ({ historyRepo: { list } }));
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
