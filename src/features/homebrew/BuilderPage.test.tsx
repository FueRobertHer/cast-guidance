// @vitest-environment jsdom
// A homebrew edit is a database write, and a database write can be refused
// (quota, a closed connection, a blocked upgrade). The builder used to fire it
// and close the form, so the entity vanished from the list, the screen showed
// the edit, and the file on disk never got it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { saveEditable, invalidateRegistry, row } = vi.hoisted(() => ({
  saveEditable: vi.fn(),
  invalidateRegistry: vi.fn(),
  row: {
    id: 'f1',
    fileName: 'brews.json',
    json: { _meta: { sources: [{ full: 'My Brews', json: 'HB' }] }, item: [{ name: 'Old blade' }] },
    editable: true,
    sourceIds: ['HB'],
    counts: { item: 1 },
    addedAt: 1,
  },
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => row }));
vi.mock('@/db/db', () => ({ db: { homebrewFiles: { get: () => Promise.resolve(row) } } }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: { saveEditable } }));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry }));

import { noticeStore } from '@/stores/notices';
import { Component as BuilderPage } from './BuilderPage';

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
