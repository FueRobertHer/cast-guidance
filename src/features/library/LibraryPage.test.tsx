// @vitest-environment jsdom
// The library's detail view had one state for every way it could fail to show
// an entity: "Loading…" forever if the compendium or the download failed, and
// "Not found" if it did not. ERR-001 is about telling those apart, and giving
// each one something to press.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestPolicy = { mode: 'all'; except: string[] } | { mode: 'only'; sources: string[] };

const { reg, refreshing, packs, policy } = vi.hoisted(() => ({
  reg: {
    current: {
      registry: null as unknown,
      status: 'loading' as string,
      error: null as string | null,
      retry: vi.fn(),
    },
  },
  /**
   * Whether a registry rebuild is in flight. Its own hook, not a field of the
   * registry state, so the pages that only want the registry do not re-render
   * every time it moves.
   */
  refreshing: { current: false },
  /**
   * The browsing policy, settable per test. Mocked as the real thing rather
   * than as identity: a source the settings hide is exactly what the scoped
   * sections have to get right, and an identity filter makes every one of
   * those paths unreachable from a test.
   */
  policy: { current: { mode: 'all', except: [] } as TestPolicy },
  packs: {
    lastType: undefined as string | undefined,
    lastOnRepaired: undefined as (() => void) | undefined,
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
  useRegistryRefreshing: () => refreshing.current,
  useSearchState: () => ({ status: 'ready', error: null, retry: vi.fn() }),
  useTypePacks: (type: string, onRepaired?: () => void) => {
    packs.lastType = type;
    packs.lastOnRepaired = onRepaired;
    return packs.current;
  },
}));
vi.mock('@/data5e/sourceFilter', () => ({
  useSourcePolicy: () => policy.current,
  applySourcePolicy: <T,>(list: readonly T[], p: TestPolicy, sourceOf: (e: T) => string) =>
    p.mode === 'all'
      ? list.filter((e) => !p.except.includes(sourceOf(e)))
      : list.filter((e) => p.sources.includes(sourceOf(e))),
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
  counts: () => ({}),
  sourceCounts: () => new Map(),
});

/** A registry whose sections differ, which is what a book's index reads. */
const registryOfTypes = (byType: Record<string, Array<Record<string, unknown>>>) => ({
  byType: (type: string) => byType[type] ?? [],
  get: (type: string, name: string) =>
    (byType[type] ?? []).find((e) => String(e.name).toLowerCase() === name.toLowerCase()),
  counts: () => ({}),
  sourceCounts: () => new Map(),
});

/** The page writes its scope into the URL, so the URL has to be observable. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

const locationNow = () => screen.getByTestId('location').textContent;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
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
  refreshing.current = false;
  policy.current = { mode: 'all', except: [] };
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
    renderAt('/library/spell/nonesuch%7Cphb');

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
    renderAt('/library/spell/nonesuch%7Cphb');

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
    renderAt('/library/spell/nonesuch%7Cphb');

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

  it('waits for the registry to catch up with a download that just landed', () => {
    // The packs go ready when the files land; the registry is rebuilt after
    // that. In between it is real but older, and reading "missing" from it
    // offers a re-download for something that has only just arrived.
    refreshing.current = true;
    renderAt('/library/spell/nonesuch%7Cphb');

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download this section again/ })).toBeNull();
  });

  it('says what is missing once nothing is left to download', () => {
    renderAt('/library/spell/nonesuch%7Cphb');

    expect(screen.getByText('nonesuch|phb')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Browse spells/i })).toBeTruthy();
  });

  it('hands the repair a way to refresh what the page is reading', () => {
    // The repair fixes rows in IndexedDB. The page reads a registry built from
    // them, and that registry has no idea a body changed, so a repair with
    // nothing to tell it leaves the same "missing" page on screen.
    renderAt('/library/spell/nonesuch%7Cphb');
    expect(packs.lastType).toBe('spell');
    expect(packs.lastOnRepaired).toBe(reg.current.retry);
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

  it('still renders it when the rest of the section failed to download', () => {
    // The page has its subject. A download that failed for everything else in
    // the section is not this page's problem, and replacing a working screen
    // with an error panel loses more than it reports.
    packs.current = { ...packs.current, status: 'error', error: 'HTTP 503' };
    renderAt('/library/spell/fireball%7Cphb');

    expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still renders it when a later registry rebuild failed', () => {
    // `useRegistryState` keeps the registry it has when a refresh throws, so a
    // single bad row landing later must not blank a page that already works.
    reg.current = { ...reg.current, error: 'one bad row' };
    renderAt('/library/spell/fireball%7Cphb');

    expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy();
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

  it('does not call a section empty while the registry is catching up', () => {
    // Every file cached means the packs are ready at once, while the registry
    // is still deserializing the whole compendium behind it.
    reg.current = { ...reg.current, registry: registryWith([]) };
    refreshing.current = true;
    renderAt('/library/spell');

    expect(screen.getByText('Downloading this section…')).toBeTruthy();
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
  });
});

describe('a rebuild that failed behind a registry still in hand', () => {
  it('says so rather than blaming the link', () => {
    // `status` stays 'ready' so pages that can still render do. For a page
    // that cannot, the cause is a rebuild that threw, which the hook knows and
    // used to tell nobody: the user was told their link was stale and offered
    // a multi-megabyte re-download that could not have fixed it.
    reg.current = { ...reg.current, error: 'QuotaExceededError' };
    renderAt('/library/spell/nonesuch%7Cphb');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('QuotaExceededError');
    expect(screen.queryByText(/The link may be from an older version/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reg.current.retry).toHaveBeenCalledOnce();
  });

  it('says so on the list too, instead of calling the section empty', () => {
    reg.current = { ...reg.current, registry: registryWith([]), error: 'QuotaExceededError' };
    renderAt('/library/spell');

    expect(screen.getByRole('alert').textContent).toContain('QuotaExceededError');
  });
});

describe('when the compendium and the download both fail', () => {
  it('names both and one press attempts both', () => {
    reg.current = { ...reg.current, registry: null, status: 'error', error: 'quota exceeded' };
    packs.current = { ...packs.current, status: 'error', error: 'HTTP 503' };
    renderAt('/library/spell/nonesuch%7Cphb');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('quota exceeded');
    expect(alert.textContent).toContain('HTTP 503');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reg.current.retry).toHaveBeenCalledOnce();
    expect(packs.current.retry).toHaveBeenCalledOnce();
  });
});

describe('books', () => {
  const phb = {
    name: "Player's Handbook",
    source: 'PHB',
    published: '2014-08-19',
    contents: [
      { name: 'Step-by-Step Characters', ordinal: { type: 'chapter', identifier: 1 } },
      { name: 'Conditions', ordinal: { type: 'appendix', identifier: 'A' }, headers: ['Blinded'] },
    ],
  };

  beforeEach(() => {
    reg.current = {
      ...reg.current,
      registry: registryOfTypes({
        book: [phb],
        spell: [
          { name: 'Fireball', source: 'PHB' },
          { name: 'Toll the Dead', source: 'XGE' },
        ],
      }),
    };
  });

  it('is a section of its own on the library home', () => {
    renderAt('/library');
    expect(screen.getByRole('link', { name: /Books/ }).getAttribute('href')).toBe('/library/book');
  });

  it("shows a book's chapters, which is what the data carries", () => {
    renderAt("/library/book/player's%20handbook%7Cphb");

    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('19 August 2014')).toBeTruthy();
    expect(screen.getByText('Step-by-Step Characters')).toBeTruthy();
    expect(screen.getByText('Appendix A.')).toBeTruthy();
    expect(screen.getByText('Blinded')).toBeTruthy();
  });

  it('indexes what the device holds from it, scoped by the link itself', () => {
    // The point of the section: one tap from a book to that book's spells,
    // rather than to every spell with the book's own list to find again.
    renderAt("/library/book/player's%20handbook%7Cphb");

    const spells = screen.getByRole('link', { name: /Spells/ });
    expect(spells.getAttribute('href')).toBe('/library/spell?source=PHB');
    // One of the two spells carries PHB; the other is a different book's.
    expect(spells.textContent).toContain('1');
  });
});

describe('a section opened scoped to one book', () => {
  // The rows are virtualized, and a jsdom viewport has no height to fill, so
  // the count beside the heading is what says a scope was applied.
  const shownCount = () =>
    screen.getByRole('heading', { name: 'Spells' }).nextElementSibling?.textContent;
  const sourcePicker = () => screen.getByRole('combobox', { name: 'Source' });

  beforeEach(() => {
    reg.current = {
      ...reg.current,
      registry: registryOfTypes({
        spell: [
          { name: 'Fireball', source: 'PHB' },
          { name: 'Magic Missile', source: 'PHB' },
          { name: 'Toll the Dead', source: 'XGE' },
        ],
      }),
    };
  });

  it("reads the scope out of the URL, so a book's link lands filtered", () => {
    renderAt('/library/spell?source=XGE');

    expect(sourcePicker()).toHaveProperty('value', 'XGE');
    expect(shownCount()).toBe('1');
    // The dropdown counts what each book holds, not how many books there are.
    expect(screen.getByRole('option', { name: /Player.s Handbook/ }).textContent).toContain('(2)');
  });

  it('writes the dropdown back to the URL, leaving other params alone', () => {
    // Scope lives in the URL so a link can carry it; that only holds if the
    // control writes there too, and writes nothing else away.
    renderAt('/library/spell?keep=1');

    fireEvent.change(sourcePicker(), { target: { value: 'PHB' } });
    expect(locationNow()).toBe('/library/spell?keep=1&source=PHB');
    expect(shownCount()).toBe('2');

    fireEvent.change(sourcePicker(), { target: { value: '' } });
    expect(locationNow()).toBe('/library/spell?keep=1');
    expect(shownCount()).toBe('3');
  });

  it('falls back to my sources when the link names a book that is not there', () => {
    renderAt('/library/spell?source=BOGUS');

    expect(sourcePicker()).toHaveProperty('value', '');
    expect(shownCount()).toBe('3');
  });

  it('matches the source code however the link spells it', () => {
    // A homebrew file writes its own code by hand, and nothing normalizes the
    // case, so a book entry saying `MyBrew` can sit over spells saying
    // `mybrew`. The count on the book page and the list behind it have to
    // agree, or the index offers a link to an empty section.
    reg.current = {
      ...reg.current,
      registry: registryOfTypes({
        spell: [{ name: 'Sudden Insight', source: 'mybrew' }],
      }),
    };
    renderAt('/library/spell?source=MyBrew');

    expect(shownCount()).toBe('1');
    // Displayed as the data spells it, so the value names a real option.
    expect(sourcePicker()).toHaveProperty('value', 'mybrew');
  });

  it('keeps a scope the settings hide, and says that is why it is offered', () => {
    // Following a book's index into a book hidden in settings should show that
    // book. It stays legible: the option says it is hidden, so the dropdown is
    // not read as the setting having failed to take.
    policy.current = { mode: 'all', except: ['XGE'] };
    renderAt('/library/spell?source=XGE');

    expect(sourcePicker()).toHaveProperty('value', 'XGE');
    expect(shownCount()).toBe('1');
    // Named specifically: the "Everything, including 1 hidden in settings"
    // option carries that phrase too, and it is a different offer.
    expect(screen.getByRole('option', { name: /Xanathar.*hidden in settings/ })).toHaveProperty(
      'value',
      'XGE',
    );
  });

  it('leaves the ordinary options unlabelled', () => {
    policy.current = { mode: 'all', except: ['XGE'] };
    renderAt('/library/spell?source=PHB');

    // The book hidden in settings is not offered when nothing points at it,
    // and the book that is scoped is offered without the note.
    expect(screen.queryByRole('option', { name: /Xanathar/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Player.s Handbook/ }).textContent).not.toContain(
      'hidden in settings',
    );
  });
});
