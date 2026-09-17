// @vitest-environment jsdom
// A homebrew edit is a database write, and a database write can be refused
// (quota, a closed connection, a blocked upgrade). The builder used to fire it
// and close the form, so the entity vanished from the list, the screen showed
// the edit, and the file on disk never got it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, unknown>;

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

/** Open the item form and give the entity a name, ready to save. */
function startNewItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /New item/i }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
}

afterEach(() => {
  cleanup();
  read.current = { file: row };
  row.json.item = [{ name: 'Old blade' }];
  saveEditable.mockReset();
  invalidateRegistry.mockClear();
  noticeStore.setState({ notice: null, seq: 0 });
});

describe('BuilderPage writes', () => {
  it('keeps the form and the edits when the save is refused, and says so', async () => {
    saveEditable.mockRejectedValue(new Error('QuotaExceededError'));
    renderBuilder();
    startNewItem('Sunblade');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not save Sunblade');
    expect(alert.textContent).toContain('QuotaExceededError');
    // The edit is still on screen, not silently discarded with the form.
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Sunblade');
    expect(invalidateRegistry).not.toHaveBeenCalled();
  });

  it('retries a save from the form, writing what is on screen now', async () => {
    // The retry must not replay the payload from the failed attempt: the form
    // stayed open, so anything corrected since is what the user means to save.
    saveEditable.mockRejectedValueOnce(new Error('QuotaExceededError'));
    renderBuilder();
    startNewItem('Sunblade');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    saveEditable.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sunblade II' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveEditable).toHaveBeenCalledTimes(2);
    const [, written] = saveEditable.mock.calls[1] as [string, { item: Array<{ name: string }> }];
    expect(written.item.map((i) => i.name)).toEqual(['Old blade', 'Sunblade II']);
    expect(invalidateRegistry).toHaveBeenCalledOnce();
    expect(noticeStore.getState().notice).toMatchObject({
      title: 'Saved Sunblade II',
      tone: 'good',
    });
  });

  it('refuses a second press while the first save is in flight', async () => {
    let settle = (): void => undefined;
    saveEditable.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    renderBuilder();
    startNewItem('Sunblade');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    fireEvent.click(saving);
    expect(saveEditable).toHaveBeenCalledOnce();

    settle();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sav/ })).toBeNull());
  });

  it('reports a refused delete instead of dropping the entity from view', async () => {
    saveEditable.mockRejectedValue(new Error('database closed'));
    renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not delete Old blade');
    expect(screen.getByRole('button', { name: 'Old blade' })).toBeTruthy();
  });

  it('retries a delete against the file as it stands now, not as it was', async () => {
    saveEditable.mockRejectedValueOnce(new Error('database closed'));
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alert');

    row.json.item = [];
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveEditable).toHaveBeenCalledOnce();
    expect(noticeStore.getState().notice).toMatchObject({ title: 'Old blade is already gone' });
  });

  it('saves an edited entity by identity when the list shifted underneath', async () => {
    // Writing back at the position the form was opened at would overwrite
    // whichever entity now sits there, destroying it and leaving the edit
    // unapplied. Same defect the delete path resolves by name.
    row.json.item = [{ name: 'Old blade' }, { name: 'Second blade' }];
    saveEditable.mockResolvedValue(undefined);
    renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: 'Second blade' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sunblade' } });
    row.json.item = [{ name: 'Second blade' }];
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveEditable).toHaveBeenCalledOnce());
    const [, written] = saveEditable.mock.calls[0] as [string, { item: Array<{ name: string }> }];
    expect(written.item.map((i) => i.name)).toEqual(['Sunblade']);
  });

  it('drops the failure when the form holding those edits closes', async () => {
    // The message promises the edits are still there, so it cannot outlive
    // the form that is holding them.
    saveEditable.mockRejectedValue(new Error('QuotaExceededError'));
    renderBuilder();
    startNewItem('Sunblade');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no stale retry for a save: the form is the retry', async () => {
    saveEditable.mockRejectedValue(new Error('QuotaExceededError'));
    renderBuilder();
    startNewItem('Sunblade');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('press Save to try again');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
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

    expect(screen.getByRole('button', { name: 'Old blade' })).toBeTruthy();
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it('deletes an unreadable record by position and leaves the rest alone', async () => {
    row.json.item = ['just a string', { name: 'Old blade' }];
    saveEditable.mockResolvedValue(undefined);
    renderBuilder();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);

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
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);

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
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1] as HTMLElement);

    await waitFor(() => expect(saveEditable).toHaveBeenCalledOnce());
    const [, written] = saveEditable.mock.calls[0] as [string, { item: unknown[] }];
    expect(written.item).toEqual(['second bad']);
  });

  it('saves an unnamed record over itself, not over the one that took its place', async () => {
    // Two records the file gives no usable name, so neither can be found by
    // one. Writing back at the remembered position would put the edit on the
    // wrong record and destroy it.
    row.json.item = [{ name: 'Keep me' }, { name: 123 }, { name: 456 }];
    saveEditable.mockResolvedValue(undefined);
    renderBuilder();

    fireEvent.click(screen.getAllByRole('button', { name: 'Unnamed item' })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fixed blade' } });
    row.json.item = [{ name: 123 }, { name: 456 }];
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveEditable).toHaveBeenCalledOnce());
    const [, written] = saveEditable.mock.calls[0] as [string, { item: Json[] }];
    // The edit lands on the record it was opened on, wherever that moved to,
    // and {name: 456} is untouched.
    expect(written.item).toEqual([expect.objectContaining({ name: 'Fixed blade' }), { name: 456 }]);
  });

  it('says a record has no name rather than inventing one', () => {
    // `String(e.name)` used to label these "undefined" and then use that
    // string as the entity's identity for the next save or delete.
    row.json.item = [{ rarity: 'rare' }];
    renderBuilder();

    expect(screen.getByRole('button', { name: 'Unnamed item' })).toBeTruthy();
  });
});

describe('BuilderPage opening a file it cannot use', () => {
  it('waits while the read is still in flight', () => {
    read.current = undefined;
    renderBuilder();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('says a file is gone rather than loading forever', () => {
    // Deleting the file in another tab used to leave this page on its spinner:
    // the raw read returned undefined for "no such row" and for "not yet
    // read", and the page could not tell them apart.
    read.current = {};
    renderBuilder();
    expect(screen.getByRole('alert').textContent).toContain('no longer on this device');
  });

  it('says why a file could not be read, and where to go about it', () => {
    read.current = { error: { id: 'f1', fileName: 'brews.json', message: 'content is not JSON' } };
    renderBuilder();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('content is not JSON');
    expect(alert.textContent).toContain('remove it from the homebrew list');
  });
});
