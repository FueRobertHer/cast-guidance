// @vitest-environment jsdom
// UX-003: each creator step is its own history entry, and creating used to
// replace only the last one. Back from the new sheet then landed in the
// creator with its draft already spent, one tap from a second, empty
// character. The creator also had no way out while game data loaded, and its
// way out elsewhere was an icon with no name.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

const { registry, put, dialogs } = vi.hoisted(() => ({
  /** What `useRegistry` returns; null stands for game data still loading. */
  registry: { current: undefined as unknown, loading: false },
  put: vi.fn(),
  dialogs: {
    askConfirm: vi.fn<(req: { title: string; detail?: string }) => Promise<boolean>>(),
  },
}));

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => (registry.loading ? null : registry.current),
}));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));
vi.mock('@/db/characterRepo', () => ({ characterRepo: { put } }));
vi.mock('@/ui/dialogs', () => ({
  askConfirm: dialogs.askConfirm,
  askNumber: () => Promise.resolve(null),
  askText: () => Promise.resolve(null),
  askChoice: () => Promise.resolve(null),
}));

import { noticeStore } from '@/stores/notices';
import { Component as CreatorPage } from './CreatorPage';
import { wizardState } from './steps';

registry.current = makeTestContext();

const DRAFT_KEY = 'cast-guidance:creator-draft';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  registry.loading = false;
  put.mockReset();
  dialogs.askConfirm.mockReset();
  registry.current = makeTestContext();
  noticeStore.setState({ notice: null, seq: 0 });
  document.title = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Entry = string | { pathname: string; search?: string; state?: unknown };

function renderCreator(entries: Entry[], index = entries.length - 1) {
  // A data router: only its navigate reports when a pop has landed.
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Roster</p> },
      { path: '/create', element: <CreatorPage /> },
      { path: '/c/:id', element: <p>Sheet</p> },
    ],
    { initialEntries: entries, initialIndex: index },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Entered from the roster and walked to Review, the way a player gets there. */
const walkedToReview: Entry[] = [
  '/',
  '/create',
  { pathname: '/create', search: '?step=class', state: wizardState(1) },
  { pathname: '/create', search: '?step=review', state: wizardState(2) },
];

function seedDraft() {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(newCharacterDoc('hero-1', 'Aria', 't')));
}

describe('stepping through the creator', () => {
  it('records how deep into the wizard each step push is', async () => {
    const router = renderCreator(['/', '/create']);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
    expect(router.state.location.state).toEqual(wizardState(1));

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=species'));
    expect(router.state.location.state).toEqual(wizardState(2));
  });

  it('pushes once for a double tap that lands before the first push commits', async () => {
    const router = renderCreator(['/', '/create']);
    const next = screen.getByRole('button', { name: /Next/ });
    act(() => {
      next.click();
      next.click();
    });
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
    await act(() => router.navigate(-1));
    // One entry above the one the wizard was entered on, not two.
    expect(router.state.location.search).toBe('');
  });

  it('lets the steps move again after a Back that beat the push', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const router = renderCreator(['/', '/create']);
    await act(async () => {
      screen.getByRole('button', { name: /Next/ }).click();
      await router.navigate(-1);
    });
    // Back on the entry the push left from, under its old key. A guard that
    // waited for a new entry would hold Next here for good.
    now += 1000;
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
  });

  it('names the step in the document title', () => {
    renderCreator(walkedToReview);
    expect(document.title).toBe('Review · Step 9 of 9 · New character · Cast Guidance');
  });
});

