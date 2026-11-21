// @vitest-environment jsdom
// The library's detail view had one state for every way it could fail to show
// an entity: "Loading…" forever if the compendium or the download failed, and
// "Not found" if it did not. ERR-001 is about telling those apart, and giving
// each one something to press.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { namelessControls } from '../../../tests-fixtures/a11y';

type TestPolicy = { mode: 'all'; except: string[] } | { mode: 'only'; sources: string[] };

const { reg, refreshing, packs, policy, search, searchAll } = vi.hoisted(() => ({
  /** The search index state, settable per test. */
  search: { current: { status: 'ready', error: null, retry: () => undefined, indexVersion: 1 } },
  searchAll: vi.fn(),
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
  useSearchState: () => search.current,
  useTypePacks: (type: string, onRepaired?: () => void) => {
    packs.lastType = type;
    packs.lastOnRepaired = onRepaired;
    return packs.current;
  },
}));
vi.mock('@/data5e/sourceFilter', () => ({
  useSourcePolicy: () => policy.current,
  applySourcePolicy: <T,>(
    list: readonly T[],
    p: TestPolicy,
    sourceOf: (e: T) => string,
    keep?: (e: T) => boolean,
  ) =>
    list.filter(
      (e) =>
        (p.mode === 'all' ? !p.except.includes(sourceOf(e)) : p.sources.includes(sourceOf(e))) ||
        keep?.(e) === true,
    ),
  policyForSearch: () => undefined,
}));
vi.mock('@/data5e/search/client', () => ({ searchAll }));
/** Which classes' lists hold each spell, as the generated lookup has it; settable per test. */
const classLookup = vi.hoisted(() => ({
  current: {} as Record<string, Record<string, unknown>>,
  /** Whether its read failed, and what Retry calls. */
  failed: false,
  retry: vi.fn(),
}));
vi.mock('@/lib/useClassLookup', () => ({
  useClassLookup: () => ({
    lookup: classLookup.failed ? {} : classLookup.current,
    problem: {
      status: classLookup.failed ? 'error' : 'ready',
      error: classLookup.failed ? 'storage refused' : null,
      offline: false,
      retry: classLookup.retry,
    },
  }),
}));
// No IndexedDB here: the player has no files of their own, so every entry
// offers Make it yours.
vi.mock('@/db/homebrewRepo', () => ({
  homebrewRepo: { ownedSafe: async () => ({ files: [], errors: [] }) },
}));
// Dexie's live query waits on a database jsdom does not have; the query above
// needs none, so its answer is simply awaited.
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: <T,>(query: () => Promise<T>) => {
      const [value, setValue] = useState<T | undefined>(undefined);
      useEffect(() => {
        void query().then(setValue);
      }, []);
      return value;
    },
  };
});

import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import {
  entityRowHeight,
  Component as LibraryPage,
  SEARCH_SETTLE_MS,
  searchSpeech,
} from './LibraryPage';

/** A registry holding one spell, which is all the detail view reads. */
const registryWith = (entities: Array<Record<string, unknown>>) => ({
  byType: () => entities,
  get: (_type: string, name: string) =>
    entities.find((e) => String(e.name).toLowerCase() === name.toLowerCase()),
  counts: () => ({}),
  sourceCounts: () => new Map(),
  changeOf: () => undefined,
});

/** A registry whose sections differ, which is what a book's index reads. */
const registryOfTypes = (byType: Record<string, Array<Record<string, unknown>>>) => ({
  byType: (type: string) => byType[type] ?? [],
  get: (type: string, name: string) =>
    (byType[type] ?? []).find((e) => String(e.name).toLowerCase() === name.toLowerCase()),
  counts: () => ({}),
  sourceCounts: () => new Map(),
  changeOf: () => undefined,
});

