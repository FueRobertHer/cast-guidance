// @vitest-environment jsdom
// The homebrew screen is the only place a file the app cannot read can be
// removed, so it is the one screen that has to say such a file exists. Before
// the read boundary it could not: the raw Dexie read handed the row straight
// to the list, and the same row reached the registry, where it took down every
// view that needed the compendium rather than the one row that was damaged.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { read } = vi.hoisted(() => ({ read: { current: undefined as unknown } }));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => read.current }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: {} }));
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

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('1 file');
    expect(alert.textContent).toContain('broken.json');
    expect(screen.getByText('good.json')).toBeTruthy();
  });

  it('falls back to the id when even the name is gone', () => {
    read.current = { files: [], errors: [{ id: 'b', message: 'the row has no content' }] };
    renderPage();

    expect(screen.getByRole('alert').textContent).toContain('b');
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