describe('creating a character', () => {
  it('leaves the wizard behind, so Back from the sheet goes to the roster', async () => {
    seedDraft();
    put.mockResolvedValue(undefined);
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    expect(put).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Roster')).toBeTruthy();
  });

  it('creates once and unwinds once, however many times Create is pressed', async () => {
    seedDraft();
    let finish: () => void = () => undefined;
    put.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const router = renderCreator(walkedToReview);

    // Both taps inside one batch, so the second runs before the re-render
    // that takes the button away.
    const create = screen.getByRole('button', { name: /Create character/ });
    act(() => {
      create.click();
      create.click();
    });
    // The wizard is spent the moment Create is pressed: nothing on it can be
    // pressed again, and a save that settles quickly offers no way off it.
    expect(screen.getByRole('status').textContent).toContain('Opening Aria');
    expect(screen.queryByRole('button', { name: /Next|Back|Create/ })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();

    finish();
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    expect(put).toHaveBeenCalledOnce();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
  });

  it('just replaces its own entry when the depth it holds is from before a reload', async () => {
    seedDraft();
    put.mockResolvedValue(undefined);
    // History state outlives a reload; the entries it counted do not.
    const router = renderCreator([
      '/',
      '/create',
      { pathname: '/create', search: '?step=review', state: { creatorDepth: 1, creatorLoad: 'x' } },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/create');
  });

  it('offers a way out of a save that looks stuck, and opens nothing after it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedDraft();
    let finish: () => void = () => undefined;
    put.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('link', { name: /Back to characters/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await act(async () => finish());
    expect(put).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Roster')).toBeTruthy();
  });

  it('keeps the wizard and says so when the save is refused', async () => {
    seedDraft();
    put.mockRejectedValue(new Error('QuotaExceededError'));
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(noticeStore.getState().notice?.title).toBe('Create failed'));
    expect(router.state.location.search).toBe('?step=review');
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
    // And Create can be pressed again.
    expect(screen.getByRole('button', { name: /Create character/ })).toBeTruthy();
  });
});

describe('the way out', () => {
  it('is there, and named, while game data is still loading', () => {
    registry.loading = true;
    renderCreator(['/', '/create']);
    expect(screen.getByText('Loading game data…')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to characters/ }).getAttribute('href')).toBe('/');
  });

  it('is named on every step', () => {
    renderCreator(['/', '/create']);
    expect(screen.getByRole('link', { name: /Back to characters/ }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();
  });
});

// A11Y-001: the point-buy and level steppers were bare "−" and "+" glyphs (the
// level pair sat in a <label> that named the minus "Level" and left the plus
// nameless), and the segmented picks showed their state only by colour.
describe('accessible names and states', () => {
  /** A draft with a class picked and point buy chosen, opened on `step`. */
  function renderStep(step: string) {
    const doc = newCharacterDoc('hero-1', 'Aria', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
    doc.abilities.method = 'pointbuy';
    doc.abilities.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
    renderCreator(['/', { pathname: '/create', search: `?step=${step}`, state: wizardState(1) }]);
  }

  it('names the level steppers apart from the label beside them', () => {
    renderStep('class');
    expect(namelessControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Increase level' }));
    expect(
      screen.getByText('Level', { selector: '[aria-live] *' }).parentElement?.textContent,
    ).toBe('Level 2');
    expect(screen.getByRole('button', { name: 'Decrease level' })).toBeTruthy();
  });

  it('names the point-buy steppers and says which method is in use', () => {
    renderStep('abilities');
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Increase STR' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^\d+ pending decisions?: go to the Choices step$/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Point buy', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manual', pressed: false })).toBeTruthy();
  });

  it('says which rules version is picked', () => {
    renderStep('basics');
    expect(screen.getByRole('button', { name: /^Classic/, pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Revised/, pressed: false })).toBeTruthy();
  });
});

// UX-004: the wizard's destructive changes. Picking another class used to clear
// every choice in the build (species and background picks too) and leave the
// old class's kit equipped; switching rules version wiped the build on one
// tap; and no overwrite could be taken back.
describe('changes that take something away', () => {
  /**
   * Entities layered over the shared test world for one test: classes and a
   * background that come with starting equipment, the background also granting
   * a feat with picks of its own. Extras win over the base world.
   */
  function withExtras() {
    const base = makeTestContext();
    const warrior = base.get('class', 'Warrior', 'TST') as Record<string, unknown>;
    const kit = (a: unknown[], b: unknown[]) => ({ defaultData: [{ a, b }] });
    const extra: Array<[string, Record<string, unknown>]> = [
      [
        'class',
        {
          ...warrior,
          name: 'Blade',
          startingEquipment: kit(['Longsword|TST'], ['Dagger|TST', { value: 500 }]),
        },
      ],
      [
        'class',
        { ...warrior, name: 'Bowman', startingEquipment: kit(['Shortbow|TST'], ['Dagger|TST']) },
      ],
      [
        'background',
        {
          name: 'Kit Sage',
          source: 'TST',
          feats: [{ 'skilled|tst': true }],
          startingEquipment: { defaultData: [{ _: ['Dagger|TST'] }] },
          entries: ['Comes with a feat and a dagger.'],
        },
      ],
    ];
    registry.current = {
      get: (type: string, name: string, source?: string) =>
        extra.find(
          ([t, e]) =>
            t === type &&
            String(e.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
        )?.[1] ?? base.get(type as never, name, source),
      byType: (type: string) => [
        ...extra.filter(([t]) => t === type).map(([, e]) => e),
        ...base.byType(type as never),
      ],
    };
  }

  /** A draft built by `build`, opened on `step` under StrictMode as the app runs. */
  function renderDraft(step: string, build: (doc: CharacterDoc) => void) {
    const doc = newCharacterDoc('hero-1', 'Aria', 't');
    build(doc);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
    const router = createMemoryRouter(
      [
        { path: '/', element: <p>Roster</p> },
        { path: '/create', element: <CreatorPage /> },
      ],
      {
        initialEntries: [
          '/',
          { pathname: '/create', search: `?step=${step}`, state: wizardState(1) },
        ],
        initialIndex: 1,
      },
    );
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    /** Go to another step without the step buttons (which can grant a kit). */
    const goto = (to: string) => act(() => router.navigate(`/create?step=${to}`));
    return { goto };
  }

  /** The draft as the wizard last saved it. */
  const saved = () => JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as CharacterDoc;
  const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
  const pressed = (name: string) =>
    screen.getByRole('button', { name }).getAttribute('aria-pressed');

  describe('picking another class', () => {
    it("keeps species and background picks and swaps out the old class's", () => {
      renderDraft('class', (d) => {
        d.race = { name: 'Testfolk', source: 'TST' };
        d.background = { name: 'Scholar', source: 'TST' };
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            levels: 4,
            hp: ['avg', 'avg', 'avg', 'avg'],
            subclass: { name: 'Path of Tests', source: 'TST' },
          },
        ];
        d.choices = {
          'race:testfolk|tst:language': ['elvish'],
          'background:scholar|tst:skill:0': ['arcana', 'history'],
          'class:warrior|tst:skill:0': ['athletics', 'survival'],
          'class:warrior|tst:asi:4': ['feat'],
          'class:warrior|tst:asi:4:feat': ['skilled|tst'],
          'feat:skilled|tst:asi4:skill': ['stealth'],
          'subclass:path of tests|tst:pick': ['a'],
        };
        d.spellcasting = {
          'warrior|tst': { known: [{ name: 'Guidance', source: 'TST' }], prepared: [] },
        };
      });
      tap('Mage');

      const after = saved();
      expect(after.classes).toEqual([
        { ref: { name: 'Mage', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
      ]);
      expect(after.choices).toEqual({
        'race:testfolk|tst:language': ['elvish'],
        'background:scholar|tst:skill:0': ['arcana', 'history'],
      });
      expect(after.spellcasting).toEqual({});
    });

    it('can be undone, subclass, picks and spells included, even after moving steps', async () => {
      const { goto } = renderDraft('class', (d) => {
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            levels: 3,
            hp: ['avg', 'avg', 'avg'],
            subclass: { name: 'Path of Tests', source: 'TST' },
          },
        ];
        d.choices = {
          'class:warrior|tst:skill:0': ['athletics', 'survival'],
          'subclass:path of tests|tst:pick': ['a'],
        };
        d.spellcasting = {
          'warrior|tst': { known: [{ name: 'Guidance', source: 'TST' }], prepared: [] },
        };
      });
      const before = saved();
      tap('Mage');
      expect(screen.getByRole('status').textContent).toContain(
        '2 Warrior picks, subclass Path of Tests and its spell list (1 known) cleared',
      );
      await goto('abilities');
      tap('Undo: Class: Warrior → Mage');

      const after = saved();
      expect(after.classes).toEqual(before.classes);
      expect(after.choices).toEqual(before.choices);
      expect(after.spellcasting).toEqual(before.spellcasting);
      expect(screen.getByRole('status').textContent).toContain('Undone: Class: Warrior → Mage');
    });

    it('takes back the granted kit, and undo brings back the kit and the rows picked', async () => {
      withExtras();
      const { goto } = renderDraft('equipment', (d) => {
        d.classes = [{ ref: { name: 'Blade', source: 'TST' }, levels: 1, hp: ['avg'] }];
      });
      tap('(B) Dagger, 5 gp');
      expect(saved().equipment.map((i) => i.ref?.name)).toEqual(['dagger']);
      expect(saved().play.currency.gp).toBe(5);

      await goto('class');
      tap('Bowman');
      expect(saved().equipment).toEqual([]);
      expect(saved().play.currency.gp).toBe(0);
      expect(screen.getByRole('status').textContent).toContain('starting equipment cleared');
      // Bowman's kit starts from its own first row, not the row Blade had picked.
      await goto('equipment');
      expect(pressed('(A) Shortbow')).toBe('true');
      expect(pressed('(B) Dagger')).toBe('false');

      tap('Undo: Class: Blade → Bowman');
      expect(saved().classes[0]?.ref.name).toBe('Blade');
      expect(saved().equipment.map((i) => i.ref?.name)).toEqual(['dagger']);
      expect(saved().play.currency.gp).toBe(5);
      expect(pressed('(B) Dagger, 5 gp')).toBe('true');
    });
  });

  it("drops a background's feat picks and kit when it changes, and undo puts them back", async () => {
    withExtras();
    const { goto } = renderDraft('equipment', (d) => {
      d.classes = [{ ref: { name: 'Blade', source: 'TST' }, levels: 1, hp: ['avg'] }];
      d.background = { name: 'Kit Sage', source: 'TST' };
      d.choices = { 'feat:skilled|tst:kit sage|tst:skill:0': ['stealth', 'arcana', 'history'] };
    });
    tap('(B) Dagger, 5 gp');
    expect(saved().equipment).toHaveLength(2);

    await goto('background');
    tap('Scholar');
    expect(saved().choices).toEqual({});
    expect(saved().equipment).toEqual([]);
    // The class's row stays picked for the regrant.
    await goto('equipment');
    expect(pressed('(B) Dagger, 5 gp')).toBe('true');

    tap('Undo: Background: Kit Sage → Scholar');
    expect(saved().background?.name).toBe('Kit Sage');
    expect(saved().choices).toEqual({
      'feat:skilled|tst:kit sage|tst:skill:0': ['stealth', 'arcana', 'history'],
    });
    expect(saved().equipment).toHaveLength(2);
  });

  it('offers to undo a species change', () => {
    renderDraft('species', (d) => {
      d.race = { name: 'Testfolk', source: 'TST' };
      d.choices = { 'race:testfolk|tst:language': ['elvish'] };
    });
    tap('Prosefolk');
    expect(saved().race?.name).toBe('Prosefolk');
    expect(saved().choices).toEqual({});

    tap('Undo: Species: Testfolk → Prosefolk');
    expect(saved().race?.name).toBe('Testfolk');
    expect(saved().choices).toEqual({ 'race:testfolk|tst:language': ['elvish'] });
  });

  it("drops the old subclass's picks when it is cleared, and undo puts them back", () => {
    renderDraft('class', (d) => {
      d.classes = [
        {
          ref: { name: 'Warrior', source: 'TST' },
          levels: 3,
          hp: ['avg', 'avg', 'avg'],
          subclass: { name: 'Path of Tests', source: 'TST' },
        },
      ];
      d.choices = { 'subclass:path of tests|tst:pick': ['a'] };
    });
    tap('Path of Tests');
    expect(saved().classes[0]?.subclass).toBeUndefined();
    expect(saved().choices).toEqual({});

    tap('Undo: Subclass: Path of Tests → none');
    expect(saved().classes[0]?.subclass?.name).toBe('Path of Tests');
    expect(saved().choices).toEqual({ 'subclass:path of tests|tst:pick': ['a'] });
  });

  it('offers to undo a level taken off', () => {
    renderDraft('class', (d) => {
      d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 7] }];
    });
    tap('Decrease level');
    expect(saved().classes[0]?.levels).toBe(2);
    expect(screen.getByRole('status').textContent).toContain('rolled 7 HP for that level cleared');

    tap('Undo: Warrior level 3 → 2');
    expect(saved().classes[0]).toMatchObject({ levels: 3, hp: ['avg', 'avg', 7] });
  });

  describe('ability overwrites', () => {
    const monk = (d: CharacterDoc) => {
      d.classes = [{ ref: { name: 'Monk', source: 'TST' }, levels: 1, hp: ['avg'] }];
    };
    const scores = () => Object.values(saved().abilities.base).join('/');

    it('offers to undo the auto-assigned standard array', () => {
      renderDraft('abilities', monk);
      tap(/^Auto-assign the standard array/);
      expect(scores()).not.toBe('10/10/10/10/10/10');
      tap('Undo: Applied the standard array for a Monk');
      expect(scores()).toBe('10/10/10/10/10/10');
    });

    it('offers to undo point buy resetting the scores, method included', () => {
      renderDraft('abilities', (d) => {
        monk(d);
        d.abilities.method = 'manual';
        d.abilities.base = { str: 12, dex: 16, con: 14, int: 10, wis: 15, cha: 8 };
      });
      tap('Point buy');
      expect(scores()).toBe('8/8/8/8/8/8');
      tap('Undo: Point buy: every score back to 8');
      expect(saved().abilities.method).toBe('manual');
      expect(scores()).toBe('12/16/14/10/15/8');
    });

    it('offers to undo a focus preset, and nothing when the scores did not move', () => {
      renderDraft('abilities', (d) => {
        monk(d);
        d.abilities.method = 'pointbuy';
        d.abilities.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      });
      tap(/^Focus a Monk/);
      expect(scores()).not.toBe('8/8/8/8/8/8');
      tap('Undo: Focused a Monk');
      expect(scores()).toBe('8/8/8/8/8/8');
      // A method switch that leaves every score where it was has nothing to undo.
      tap('Manual');
      expect(saved().abilities.method).toBe('manual');
      expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
    });
  });

  describe('switching rules version', () => {
    /** A draft with a kitted class, a background with picks, a spell and a kit row. */
    async function builtDraft() {
      withExtras();
      const view = renderDraft('equipment', (d) => {
        d.classes = [{ ref: { name: 'Blade', source: 'TST' }, levels: 1, hp: ['avg'] }];
        d.background = { name: 'Scholar', source: 'TST' };
        d.choices = { 'background:scholar|tst:skill:0': ['arcana', 'history'] };
        d.spellcasting = {
          'mage|tst': { known: [{ name: 'Guidance', source: 'TST' }], prepared: [] },
        };
      });
      tap('(B) Dagger, 5 gp');
      await view.goto('basics');
      return view;
    }

    it('asks first, naming only what goes, and Cancel keeps it all', async () => {
      await builtDraft();
      const before = saved();
      dialogs.askConfirm.mockResolvedValue(false);
      tap(/^Revised/);
      await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalledOnce());
      expect(dialogs.askConfirm.mock.calls[0]?.[0].detail).toBe(
        'Clears your class Blade, background Scholar, 2 picks, 1 spell and starting equipment, since they come from the other rules. Your name and ability scores stay.',
      );
      expect(saved()).toEqual(before);
    });

    it('clears spells, the kit and its rows too once confirmed', async () => {
      await builtDraft();
      dialogs.askConfirm.mockResolvedValue(true);
      tap(/^Revised/);
      await waitFor(() => expect(saved().rulesVersion).toBe('2024'));
      const after = saved();
      expect(after.classes).toEqual([]);
      expect(after.background).toBeUndefined();
      expect(after.choices).toEqual({});
      expect(after.spellcasting).toEqual({});
      expect(after.equipment).toEqual([]);
      expect(after.play.currency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
      // The kit rows went too, so nothing is left to clear and switching back
      // does not ask.
      tap(/^Classic/);
      await waitFor(() => expect(saved().rulesVersion).toBe('2014'));
      expect(dialogs.askConfirm).toHaveBeenCalledOnce();
    });

    it('switches an empty draft without asking', () => {
      renderDraft('basics', () => undefined);
      tap(/^Revised/);
      expect(dialogs.askConfirm).not.toHaveBeenCalled();
      expect(saved().rulesVersion).toBe('2024');
    });
  });
});
