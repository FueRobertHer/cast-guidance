// @vitest-environment jsdom
// The homebrew screen is the only place a file the app cannot read can be
// removed, so it is the one screen that has to say such a file exists. Before
// the read boundary it could not: the raw Dexie read handed the row straight
// to the list, and the same row reached the registry, where it took down every
// view that needed the compendium rather than the one row that was damaged.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { read, remove } = vi.hoisted(() => ({
  read: { current: undefined as unknown },
  remove: vi.fn(),
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => read.current }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: { delete: remove } }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true), askText: vi.fn() }));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/data5e/sourceFilter', () => ({ ensureSourcesVisible: vi.fn() }));

import { Component as ManageHomebrewPage } from './ManageHomebrewPage';

const file = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  fileName: 'good.json',
  json: {},
  enabled: true,
  editable: false,
  sourceIds: ['HB'],
  counts: { spell: 2 },
  addedAt: 1,
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ManageHomebrewPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  read.current = undefined;
  remove.mockReset();
});

describe('ManageHomebrewPage read errors', () => {
  it('names the files that could not be read and keeps listing the rest', () => {
    read.current = {
      files: [file()],
      errors: [
        { id: 'b', fileName: 'broken.json', message: 'the file content is not a JSON object' },
      ],
    };
    renderPage();

    // The banner counts; the row below it names the file and offers the fix.
    expect(screen.getByRole('alert').textContent).toContain('1 file');
    expect(screen.getByText('broken.json')).toBeTruthy();
    expect(screen.getByText('good.json')).toBeTruthy();
  });

  it('gives an unreadable file a row and a way to remove it', async () => {
    // The file you most want gone is the one the app cannot read, and this is
    // the only screen that can remove it. Reporting it without a delete left
    // the builder telling people to come here and do something they could not.
    remove.mockResolvedValue(undefined);
    read.current = {
      files: [],
      errors: [{ id: 'b', fileName: 'broken.json', message: 'content is not a JSON object' }],
    };
    renderPage();

    expect(screen.getByText('broken.json')).toBeTruthy();
    expect(screen.getByText('content is not a JSON object')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('b'));
  });

  it('says so instead of offering a delete it cannot perform', () => {
    // No id means nothing can address the row, so there is no delete to offer.
    read.current = { files: [], errors: [{ message: 'the row has no id' }] };
    renderPage();

    expect(screen.getByText('An unnamed file')).toBeTruthy();
    expect(screen.queryByTitle('Delete')).toBeNull();
  });

  it('does not call a file-less device empty while it is reporting a failure', () => {
    read.current = { files: [], errors: [{ id: 'b', message: 'unreadable' }] };
    renderPage();

    expect(screen.queryByText('No homebrew imported yet.')).toBeNull();
  });

  it('says nothing when every file read cleanly', () => {
    read.current = { files: [file()], errors: [] };
    renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the empty state, not an error, with no files at all', () => {
    read.current = { files: [], errors: [] };
    renderPage();

    expect(screen.getByText('No homebrew imported yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
