// @vitest-environment jsdom
// The library's detail view had one state for every way it could fail to show
// an entity: "Loading…" forever if the compendium or the download failed, and
// "Not found" if it did not. ERR-001 is about telling those apart, and giving
// each one something to press.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reg, packs } = vi.hoisted(() => ({
  reg: {
    current: {
      registry: null as unknown,
      status: 'loading' as string,
      error: null as string | null,
      retry: vi.fn(),
    },
  },
  packs: {
    current: {
      status: 'loading' as string,
      error: null as string | null,
      offline: false,
      retry: vi.fn(),
      repair: vi.fn(),
    },
  },
}));

vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => reg.current,
  useSearchState: () => ({ status: 'ready', error: null, retry: vi.fn() }),
  useTypePacks: () => packs.current,
}));
vi.mock('@/data5e/sourceFilter', () => ({
  useSourcePolicy: () => ({ mode: 'all', except: [] }),
  applySourcePolicy: (list: unknown[]) => list,
  policyForSearch: () => undefined,
}));
vi.mock('@/data5e/search/client', () => ({
  searchAll: () => Promise.resolve({ hits: [], hiddenCount: 0 }),
}));

import { Component as LibraryPage } from './LibraryPage';

/** A registry holding one spell, which is all the detail view reads. */
const registryWith = (entities: Array<Record<string, unknown>>) => ({
  byType: () => entities,
  get: (_type: string, name: string) =>
    entities.find((e) => String(e.name).toLowerCase() === name.toLowerCase()),
  sourceCounts: () => new Map(),
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library/:type?/:uid?" element={<LibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reg.current = {
    registry: registryWith([{ name: 'Fireball', source: 'PHB', entries: [] }]),
    status: 'ready',
    error: null,
    retry: vi.fn(),
  };
  packs.current = {
    status: 'ready',
    error: null,
    offline: false,
    retry: vi.fn(),
    repair: vi.fn(),
  };
});

afterEach(cleanup);

describe('the detail view when the compendium fails', () => {
  it('says so and offers the registry retry, instead of loading forever', () => {
    reg.current = { ...reg.current, registry: null, status: 'error', error: 'quota exceeded' };
    renderAt('/library/spell/fireball%7Cphb');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("compendium couldn't be loaded");
    expect(alert.textContent).toContain('quota exceeded');
    expect(screen.queryByText('Loading…')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reg.current.retry).toHaveBeenCalledOnce();
  });
});

describe('the detail view when this section will not download', () => {
  it('reports the download failure and retries that, not the registry', () => {
    packs.current = { ...packs.current, status: 'error', error: 'HTTP 503' };
    renderAt('/library/spell/fireball%7Cphb');

    expect(screen.getByRole('alert').textContent).toContain("section couldn't be downloaded");
    expect(screen.getByRole('alert').textContent).toContain('HTTP 503');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(packs.current.retry).toHaveBeenCalledOnce();
    expect(reg.current.retry).not.toHaveBeenCalled();
  });

  it('explains being offline rather than blaming the download', () => {
    // A download that cannot start because there is no network is not broken,
    // and "failed: Failed to fetch" tells the user nothing they can act on.
    packs.current = {
      ...packs.current,
      status: 'error',
      error: 'Failed to fetch',
      offline: true,
    };
    renderAt('/library/spell/fireball%7Cphb');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("You're offline");
    expect(alert.textContent).toContain('already downloaded is still here');
  });
});

describe('the detail view when the entity is not there', () => {
  it('waits for the download before calling anything missing', () => {
    // The old view said "Not found — it may live in a pack that hasn't
    // downloaded yet" while the pack was in fact still downloading.
    packs.current = { ...packs.current, status: 'loading' };
    renderAt('/library/spell/nonesuch%7Cphb');

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText(/Nothing in/)).toBeNull();
  });

  it('says what is missing once nothing is left to download', () => {
    renderAt('/library/spell/nonesuch%7Cphb');

    expect(screen.getByText('nonesuch|phb')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Browse spells/i })).toBeTruthy();
  });

  it('offers a re-download for the case a retry cannot reach', () => {
    // Every file is cached, so nothing is missing and an ordinary retry has
    // nothing to fetch. Only throwing the files away gets the section back.
    renderAt('/library/spell/nonesuch%7Cphb');

    fireEvent.click(screen.getByRole('button', { name: 'Download this section again' }));
    expect(packs.current.repair).toHaveBeenCalledOnce();
    expect(packs.current.retry).not.toHaveBeenCalled();
  });
});

describe('the detail view when it works', () => {
  it('renders the entity', async () => {
    renderAt('/library/spell/fireball%7Cphb');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a section that does not exist', () => {
  it('says there is no such section instead of showing an empty one', () => {
    // `:type` is a URL segment, so it was a string cast to an EntityType. A
    // typo produced a heading and an empty list, which reads as lost data.
    renderAt('/library/bogus');

    expect(screen.getByText('bogus')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to the library/i })).toBeTruthy();
  });

  it('says it for a detail link into that section too', () => {
    renderAt('/library/bogus/whatever');
    expect(screen.getByText('bogus')).toBeTruthy();
  });
});

describe('the type list', () => {
  it('shows the failure rather than an empty list', () => {
    packs.current = { ...packs.current, status: 'error', error: 'HTTP 503' };
    renderAt('/library/spell');

    expect(screen.getByRole('alert').textContent).toContain("couldn't be downloaded");
  });

  it('says it is still downloading rather than showing nothing', () => {
    reg.current = { ...reg.current, registry: registryWith([]) };
    packs.current = { ...packs.current, status: 'loading' };
    renderAt('/library/spell');

    expect(screen.getByText('Downloading this section…')).toBeTruthy();
  });

  it('distinguishes an empty section from one that is simply filtered', () => {
    reg.current = { ...reg.current, registry: registryWith([]) };
    renderAt('/library/spell');

    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
  });
});
