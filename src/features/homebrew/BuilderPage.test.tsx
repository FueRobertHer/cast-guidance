// @vitest-environment jsdom
// A collection of your own: its entries, each opening in the Workshop, and a
// delete, which is a database write that can be refused (quota, a closed
// connection, a blocked upgrade) and must say so rather than drop the entry.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namelessControls } from '../../../tests-fixtures/a11y';

const { saveEditable, invalidateRegistry, row, read } = vi.hoisted(() => ({
  saveEditable: vi.fn(),
  invalidateRegistry: vi.fn(),
  /** What the page's read resolves to; tests swap it for the other outcomes. */
  read: { current: undefined as unknown },
  row: {
    id: 'f1',
    fileName: 'brews.json',
    // `item` is typed as loosely as the file is: these rows come back from
    // IndexedDB, and nothing ever checked that their entries are entities.
    json: {
      _meta: { sources: [{ full: 'My Brews', json: 'HB' }] },
      item: [{ name: 'Old blade' }] as unknown[],
    },
    editable: true,
    sourceIds: ['HB'],
    counts: { item: 1 },
    addedAt: 1,
  },
}));

// The page reads through `homebrewRepo.getSafe`, whose result distinguishes
// still-loading from no-such-file from a file that cannot be read.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => read.current }));
vi.mock('@/db/homebrewRepo', () => ({
  homebrewRepo: { saveEditable, getSafe: () => Promise.resolve(read.current) },
}));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry }));

import { noticeStore } from '@/stores/notices';
import { Component as BuilderPage } from './BuilderPage';

read.current = { file: row };

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/homebrew/edit/f1']}>
      <Routes>
        <Route path="/homebrew/edit/:fileId" element={<BuilderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  read.current = { file: row };
  row.json.item = [{ name: 'Old blade' }];
  saveEditable.mockReset();
  invalidateRegistry.mockClear();
  noticeStore.setState({ notice: null, seq: 0 });
});

describe('BuilderPage opens entries in the Workshop', () => {
  it('links each named entry to its Workshop editor, by the name and book it is saved under', () => {
    row.json.item = [{ name: 'Old blade', source: 'HB' }, { name: 'Odd | name?' }];
    renderBuilder();

    expect(screen.getByRole('link', { name: 'Edit Old blade' }).getAttribute('href')).toBe(
      '/workshop/edit/item/Old%20blade%7CHB',
    );
    // The Workshop finds an entry by its name and its own book, so one it
    // could not find gets no link that would lead nowhere.
    expect(screen.queryByRole('link', { name: 'Edit Odd | name?' })).toBeNull();
    expect(screen.getByText(/cannot open in the Workshop/)).toBeTruthy();
  });

  it('makes a new one in the Workshop, into this file', () => {
    renderBuilder();
    for (const type of ['item', 'feat', 'spell']) {
      expect(screen.getByRole('link', { name: `New ${type}` }).getAttribute('href')).toBe(
        `/workshop/new/${type}?file=f1`,
      );
    }
    // The Builder's own forms are gone.
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
  });

  it('says nothing of the data format by its site name', () => {
    renderBuilder();
    expect(document.body.textContent).not.toMatch(/5etools/i);
    expect(document.body.textContent).toContain('standard homebrew file');
  });
});

describe('BuilderPage writes', () => {
  it('reports a refused delete instead of dropping the entity from view', async () => {
    saveEditable.mockRejectedValue(new Error('database closed'));
    renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: /^Delete\b/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not delete Old blade');
    expect(screen.getByText('Old blade')).toBeTruthy();
  });

  it('retries a delete against the file as it stands now, not as it was', async () => {
    saveEditable.mockRejectedValueOnce(new Error('database closed'));
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: /^Delete\b/ }));
    await screen.findByRole('alert');

    // Another tab adds an entity between the refused delete and the retry. A
    // retry that replayed the failed attempt's document would erase it.
    row.json.item = [{ name: 'Old blade' }, { name: 'New sword' }];
    saveEditable.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    const [, written] = saveEditable.mock.calls[1] as [string, { item: Array<{ name: string }> }];
    expect(written.item.map((i) => i.name)).toEqual(['New sword']);
    expect(noticeStore.getState().notice).toMatchObject({ title: 'Deleted Old blade' });
  });

  it('says so instead of doing nothing when the retry target is already gone', async () => {
    saveEditable.mockRejectedValueOnce(new Error('database closed'));
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: /^Delete\b/ }));
    await screen.findByRole('alert');

    row.json.item = [];
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveEditable).toHaveBeenCalledOnce();
    expect(noticeStore.getState().notice).toMatchObject({ title: 'Old blade is already gone' });
  });
});

