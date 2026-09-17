// @vitest-environment jsdom
// The repair flow with nothing mocked but the network: real loader, real
// hooks, real registry, real page, real IndexedDB.
//
// Every other test of this feature stands on one side of a seam and mocks the
// other, and the bug this exists to catch lives exactly between them. Twice
// the repair was shipped fixing rows in IndexedDB and changing nothing on
// screen: once because the registry was never invalidated, once because the
// registry's signature is built from paths and a repair changes only bodies.
// Both passed every test at the time.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchFile } = vi.hoisted(() => ({ fetchFile: vi.fn() }));
vi.mock('@/data5e/source', () => ({
  GithubTagSource: class {
    readonly tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    fetchFile(path: string): Promise<unknown> {
      return fetchFile(this.tag, path) as Promise<unknown>;
    }
  },
}));

import { DATA_TAG } from '@/data5e/config';
import { invalidateRegistry } from '@/data5e/registry';
import { db } from '@/db/db';
import { Component as LibraryPage } from './LibraryPage';

/** What the mirror serves once the section is healthy. */
const healthy = (_tag: string, path: string): Promise<unknown> =>
  Promise.resolve(path === 'races.json' ? { race: [{ name: 'Elf', source: 'PHB' }] } : {});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library/:type?/:uid?" element={<LibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  invalidateRegistry();
  fetchFile.mockReset().mockImplementation(healthy);
});

afterEach(cleanup);

/**
 * A device holding every file it needs, with one body that is not what it
 * should be: the download has nothing missing to fetch, so only a repair can
 * put it right. This is what a truncated write or a bad proxy response leaves.
 */
async function cacheWithPoisonedRaces(): Promise<void> {
  await db.dataFiles.put({
    key: `${DATA_TAG}:races.json`,
    tag: DATA_TAG,
    path: 'races.json',
    pack: 'essentials',
    json: { race: [] },
    bytes: 10,
    fetchedAt: 1,
  });
}

describe('repairing a section from the page that reports it', () => {
  it('puts the entity on screen without a reload', async () => {
    await cacheWithPoisonedRaces();
    renderAt(`/library/race/${encodeURIComponent('elf|phb')}`);

    // The row is cached, so nothing is missing and the page settles on the one
    // honest thing it can say: this is not in the data.
    await screen.findByText(/Nothing in/);
    const repair = screen.getByRole('button', { name: 'Download this section again' });

    fireEvent.click(repair);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elf' })).toBeTruthy());
    const row = await db.dataFiles.get(`${DATA_TAG}:races.json`);
    expect((row?.json as { race: unknown[] }).race).toHaveLength(1);
  });

  it('reports a repair that could not download, and keeps what it has', async () => {
    await cacheWithPoisonedRaces();
    renderAt(`/library/race/${encodeURIComponent('elf|phb')}`);
    await screen.findByText(/Nothing in/);

    fetchFile.mockRejectedValue(new Error('HTTP 503'));
    fireEvent.click(screen.getByRole('button', { name: 'Download this section again' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 503');
    // Nothing was thrown away to make room for a download that never came.
    expect(await db.dataFiles.get(`${DATA_TAG}:races.json`)).toBeDefined();
  });

  it('recovers on a second press once the download works again', async () => {
    await cacheWithPoisonedRaces();
    renderAt(`/library/race/${encodeURIComponent('elf|phb')}`);
    await screen.findByText(/Nothing in/);

    fetchFile.mockRejectedValue(new Error('HTTP 503'));
    fireEvent.click(screen.getByRole('button', { name: 'Download this section again' }));
    await screen.findByRole('alert');

    fetchFile.mockImplementation(healthy);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // The retry finds nothing missing, so it settles back on the same honest
    // "not in the data" page, which is where the repair is offered.
    fireEvent.click(await screen.findByRole('button', { name: 'Download this section again' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elf' })).toBeTruthy());
  });

  it('leaves an entity that is genuinely absent absent, having tried', async () => {
    await cacheWithPoisonedRaces();
    renderAt(`/library/race/${encodeURIComponent('nosuchrace|phb')}`);
    await screen.findByText(/Nothing in/);

    fireEvent.click(screen.getByRole('button', { name: 'Download this section again' }));

    // The section is repaired and the answer does not change, which is the
    // honest outcome for a link that was wrong to begin with. Waited for
    // rather than asserted on the spot: the repair passes through "Loading…"
    // first, and reading the page mid-flight is reading the wrong frame.
    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(DATA_TAG, 'races.json'));
    expect(await screen.findByText(/Nothing in/)).toBeTruthy();
  });
});