/** The page writes its scope into the URL, so the URL has to be observable. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

const locationNow = () => screen.getByTestId('location').textContent;

function renderAt(path: string) {
  return renderAtEntries([path], 0);
}

/** For the cases that need history behind the page, which a deep link lacks. */
function renderAtEntries(entries: string[], index: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
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
  search.current = { status: 'ready', error: null, retry: () => undefined, indexVersion: 1 };
  searchAll.mockReset().mockResolvedValue({ hits: [], hiddenCount: 0 });
  policy.current = { mode: 'all', except: [] };
  packs.current = {
    status: 'ready',
    error: null,
    offline: false,
    retry: vi.fn(),
    repair: vi.fn(),
  };
  // The type list scrolls with the window, and its virtualizer sets the
  // window's offset as it mounts, which jsdom does not implement.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.mocked(window.scrollTo).mockRestore();
  dbLifecycleStore.setState({ state: 'open' });
});

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
    // The shell's data banner is alerting the stopped download, as it does offline.
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    // A download that cannot start because there is no network is not broken,
    // and "failed: Failed to fetch" tells the user nothing they can act on.
    packs.current = {
      ...packs.current,
      status: 'error',
      error: 'Failed to fetch',
      offline: true,
    };
    renderAt('/library/spell/nonesuch%7Cphb');

    const panel = screen.getByText(/^You're offline/).closest('div');
    expect(panel?.textContent).toContain('already downloaded is still here');
    // A visual offline: the shell's data banner is the alert that says it
    // (A11Y-002, one voice per failure).
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays a visual online too while the data banner alerts a failed download', () => {
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 503' });
    packs.current = { ...packs.current, status: 'error', error: 'HTTP 503', offline: false };
    renderAt('/library/spell/nonesuch%7Cphb');
    expect(screen.getByText(/section couldn't be downloaded/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    dataStatusStore.setState({ phase: 'idle', error: undefined });
  });

  it('tries the section again by itself once the device is back online', () => {
    // PWA-001: the offline line is read when the download fails, so without a
    // retry it went on saying "You're offline" after the network returned.
    packs.current = { ...packs.current, status: 'error', error: 'Failed to fetch', offline: true };
    renderAt('/library/spell/nonesuch%7Cphb');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(packs.current.retry).toHaveBeenCalledOnce();
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

  it('opens a subclass from a {@subclass} link, which names it by its short name and class', () => {
    reg.current = {
      ...reg.current,
      registry: registryOfTypes({
        subclass: [
          {
            name: 'Path of the Berserker',
            shortName: 'Berserker',
            source: 'PHB',
            className: 'Barbarian',
            classSource: 'PHB',
            entries: [],
          },
        ],
      }),
    };
    renderAt('/library/subclass/berserker%7Cbarbarian%7Cphb%7Cphb');

    expect(screen.getByRole('heading', { name: 'Path of the Berserker' })).toBeTruthy();
  });

  it('still renders it when a later registry rebuild failed', () => {
    // `useRegistryState` keeps the registry it has when a refresh throws, so a
    // single bad row landing later must not blank a page that already works.
    reg.current = { ...reg.current, error: 'one bad row' };
    renderAt('/library/spell/fireball%7Cphb');

    expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy();
  });
});

describe("a spell's page", () => {
  it('shows its At Higher Levels text, which the data keeps apart from the rest', () => {
    // Review finding 15: only the sheet's spell sheet showed it.
    reg.current = {
      ...reg.current,
      registry: registryWith([
        {
          name: 'Fireball',
          source: 'XPHB',
          level: 3,
          entries: ['A bright streak flashes.'],
          entriesHigherLevel: [
            {
              type: 'entries',
              name: 'Using a Higher-Level Spell Slot',
              entries: ['The damage increases by 1d6 for each spell slot level above 3.'],
            },
          ],
        },
      ]),
    };
    renderAt('/library/spell/fireball%7Cxphb');

    expect(screen.getByText('A bright streak flashes.')).toBeTruthy();
    expect(screen.getByText('Using a Higher-Level Spell Slot', { exact: false })).toBeTruthy();
    expect(screen.getByText(/increases by/)).toBeTruthy();
  });

  it('puts Make it yours after the rules text, which a lookup is for', async () => {
    reg.current = {
      ...reg.current,
      registry: registryWith([
        { name: 'Fireball', source: 'PHB', level: 3, entries: ['A bright streak flashes.'] },
      ]),
    };
    renderAt('/library/spell/fireball%7Cphb');

    const offer = await screen.findByRole('heading', { name: 'Make it yours' });
    const text = screen.getByText('A bright streak flashes.');
    expect(text.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('an entry the table has changed', () => {
  /** A registry whose one spell stands over the book's, as a change to the books places it. */
  const changedWorld = (from: { kind: string; source: string }) => {
    const base = { name: 'Guiding Bolt', source: 'XPHB', level: 1, entries: ['4d6 radiant.'] };
    const placed = { ...base, entries: ['5d6 radiant.'] };
    const pack = { name: 'Dawnstar Campaign Rules', source: 'DAWN' };
    const record = {
      type: 'spell',
      base,
      placed,
      layers: [{ from, entry: placed, below: base, shared: true, needsLook: [] }],
    };
    return {
      byType: (type: string) => (type === 'spell' ? [placed] : type === 'rulePack' ? [pack] : []),
      get: () => placed,
      counts: () => ({}),
      sourceCounts: () => new Map(),
      changeOf: (e: unknown) => (e === placed || e === base ? record : undefined),
    };
  };

  it('is marked Changed, says whose version it is, and shows the book’s on a tap', () => {
    reg.current = { ...reg.current, registry: changedWorld({ kind: 'changes', source: 'MINE' }) };
    renderAt('/library/spell/guiding%20bolt%7Cxphb');

    expect(screen.getByRole('heading', { name: 'Guiding Bolt' })).toBeTruthy();
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getByText(/from Changes to the books/)).toBeTruthy();
    expect(screen.getByText('5d6 radiant.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show the book’s version' }));
    expect(screen.getByText('4d6 radiant.')).toBeTruthy();
    expect(screen.queryByText('5d6 radiant.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show your table’s version' }));
    expect(screen.getByText('5d6 radiant.')).toBeTruthy();
  });

  it('names the rule pack that changed it for everyone', () => {
    // Gemini track B, F22: a pack's change showed with no sign of it.
    reg.current = { ...reg.current, registry: changedWorld({ kind: 'pack', source: 'DAWN' }) };
    renderAt('/library/spell/guiding%20bolt%7Cxphb');

    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getByText(/from the rule pack Dawnstar Campaign Rules/)).toBeTruthy();
  });

  it("opens on the table's version again after a trip to another printing", () => {
    const world = changedWorld({ kind: 'changes', source: 'MINE' });
    const old = {
      name: 'Guiding Bolt',
      source: 'PHB',
      reprintedAs: ['Guiding Bolt|XPHB'],
      entries: ['The 2014 text.'],
    };
    const [placed] = world.byType('spell');
    reg.current = {
      ...reg.current,
      registry: {
        ...world,
        byType: (type: string) => (type === 'spell' ? [old, placed] : world.byType(type)),
        get: (_t: string, _n: string, source?: string) =>
          source?.toLowerCase() === 'phb' ? old : placed,
      },
    };
    renderAt('/library/spell/guiding%20bolt%7Cxphb');
    const chip = (name: RegExp) =>
      within(screen.getByRole('group', { name: 'Printed in' })).getByRole('button', { name });

    fireEvent.click(screen.getByRole('button', { name: 'Show the book’s version' }));
    expect(screen.getByText('4d6 radiant.')).toBeTruthy();
    fireEvent.click(chip(/^PHB/));
    expect(screen.getByText('The 2014 text.')).toBeTruthy();
    fireEvent.click(chip(/^XPHB/));
    expect(screen.getByText('5d6 radiant.')).toBeTruthy();
  });

  it('is not marked for a book entry nothing changed', () => {
    renderAt('/library/spell/fireball%7Cphb');
    expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy();
    expect(screen.queryByText('Changed')).toBeNull();
  });
});

describe('what an entry page lists (Gemini 43)', () => {
  afterEach(() => {
    classLookup.current = {};
  });

  it('names the classes and subclasses whose lists hold a spell, each a link', () => {
    classLookup.current = {
      phb: {
        fireball: {
          class: { PHB: { Wizard: true, Sorcerer: true } },
          subclass: {
            PHB: { Fighter: { PHB: { 'Eldritch Knight': { name: 'Eldritch Knight' } } } },
          },
        },
      },
    };
    renderAt('/library/spell/fireball%7Cphb');

    const classes = screen.getByText('Classes').nextElementSibling as HTMLElement;
    const links = within(classes).getAllByRole('link');
    // Alphabetical, whatever order the lookup has them in.
    expect(links.map((l) => l.textContent)).toEqual(['Sorcerer', 'Wizard']);
    expect(links[1]?.getAttribute('href')).toBe('/library/class/Wizard%7CPHB');
    const subclass = within(
      screen.getByText('Subclasses').nextElementSibling as HTMLElement,
    ).getByRole('link');
    expect(subclass.textContent).toBe('Eldritch Knight (Fighter)');
    expect(subclass.getAttribute('href')).toBe(
      '/library/subclass/Eldritch%20Knight%7CFighter%7CPHB%7CPHB',
    );
  });

  it('leaves out a class from a book the settings hide', () => {
    classLookup.current = {
      phb: { fireball: { class: { PHB: { Wizard: true }, WoW: { Mage: true } } } },
    };
    policy.current = { mode: 'all', except: ['WoW'] };
    renderAt('/library/spell/fireball%7Cphb');

    const classes = screen.getByText('Classes').nextElementSibling as HTMLElement;
    expect(
      within(classes)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Wizard']);
  });

  it('has no list rows for a spell on no list', () => {
    renderAt('/library/spell/fireball%7Cphb');
    expect(screen.queryByText('Classes')).toBeNull();
  });

  describe('a class', () => {
    const wizard = {
      name: 'Wizard',
      source: 'XPHB',
      edition: 'one',
      entries: [],
      startingProficiencies: { weapons: ['simple'] },
      classTableGroups: [{ colLabels: ['Cantrips'], rows: [[3]] }],
    };
    const subclass = (shortName: string, source: string, edition?: string) => ({
      name: shortName,
      shortName,
      source,
      className: 'Wizard',
      classSource: 'XPHB',
      ...(edition === undefined ? {} : { edition }),
      entries: [],
    });

    beforeEach(() => {
      reg.current = {
        ...reg.current,
        registry: registryOfTypes({
          class: [wizard],
          classFeature: [
            {
              name: 'Arcane Recovery',
              source: 'XPHB',
              className: 'Wizard',
              classSource: 'XPHB',
              level: 1,
              entries: [],
            },
          ],
          subclass: [
            subclass('Abjurer', 'XPHB', 'one'),
            subclass('Abjuration', 'PHB', 'classic'),
            subclass('Scribes', 'TCE'),
          ],
        }),
      };
    });

    it('lists its proficiencies', () => {
      renderAt('/library/class/wizard%7Cxphb');
      expect(screen.getByRole('heading', { name: 'Proficiencies' })).toBeTruthy();
      expect(screen.getByText('Simple weapons')).toBeTruthy();
    });

    it('has a level table with the proficiency bonus, features and its own columns', () => {
      renderAt('/library/class/wizard%7Cxphb');
      const table = within(screen.getByRole('region', { name: 'The Wizard table' })).getByRole(
        'table',
      );
      expect(within(table).getByRole('columnheader', { name: 'Cantrips' })).toBeTruthy();
      const first = within(table).getByRole('row', { name: /^1 \+2/ });
      expect(within(first).getByRole('link', { name: 'Arcane Recovery' })).toBeTruthy();
      expect(within(first).getByRole('cell', { name: '3' })).toBeTruthy();
      // Twenty levels and the header.
      expect(within(table).getAllByRole('row')).toHaveLength(21);
    });

    it("groups its subclasses by the rules they are for, the class's own first (Gemini 47)", () => {
      renderAt('/library/class/wizard%7Cxphb');
      const groups = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
      expect(groups).toEqual(['2024 rules', '2014 rules']);
      const newer = screen.getByRole('heading', { name: '2024 rules' }).nextElementSibling;
      expect(within(newer as HTMLElement).getByRole('link').textContent).toMatch(/^Abjurer/);
      const older = screen.getByRole('heading', { name: '2014 rules' }).nextElementSibling;
      expect(
        within(older as HTMLElement)
          .getAllByRole('link')
          .map((l) => /^\w+/.exec(l.textContent ?? '')?.[0]),
      ).toEqual(['Abjuration', 'Scribes']);
    });
  });
});

describe('the item sections', () => {
  it('each say where the other kind of item is (Gemini 46)', () => {
    renderAt('/library/item');
    expect(screen.getByRole('link', { name: 'Basic equipment' }).getAttribute('href')).toBe(
      '/library/baseitem',
    );
    cleanup();
    renderAt('/library/baseitem');
    expect(screen.getByRole('link', { name: 'Items' }).getAttribute('href')).toBe('/library/item');
  });

  it('is not said on other sections', () => {
    renderAt('/library/spell');
    expect(screen.queryByRole('link', { name: 'Basic equipment' })).toBeNull();
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

  it('is a list named by its heading, each row a link to the entry', () => {
    renderAt('/library/spell');

    const list = screen.getByRole('list', { name: 'Spells' });
    const row = within(list).getByRole('listitem');
    expect(row.getAttribute('aria-posinset')).toBe('1');
    expect(row.getAttribute('aria-setsize')).toBe('1');
    expect(
      within(row)
        .getByRole('link', { name: /Fireball/ })
        .getAttribute('href'),
    ).toBe('/library/spell/fireball%7Cphb');
  });
});

describe('filtering a section (Gemini 44)', () => {
  const spells = [
    { name: 'Fireball', source: 'PHB', level: 3, school: 'V', entries: [] },
    {
      name: 'Detect Magic',
      source: 'PHB',
      level: 1,
      school: 'D',
      meta: { ritual: true },
      duration: [{ type: 'timed', concentration: true }],
      entries: [],
    },
    { name: 'Fire Bolt', source: 'PHB', level: 0, school: 'V', entries: [] },
  ];
  const rowNames = () =>
    within(screen.getByRole('list', { name: 'Spells' }))
      .getAllByRole('link')
      .map((l) => l.firstElementChild?.textContent);

  beforeEach(() => {
    reg.current = {
      ...reg.current,
      registry: registryOfTypes({
        spell: spells,
        class: [
          { name: 'Wizard', source: 'PHB' },
          { name: 'Wizard', source: 'XPHB' },
          { name: 'Mage', source: 'WoW' },
          { name: 'Fighter', source: 'PHB' },
        ],
      }),
    };
  });
  afterEach(() => {
    classLookup.current = {};
    classLookup.failed = false;
  });

  it("puts each row's facts under its name", () => {
    renderAt('/library/spell');
    const row = screen.getByRole('link', { name: /^Detect Magic/ });
    expect(row.textContent).toContain('1st level · Divination · Concentration · Ritual');
  });

  it('narrows by level and by a chip, keeps both in the URL, and clears them', () => {
    renderAt('/library/spell');
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: '1' } });
    expect(rowNames()).toEqual(['Detect Magic']);
    expect(locationNow()).toBe('/library/spell?level=1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ritual' }));
    expect(screen.getByRole('button', { name: 'Ritual' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(rowNames()).toEqual(['Detect Magic']);
    expect(locationNow()).toBe('/library/spell?ritual=1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowNames()).toHaveLength(3);
    expect(locationNow()).toBe('/library/spell');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('opens with the filters a link or Back left in the URL', () => {
    renderAt('/library/spell?school=V&q=fire');
    expect((screen.getByRole('combobox', { name: 'School' }) as HTMLSelectElement).value).toBe('V');
    expect((screen.getByLabelText('Filter spells') as HTMLInputElement).value).toBe('fire');
    expect(rowNames()).toEqual(['Fire Bolt', 'Fireball']);
  });

  it("offers the classes with a list under the settings, each once, and keeps a class's spells", () => {
    policy.current = { mode: 'all', except: ['WoW'] };
    classLookup.current = { phb: { fireball: { class: { PHB: { Wizard: true } } } } };
    renderAt('/library/spell');
    const select = screen.getByRole('combobox', { name: 'Class' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any class', 'Wizard']);
    fireEvent.change(select, { target: { value: 'Wizard' } });
    expect(rowNames()).toEqual(['Fireball']);
    expect(locationNow()).toBe('/library/spell?class=Wizard');
  });

  it('says the class lists could not be read, with a Retry, rather than blaming the filters', () => {
    classLookup.failed = true;
    renderAt('/library/spell?class=Wizard');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('class spell lists');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(classLookup.retry).toHaveBeenCalled();
    // Every class stays offered while the lists are not in hand.
    expect(
      within(screen.getByRole('combobox', { name: 'Class' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any class', 'Fighter', 'Mage', 'Wizard']);
  });

  it('says when the filters leave nothing', () => {
    renderAt('/library/spell?level=9');
    // The pick stays in the dropdown, though no spell here has it.
    expect((screen.getByRole('combobox', { name: 'Level' }) as HTMLSelectElement).value).toBe('9');
    expect(screen.getByText('Nothing here matches these filters.')).toBeTruthy();
  });

  it('keeps the name filter in the URL, and its clear button empties it and refocuses it', () => {
    renderAt('/library/spell');
    const input = screen.getByLabelText('Filter spells') as HTMLInputElement;
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(input, { target: { value: 'bolt' } });
    expect(locationNow()).toBe('/library/spell?q=bolt');
    expect(rowNames()).toEqual(['Fire Bolt']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(locationNow()).toBe('/library/spell');
  });

  it('has no filter bar on a section with no filters of its own', () => {
    renderAt('/library/feat');
    expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();
  });
});

describe('the library search, kept in the URL', () => {
  it('empties when a link opens the library without one', () => {
    render(
      <MemoryRouter initialEntries={['/library?q=fire']}>
        <LocationProbe />
        <Link to="/library">Library tab</Link>
        <Routes>
          <Route path="/library/:type?/:uid?" element={<LibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const box = screen.getByLabelText('Search everything') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'fireb' } });
    // Its own write keeps the text.
    expect(box.value).toBe('fireb');
    expect(locationNow()).toBe('/library?q=fireb');
    fireEvent.click(screen.getByRole('link', { name: 'Library tab' }));
    expect(locationNow()).toBe('/library');
    expect(box.value).toBe('');
  });

  it('opens with the search Back returns to, and asks it again', async () => {
    renderAt('/library?q=fire');
    expect((screen.getByLabelText('Search everything') as HTMLInputElement).value).toBe('fire');
    await waitFor(() => expect(searchAll).toHaveBeenCalled());
    expect(searchAll.mock.calls.at(-1)?.[0]).toBe('fire');
  });
});

describe("a row's estimated height", () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
  });

  // The rendered height of a row (py-3, the name's 1.375rem line, a gap-0.5,
  // the facts line of 1.375rem, a 1 px border), which the list's scroll restore
  // depends on: library-scale.spec.ts checks it against a real row at 16 px
  // and 200%.
  it('follows the root font size, rounded as a measured height is', () => {
    document.documentElement.style.fontSize = '32px';
    expect(entityRowHeight()).toBe(141);
    document.documentElement.style.fontSize = '17.6px';
    expect(entityRowHeight()).toBe(78);
  });

  it('assumes 16 px when the root font size is not in px', () => {
    // As jsdom reports it, "medium".
    expect(entityRowHeight()).toBe(71);
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

  it('opens from a {@book} link in rules text, which names the book by its id alone', () => {
    renderAt('/library/book/phb');

    expect(screen.getByRole('heading', { name: "Player's Handbook" })).toBeTruthy();
    expect(screen.getByText('Step-by-Step Characters')).toBeTruthy();
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

describe('titles and the way back', () => {
  it('goes up to the section from a deep-linked entry, where there is no history', async () => {
    renderAt('/library/spell/fireball%7Cphb');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(locationNow()).toBe('/library/spell'));
  });

  it('goes back where it came from when there is history', async () => {
    renderAtEntries(['/library', '/library/spell/fireball%7Cphb'], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(locationNow()).toBe('/library'));
  });

  it('names each view in the document title', () => {
    renderAt('/library/spell/fireball%7Cphb');
    expect(document.title).toBe('Fireball · Spells · Library · Cast Guidance');
    cleanup();

    renderAt('/library/spell/nonesuch%7Cphb');
    expect(document.title).toBe('Not found · Spells · Library · Cast Guidance');
    cleanup();

    renderAt('/library/spell');
    expect(document.title).toBe('Spells · Library · Cast Guidance');
    cleanup();

    renderAt('/library');
    expect(document.title).toBe('Library · Cast Guidance');
    cleanup();

    renderAt('/library/bogus');
    expect(document.title).toBe('No such section · Library · Cast Guidance');
  });

  it('does not call an entry missing while its section is still downloading', () => {
    packs.current = { ...packs.current, status: 'loading' };
    renderAt('/library/spell/nonesuch%7Cphb');
    expect(document.title).toBe('Spells · Library · Cast Guidance');
  });

  it('labels the icon that leads back out of a section', () => {
    renderAt('/library/spell');
    expect(screen.getByRole('link', { name: 'Back to the library' }).getAttribute('href')).toBe(
      '/library',
    );
  });
});

// A11Y-001: the search and filter fields were named only by their placeholders.
describe('accessible names', () => {
  it('names the library search', () => {
    renderAt('/library');
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Search everything' })).toBeTruthy();
  });

  it('names a section filter after the section', () => {
    renderAt('/library/spell');
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Filter spells' })).toBeTruthy();
  });
});

describe('the library search while a download lands files', () => {
  it('asks its query again when the index behind it is rebuilt', async () => {
    // The index rebuilds behind a ready search box as files arrive. Results
    // left from the query as first asked would miss everything that has
    // landed since, with nothing on screen to say so.
    // A fresh element each time, or React skips re-rendering the same one.
    const tree = () => (
      <MemoryRouter initialEntries={['/library']}>
        <Routes>
          <Route path="/library/:type?/:uid?" element={<LibraryPage />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(tree());
    fireEvent.change(screen.getByRole('textbox', { name: 'Search everything' }), {
      target: { value: 'fire' },
    });
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(1));

    search.current = { ...search.current, indexVersion: 2 };
    view.rerender(tree());
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(2));
    expect(searchAll).toHaveBeenLastCalledWith('fire', expect.anything());
  });
});

// Once another tab deletes or upgrades the database (TEST-002) every read
// here fails with "Database has been closed", and no Retry can fix that. The
// shell's banner explains it; the panels only point at the reload.
describe('the library after another tab closed the database', () => {
  const closedError = 'Database has been closed';

  it('drops the raw error and the dead Retry from a section', () => {
    dbLifecycleStore.getState().markClosed('deleted');
    reg.current = { ...reg.current, registry: null, status: 'error', error: closedError };
    packs.current = { ...packs.current, status: 'error', error: closedError };
    renderAt('/library/spell/nonesuch%7Cphb');

    expect(screen.getByText('Reload this tab to see this section.')).toBeTruthy();
    expect(screen.queryByText(new RegExp(closedError))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('drops them from search too', () => {
    dbLifecycleStore.getState().markClosed('superseded');
    reg.current = { ...reg.current, status: 'error', error: closedError };
    renderAt('/library');

    expect(screen.getByText('Reload this tab to search.')).toBeTruthy();
    expect(screen.queryByText(/Couldn.t prepare search/)).toBeNull();
    expect(screen.queryByText(new RegExp(closedError))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

// A11Y-002: the result count is said once the query settles, and a rebuild of
// the index behind the box (files landing during a download) says nothing.
describe('library search announcements', () => {
  const spoken = () => getAnnouncerState().messages.map((m) => m.text);
  const hit = (name: string) => ({ id: name, type: 'spell', uid: name, name, source: 'PHB' });
  const tree = () => (
    <MemoryRouter initialEntries={['/library']}>
      <Routes>
        <Route path="/library/:type?/:uid?" element={<LibraryPage />} />
      </Routes>
    </MemoryRouter>
  );
  const type = (value: string) =>
    fireEvent.change(screen.getByRole('textbox', { name: 'Search everything' }), {
      target: { value },
    });
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Long enough for the query's own debounce and the announcer's settle. */
  const settled = () => pause(SEARCH_SETTLE_MS + 400);

  beforeEach(resetAnnouncer);
  afterEach(resetAnnouncer);

  it('says the count once, for the query typing ended on', async () => {
    searchAll.mockImplementation((q: string) =>
      Promise.resolve({
        hits: q === 'fire' ? [hit('Fireball'), hit('Fire Bolt')] : [hit('X')],
        hiddenCount: 0,
      }),
    );
    render(tree());
    // Each prefix waits out the query's own debounce and gets its answer,
    // so only the announcer's settle keeps them from being said one by one.
    type('fi');
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(1));
    await pause(250);
    type('fir');
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(2));
    await pause(250);
    type('fire');
    await settled();
    expect(spoken()).toEqual(['2 results']);
  });

  it('says a new query that has the same count as the last', async () => {
    // Both at the search's limit, so both say "30 or more results".
    const page = (prefix: string) => ({
      hits: Array.from({ length: 30 }, (_, i) => hit(`${prefix} ${i}`)),
      hiddenCount: 0,
    });
    searchAll.mockImplementation((q: string) => Promise.resolve(page(q)));
    render(tree());
    type('fire');
    await settled();
    type('cold');
    await settled();
    expect(spoken()).toEqual(['30 or more results', '30 or more results']);
  });

  it('says when nothing matches, and what is hidden', async () => {
    searchAll.mockResolvedValue({ hits: [], hiddenCount: 4 });
    render(tree());
    type('zzz');
    await settled();
    expect(spoken()).toEqual(['No matches. 4 more in sources you have hidden']);
  });

  it('says nothing when the index is rebuilt behind the same query', async () => {
    searchAll.mockResolvedValue({ hits: [hit('Fireball')], hiddenCount: 0 });
    const view = render(tree());
    type('fire');
    await settled();
    expect(spoken()).toEqual(['1 result']);

    // Past the de-duplication window, so only the page keeps it quiet.
    resetAnnouncer();
    search.current = { ...search.current, indexVersion: 2 };
    view.rerender(tree());
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(2));
    await settled();
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('drops a count still waiting when the page goes away', async () => {
    searchAll.mockResolvedValue({ hits: [hit('Fireball')], hiddenCount: 0 });
    const view = render(tree());
    type('fire');
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(1));
    // Answered, and its count waiting out the settle.
    await pause(250);
    view.unmount();
    await settled();
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('drops a count still waiting when the box is cleared', async () => {
    searchAll.mockResolvedValue({ hits: [hit('Fireball')], hiddenCount: 0 });
    render(tree());
    type('fire');
    await waitFor(() => expect(searchAll).toHaveBeenCalledTimes(1));
    // Answered, and its count waiting out the settle.
    await pause(250);
    type('');
    await settled();
    expect(getAnnouncerState().emitted).toBe(0);
  });
});

// A title printed in several books was a row per book, so the 2014 core and
// its 2024 revision doubled most sections. A row is a title now, and its page
// switches between the books.
describe('a title printed in more than one book', () => {
  const fireball2014 = {
    name: 'Fireball',
    source: 'PHB',
    reprintedAs: ['Fireball|XPHB'],
    entries: ['The 2014 text.'],
  };
  const fireball2024 = { name: 'Fireball', source: 'XPHB', entries: ['The 2024 text.'] };
  const toll = { name: 'Toll the Dead', source: 'XGE', entries: [] };

  /** A registry whose lookups honour the source, which switching printings needs. */
  const compendium = (byType: Record<string, Array<Record<string, unknown>>>) => ({
    byType: (type: string) => byType[type] ?? [],
    get: (type: string, name: string, source?: string) =>
      (byType[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      ),
    counts: () => Object.fromEntries(Object.entries(byType).map(([t, list]) => [t, list.length])),
    sourceCounts: () => new Map(),
    changeOf: () => undefined,
  });
  const shownCount = () =>
    screen.getByRole('heading', { name: 'Spells' }).nextElementSibling?.textContent;
  const onlyRow = () => within(screen.getByRole('list', { name: 'Spells' })).getByRole('link');
  const switcher = () => screen.getByRole('group', { name: 'Printed in' });
  const printing = (name: RegExp) => within(switcher()).getByRole('button', { name });

  beforeEach(() => {
    reg.current = {
      ...reg.current,
      registry: compendium({ spell: [fireball2014, fireball2024, toll] }),
    };
  });

  describe('in its section', () => {
    beforeEach(() => {
      reg.current = {
        ...reg.current,
        registry: compendium({ spell: [fireball2014, fireball2024] }),
      };
    });

    it('is one row naming every book, opening the printing the others were reprinted as', () => {
      renderAt('/library/spell');

      expect(shownCount()).toBe('1');
      expect(onlyRow().getAttribute('href')).toBe('/library/spell/fireball%7Cxphb');
      expect(onlyRow().textContent).toContain("Player's Handbook (2014)");
      expect(onlyRow().textContent).toContain("Player's Handbook (2024)");
    });

    it('leaves out a book the settings hide, and opens the printing that is left', () => {
      policy.current = { mode: 'all', except: ['XPHB'] };
      renderAt('/library/spell');

      expect(onlyRow().getAttribute('href')).toBe('/library/spell/fireball%7Cphb');
      expect(onlyRow().textContent).not.toContain('(2024)');
    });

    it('has one printing per row when it is scoped to one book', () => {
      renderAt('/library/spell?source=PHB');

      expect(onlyRow().getAttribute('href')).toBe('/library/spell/fireball%7Cphb');
      expect(onlyRow().textContent).not.toContain('(2024)');
    });

    it('counts the books past what a row has room for', () => {
      const printings = ['PHB', 'XPHB', 'XGE', 'TCE'].map((source) => ({
        name: 'Fireball',
        source,
      }));
      reg.current = { ...reg.current, registry: compendium({ spell: printings }) };
      renderAt('/library/spell');

      expect(onlyRow().textContent).toContain('+2');
      expect(onlyRow().textContent).toContain('and 2 more books');
    });
  });

  it('is counted once on the library home', () => {
    renderAt('/library');
    // Fireball in two books, and Toll the Dead.
    expect(screen.getByRole('link', { name: /Spells/ }).textContent).toBe('Spells2');
  });

  describe('on its page', () => {
    it('switches between its books in place, the URL naming the one on screen', () => {
      renderAt('/library/spell/fireball%7Cphb');

      expect(printing(/^PHB/).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText('The 2014 text.')).toBeTruthy();

      fireEvent.click(printing(/^XPHB, Player's Handbook \(2024\)$/));
      expect(locationNow()).toBe('/library/spell/fireball%7Cxphb');
      expect(screen.getByText('The 2024 text.')).toBeTruthy();
      expect(printing(/^XPHB/).getAttribute('aria-pressed')).toBe('true');
      expect(printing(/^PHB/).getAttribute('aria-pressed')).toBe('false');
    });

    it('is still one Back from the list however many printings were read', async () => {
      renderAtEntries(['/library/spell', '/library/spell/fireball%7Cphb'], 1);
      fireEvent.click(printing(/^XPHB/));
      fireEvent.click(printing(/^PHB/));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => expect(locationNow()).toBe('/library/spell'));
    });

    it('offers no switch for a title in one book', () => {
      renderAt('/library/spell/toll%20the%20dead%7Cxge');
      expect(screen.getByRole('heading', { name: 'Toll the Dead' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Printed in' })).toBeNull();
    });

    it('offers only the books the settings show', () => {
      policy.current = { mode: 'all', except: ['XPHB'] };
      renderAt('/library/spell/fireball%7Cphb');
      expect(screen.queryByRole('group', { name: 'Printed in' })).toBeNull();
    });

    it('still shows where it is when a link opened a book the settings hide', () => {
      policy.current = { mode: 'all', except: ['XPHB'] };
      renderAt('/library/spell/fireball%7Cxphb');
      expect(printing(/^XPHB/).getAttribute('aria-pressed')).toBe('true');
      expect(printing(/^PHB/)).toBeTruthy();
    });

    it("never offers another class's subclass of the same name as a printing", () => {
      reg.current = {
        ...reg.current,
        registry: compendium({
          subclass: [
            { name: 'Guardian', source: 'BrewA', className: 'Fighter', entries: [] },
            { name: 'Guardian', source: 'BrewB', className: 'Ranger', entries: [] },
          ],
        }),
      };
      renderAt('/library/subclass/guardian%7Cbrewa');
      expect(screen.getByRole('heading', { name: 'Guardian' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Printed in' })).toBeNull();
    });
  });

  it("is one of a class's subclasses, not one per book", () => {
    // The 2024 classes carry their 2014 subclasses beside the 2024 printings.
    const champion = {
      name: 'Champion',
      shortName: 'Champion',
      className: 'Fighter',
      classSource: 'XPHB',
      entries: [],
    };
    reg.current = {
      ...reg.current,
      registry: compendium({
        class: [{ name: 'Fighter', source: 'XPHB', entries: [] }],
        subclass: [
          { ...champion, source: 'PHB', reprintedAs: ['Champion|Fighter|XPHB|XPHB'] },
          { ...champion, source: 'XPHB' },
        ],
      }),
    };
    renderAt('/library/class/fighter%7Cxphb');

    const [link, ...more] = screen.getAllByRole('link', { name: /^Champion/ });
    expect(more).toEqual([]);
    expect(link?.getAttribute('href')).toBe('/library/subclass/champion%7Cxphb');
    expect(link?.textContent).toContain("Player's Handbook (2014)");
  });

  describe('in search', () => {
    const hit = (source: string) => ({
      id: `spell:fireball|${source.toLowerCase()}`,
      type: 'spell',
      uid: `fireball|${source.toLowerCase()}`,
      name: 'Fireball',
      source,
    });

    beforeEach(resetAnnouncer);
    afterEach(resetAnnouncer);

    it('is one result naming every book, and is counted once', async () => {
      searchAll.mockResolvedValue({ hits: [hit('PHB'), hit('XPHB')], hiddenCount: 0 });
      renderAt('/library');
      fireEvent.change(screen.getByRole('textbox', { name: 'Search everything' }), {
        target: { value: 'fireball' },
      });

      const result = await screen.findByRole('link', { name: /^Fireball/ });
      expect(screen.getAllByRole('link', { name: /^Fireball/ })).toHaveLength(1);
      expect(result.getAttribute('href')).toBe('/library/spell/fireball%7Cxphb');
      expect(result.textContent).toContain("Player's Handbook (2014)");
      expect(result.textContent).toContain("Player's Handbook (2024)");
      await waitFor(
        () => expect(getAnnouncerState().messages.map((m) => m.text)).toEqual(['1 result']),
        { timeout: SEARCH_SETTLE_MS + 1000 },
      );
    });
  });
});

describe('searchSpeech', () => {
  const page = (n: number) => ({
    hits: Array.from({ length: n }, (_, i) => ({
      id: String(i),
      type: 'spell',
      uid: String(i),
      name: String(i),
      source: 'PHB',
    })),
    hiddenCount: 0,
  });

  it('counts the rows the hits make', () => {
    expect(searchSpeech('fire', page(4), 2)).toBe('2 results');
  });

  it('says "or more" when the search stopped at its limit, however few rows that made', () => {
    expect(searchSpeech('fire', page(30), 18)).toBe('18 or more results');
  });
});