describe('BuilderPage reads a file it did not write', () => {
  // Homebrew files are only ever checked for a `_meta` block, so an entity
  // array can hold anything JSON can: a null left by a hand-edited file, a
  // bare string, an entry whose name is a number. Reading one of those used to
  // throw inside the row list, and the failure went all the way to the route
  // boundary: the whole builder was replaced by an error screen, taking with
  // it the delete button that was the only way to fix the file.
  it('keeps a record it cannot read from taking the page down with it', () => {
    row.json.item = [null, { name: 'Old blade' }];
    renderBuilder();

    expect(screen.getByText('Old blade')).toBeTruthy();
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it('deletes an unreadable record by position and leaves the rest alone', async () => {
    row.json.item = ['just a string', { name: 'Old blade' }];
    saveEditable.mockResolvedValue(undefined);
    renderBuilder();

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete\b/ })[0] as HTMLElement);

    await waitFor(() => expect(saveEditable).toHaveBeenCalledOnce());
    const [, written] = saveEditable.mock.calls[0] as [string, { item: Array<{ name: string }> }];
    expect(written.item).toEqual([{ name: 'Old blade' }]);
    expect(noticeStore.getState().notice).toMatchObject({
      title: 'Deleted that unreadable entry',
    });
  });

  it('refuses a positional delete once a named record moved into the slot', async () => {
    row.json.item = [null, { name: 'Old blade' }];
    renderBuilder();

    row.json.item = [{ name: 'New sword' }, { name: 'Old blade' }];
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete\b/ })[0] as HTMLElement);

    await waitFor(() =>
      expect(noticeStore.getState().notice).toMatchObject({
        title: 'That entry can no longer be found',
      }),
    );
    expect(saveEditable).not.toHaveBeenCalled();
  });

  it('deletes the nameless record it was aimed at, not the one that took its slot', async () => {
    // The dangerous shift, because "the slot still holds something nameless"
    // looks exactly like a match: removing the entry above these two moves
    // both up one, and a delete aimed at the first would take the second.
    row.json.item = [{ name: 'Keep me' }, 'first bad', 'second bad'];
    saveEditable.mockResolvedValue(undefined);
    renderBuilder();

    row.json.item = ['first bad', 'second bad'];
    // Index 1 as rendered: the row showing 'first bad'.
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete\b/ })[1] as HTMLElement);

    await waitFor(() => expect(saveEditable).toHaveBeenCalledOnce());
    const [, written] = saveEditable.mock.calls[0] as [string, { item: unknown[] }];
    expect(written.item).toEqual(['second bad']);
  });

  it('says a record has no name rather than inventing one', () => {
    // `String(e.name)` used to label these "undefined" and then use that
    // string as the entity's identity for the next save or delete.
    row.json.item = [{ rarity: 'rare' }];
    renderBuilder();

    expect(screen.getByText('Unnamed item')).toBeTruthy();
    // With no name, the Workshop has nothing to open it by.
    expect(screen.queryByRole('link', { name: /^Edit/ })).toBeNull();
  });
});

describe('BuilderPage opening a file it cannot use', () => {
  it('waits while the read is still in flight', () => {
    read.current = undefined;
    renderBuilder();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('says a file is gone rather than loading forever', () => {
    // The raw read returned undefined both for "no such row" and for "not yet
    // read", so this page could not tell them apart.
    read.current = {};
    renderBuilder();
    expect(screen.getByRole('alert').textContent).toContain('no longer on this device');
    // PWA-001: a dead link names the nearest page in words, not only an icon.
    expect(screen.getByRole('link', { name: 'Go to the homebrew list' }).getAttribute('href')).toBe(
      '/homebrew',
    );
  });

  it('says why a file could not be read, and where to go about it', () => {
    read.current = { error: { id: 'f1', fileName: 'brews.json', message: 'content is not JSON' } };
    renderBuilder();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('content is not JSON');
    expect(alert.textContent).toContain('remove it from the homebrew list');
  });

  it('offers a labelled way back to homebrew in every state that has no form', () => {
    // This page sits outside the app nav, and these states used to render a
    // bare message with nothing to press.
    const states: unknown[] = [
      undefined,
      {},
      { error: { id: 'f1', fileName: 'brews.json', message: 'content is not JSON' } },
      { file: { ...row, editable: false } },
    ];
    for (const state of states) {
      read.current = state;
      renderBuilder();
      const back = screen.getByRole('link', { name: 'Back to homebrew' });
      expect(back.getAttribute('href'), JSON.stringify(state)).toBe('/homebrew');
      cleanup();
    }
  });

  it('names an imported file by its file name when its declared title is not text', () => {
    read.current = {
      file: { ...row, editable: false, json: { _meta: { sources: [{ full: { x: 1 } }] } } },
    };
    renderBuilder();
    expect(document.title).toBe('brews · Homebrew · Cast Guidance');
  });

  it('names the state it is in, in the document title', () => {
    read.current = {};
    renderBuilder();
    expect(document.title).toBe('Homebrew file not found · Cast Guidance');
  });
});

describe('BuilderPage titles and navigation', () => {
  it('names the file being edited, and labels the way back', () => {
    renderBuilder();
    expect(document.title).toBe('My Brews · Homebrew editor · Cast Guidance');
    expect(screen.getByRole('link', { name: 'Back to homebrew' }).getAttribute('href')).toBe(
      '/homebrew',
    );
  });
});

// A11Y-001: the row delete was an icon named only by its tooltip, and every
// row's "view" link read the same.
describe('BuilderPage accessible names', () => {
  it('names each row action after the record it acts on', () => {
    row.json.item = [null, { name: 'Old blade' }];
    renderBuilder();

    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Delete Old blade' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete unnamed item' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View Old blade in the library' })).toBeTruthy();
  });
});
