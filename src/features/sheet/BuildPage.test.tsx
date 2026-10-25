// @vitest-environment jsdom
// GAME-003: switching rules version re-reads every pick under the other edition,
// so it previews what that does to this character and waits for a yes. It used
// to apply on one tap, under a legend promising warnings that did not exist.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { Component as BuildPage } from './BuildPage';
import type { CharacterSheetState } from './useCharacterSheet';

/**
 * Entities layered over the shared test world for one test, so a case can hold
 * picks that classify differently without changing a fixture every other suite
 * counts on. Extras win over the base world, so one can also restate a base
 * entity with an extra field.
 */
const extra = vi.hoisted(() => ({ current: [] as Array<[string, Record<string, unknown>]> }));

/** What `useTypePacks('class')` reports: downloaded unless a test says otherwise. */
const classPacks = vi.hoisted(() => ({
  current: { status: 'ready', error: null, offline: false } as {
    status: 'loading' | 'ready' | 'error';
    error: string | null;
    offline: boolean;
  },
  retry: vi.fn(),
}));

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ ...classPacks.current, retry: classPacks.retry, repair: () => undefined }),
  useRegistry: () => {
    const base = makeTestContext();
    return {
      get: (type: string, name: string, source?: string) =>
        extra.current.find(
          ([t, e]) =>
            t === type &&
            String(e.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
        )?.[1] ?? base.get(type as never, name, source),
      byType: (type: string) => [
        ...extra.current.filter(([t]) => t === type).map(([, e]) => e),
        ...base.byType(type as never),
      ],
    };
  },
}));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));

const dialogs = vi.hoisted(() => ({
  askConfirm: vi.fn<(req: { title: string; detail?: string }) => Promise<boolean>>(),
}));
vi.mock('@/ui/dialogs', () => ({
  askConfirm: dialogs.askConfirm,
  askNumber: () => Promise.resolve(null),
  askText: () => Promise.resolve(null),
  askChoice: () => Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  dialogs.askConfirm.mockReset();
  extra.current = [];
  classPacks.current = { status: 'ready', error: null, offline: false };
  classPacks.retry.mockReset();
});

/**
 * A 2014 species that the test world also has a 2024 printing of, so a
 * character can hold one pick that classifies differently from the rest. XTST
 * is not a core 2024 source, so the printing says so with an edition tag.
 */
function withReprintedSpecies() {
  const base = makeTestContext();
  const species = base.get('race', 'Testfolk', 'TST') as Record<string, unknown>;
  extra.current = [
    ['race', { ...species, reprintedAs: ['Testfolk|XTST'] }],
    ['race', { name: 'Testfolk', source: 'XTST', edition: 'one' }],
  ];
}

/** The detail text of the last confirm the page raised. */
const lastPrompt = () => dialogs.askConfirm.mock.calls.at(-1)?.[0];

function renderBuild(build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('b1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.background = { name: 'Scholar', source: 'TST' };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  build?.(doc);

  // A tiny stand-in for the session store. The page stays mounted across
  // edits, as it does in the app, so page state such as an undo offer lives on.
  let current = doc;
  const listeners = new Set<() => void>();
  const set = (next: CharacterDoc) => {
    current = next;
    for (const l of listeners) l();
  };
  const update = vi.fn((recipe: (d: CharacterDoc) => void, _label?: unknown) => {
    const d = structuredClone(current);
    recipe(d);
    set(d);
  });
  const restore = vi.fn((snapshot: CharacterDoc, _label?: string) =>
    set(structuredClone(snapshot)),
  );
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  function Shell() {
    const live = useSyncExternalStore(subscribe, () => current);
    const sheet = useMemo(() => deriveSheet(live, makeTestContext()), [live]);
    // The app's HP sync (useCharacterSheet): while a character is still being
    // built, current HP follows the derived maximum with a write of its own.
    useEffect(() => {
      if (live.play.hpInitialized === false && live.play.currentHp !== sheet.maxHp.value) {
        update((d) => {
          d.play.currentHp = sheet.maxHp.value;
        });
      }
    }, [live, sheet]);
    const ctx = {
      doc: live,
      sheet,
      update,
      restore,
      loadStatus: 'ready',
      missing: false,
      error: null,
      saveStatus: 'saved',
      retryLoad: () => undefined,
    } as unknown as CharacterSheetState;
    return <Outlet context={ctx} />;
  }
  const router = createMemoryRouter([
    { path: '/', element: <Shell />, children: [{ index: true, element: <BuildPage /> }] },
  ]);
  render(<RouterProvider router={router} />);
  /** An edit made from elsewhere (another control, the HP sync). */
  const edit = (recipe: (d: CharacterDoc) => void) => act(() => update(recipe));
  return { getDoc: () => current, update, restore, edit };
}

describe('BuildPage rules-version switch (GAME-003)', () => {
  it('previews the switch and applies nothing until it is confirmed', async () => {
    const { getDoc } = renderBuild();
    expect(getDoc().rulesVersion).toBe('2014');

    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));

    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalledTimes(1));
    expect(lastPrompt()?.title).toBe('Switch to 2024 rules?');
    // Declining must leave the character exactly as it was.
    expect(getDoc().rulesVersion).toBe('2014');
  });

  it('applies the switch once confirmed', async () => {
    const { getDoc } = renderBuild();
    dialogs.askConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(getDoc().rulesVersion).toBe('2024'));
  });

  it('tells the player what the switch does to the picks they hold', async () => {
    // Every fixture pick is 2014 content with no reprint, so the preview should
    // both reassure and name them rather than just asking to confirm.
    const { getDoc } = renderBuild();
    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalled());

    const detail = lastPrompt()?.detail ?? '';
    expect(detail).toContain('Nothing is removed');
    expect(detail).toContain('every selection is kept');
    expect(detail).toContain('carry over with no 2024 reprint');
    expect(detail).toContain('Warrior');
    expect(getDoc().rulesVersion).toBe('2014');
  });

  it('does not prompt when the version tapped is the one already set', () => {
    const { getDoc } = renderBuild();
    fireEvent.click(screen.getByRole('button', { name: '2014' }));
    expect(dialogs.askConfirm).not.toHaveBeenCalled();
    expect(getDoc().rulesVersion).toBe('2014');
  });

  it('switches without a prompt when there is nothing to warn about', async () => {
    // Nothing selected means the switch only changes what the pickers offer, so
    // a modal would ask the player to confirm a change with no consequence.
    const { getDoc } = renderBuild((d) => {
      d.race = undefined;
      d.background = undefined;
      d.classes = [];
    });
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(getDoc().rulesVersion).toBe('2024'));
    expect(dialogs.askConfirm).not.toHaveBeenCalled();
  });

  it('names the reprint a switch would offer, not just the carry-overs', async () => {
    withReprintedSpecies();
    renderBuild();
    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalled());

    const detail = lastPrompt()?.detail ?? '';
    expect(detail).toContain('has a 2024 reprint you can switch to afterwards');
    expect(detail).toContain('Testfolk → Testfolk');
    expect(detail).toContain('carry over with no 2024 reprint');
  });
});

describe('BuildPage edition cues (GAME-003)', () => {
  it('says nothing while every pick suits the version', () => {
    renderBuild();
    expect(screen.queryByText(/^Mixed editions/)).toBeNull();
  });

  it('lists a cue per off-edition pick once the character is on 2024', () => {
    const { getDoc } = renderBuild((d) => {
      d.rulesVersion = '2024';
    });
    expect(getDoc().rulesVersion).toBe('2024');
    // Three 2014 picks (species, background, class) in a 2024 game.
    expect(screen.getByText('Mixed editions (3)')).toBeTruthy();
    expect(
      screen.getByText('Warrior: 2014 content with no 2024 reprint. Kept as chosen.'),
    ).toBeTruthy();
    // And the pick itself carries the compact chip, where you would change it.
    expect(screen.getAllByText('2014 content').length).toBeGreaterThan(0);
  });

  it('gives each pick the chip its own classification earns', () => {
    // The species has an installed 2024 printing; the background and class do
    // not. A chip that ignored its cue, or that read the first cue for every
    // slot, would put the same text on all three.
    withReprintedSpecies();
    renderBuild((d) => {
      d.rulesVersion = '2024';
    });
    expect(screen.getAllByText('reprinted for 2024')).toHaveLength(1);
    expect(screen.getAllByText('2014 content')).toHaveLength(2);
    expect(
      screen.getByText('Testfolk: 2014 content, reprinted for 2024 as Testfolk. Kept as chosen.'),
    ).toBeTruthy();
  });
});

describe('BuildPage subclass picker (GAME-009)', () => {
  /**
   * A legacy subclass and the 2024 printing that replaces it, named in the
   * four-segment form 5etools gives subclass reprints. Fresh names, because
   * the mock layers extras over the base world rather than replacing rows.
   */
  function withReprintedSubclass() {
    extra.current = [
      [
        'subclass',
        {
          name: 'Path of Old',
          shortName: 'Old',
          source: 'TST',
          className: 'Warrior',
          classSource: 'TST',
          reprintedAs: ['Old|Warrior|TST|XTST'],
        },
      ],
      [
        'subclass',
        {
          name: 'Path of Old',
          shortName: 'Old',
          source: 'XTST',
          edition: 'one',
          className: 'Warrior',
          classSource: 'TST',
        },
      ],
    ];
  }

  it('offers one printing per subclass to a 2024 character', () => {
    withReprintedSubclass();
    const { getDoc } = renderBuild((d) => {
      d.rulesVersion = '2024';
    });
    const cards = screen.getAllByRole('button', { name: 'Path of Old' });
    expect(cards).toHaveLength(1);
    fireEvent.click(cards[0] as HTMLElement);
    expect(getDoc().classes[0]?.subclass).toEqual({ name: 'Path of Old', source: 'XTST' });
  });

  it('keeps the legacy printing a character holds, and says what replaced it', () => {
    withReprintedSubclass();
    renderBuild((d) => {
      d.rulesVersion = '2024';
      const c = d.classes[0];
      if (c !== undefined) c.subclass = { name: 'Path of Old', source: 'TST' };
    });
    // Both printings stay: the held one so the picker can show what is chosen,
    // the reprint so the player can move to it.
    expect(screen.getAllByRole('button', { name: 'Path of Old', hidden: true })).toHaveLength(2);
    expect(screen.getByText('Mixed editions (4)')).toBeTruthy();
    expect(
      screen.getByText(
        "Warrior's Path of Old: 2014 content, reprinted for 2024 as Path of Old. Kept as chosen.",
      ),
    ).toBeTruthy();
  });

  it('still lists every 2014 printing for a 2014 character', () => {
    withReprintedSubclass();
    const { getDoc } = renderBuild();
    const cards = screen.getAllByRole('button', { name: 'Path of Old' });
    expect(cards).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Path of Tests' })).toBeTruthy();
    fireEvent.click(cards[0] as HTMLElement);
    expect(getDoc().classes[0]?.subclass).toEqual({ name: 'Path of Old', source: 'TST' });
  });
});

// A11Y-001: the banner's dismiss, a class's level "−" and the HP roll were
// glyphs or icons named only by tooltips, and the HP inputs only by "?".
describe('BuildPage accessible names', () => {
  it('names every control, with rolled HP and the stat-change banner showing', () => {
    renderBuild((d) => {
      d.hpMethod = 'rolled';
    });
    // Two steps, so the modifier moves and the banner (and its dismiss) shows.
    fireEvent.click(screen.getByRole('button', { name: 'Increase STR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase STR' }));
    expect(screen.getByRole('button', { name: 'Dismiss stat changes' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Remove a Warrior level' })).toBeTruthy();
  });

  it('reports the rules version and HP method that are set as pressed', () => {
    renderBuild();
    expect(screen.getByRole('button', { name: '2014', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2024', pressed: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rolled', pressed: false }));
    expect(screen.getByRole('button', { name: 'Rolled', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Average', pressed: false })).toBeTruthy();
  });

  it('says the score on an ability swap button, and which one is picked up', () => {
    renderBuild();
    fireEvent.click(screen.getByRole('button', { name: /^STR 14: swap/, pressed: false }));
    expect(screen.getByRole('button', { name: /^STR 14: swap/, pressed: true })).toBeTruthy();
  });
});

// GAME-005: the character's own book list narrows the Build page pickers in
// place of this device's settings, and is edited right under Identity.
describe("BuildPage under a character's own sources", () => {
  it("narrows the background picker to the character's books", () => {
    renderBuild((d) => {
      d.allowedSources = ['TST'];
    });
    expect(screen.queryByRole('button', { name: 'Scholar' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Modern Scholar' })).toBeNull();
    expect(screen.getByText(/2 outside this character's sources/)).toBeTruthy();
  });

  // One entity per picker from a book the character's list leaves out. Every
  // other entity in the test world comes from a listed book.
  const outside: Array<[string, string, Record<string, unknown>]> = [
    ['class', 'Outrider', { name: 'Outrider', source: 'OUT' }],
    [
      'subclass',
      'Path of Elsewhere',
      {
        name: 'Path of Elsewhere',
        shortName: 'Elsewhere',
        source: 'OUT',
        className: 'Warrior',
        classSource: 'TST',
      },
    ],
    ['race', 'Outfolk', { name: 'Outfolk', source: 'OUT' }],
    ['subrace', 'Far Testfolk', { name: 'Far Testfolk', source: 'OUT', raceName: 'Testfolk' }],
    ['background', 'Outlander', { name: 'Outlander', source: 'OUT' }],
  ];

  it.each(outside)('passes the list to the %s picker', (type, name, entity) => {
    extra.current = [
      [type, entity],
      // A listed subrace, so the subrace picker has something to show.
      ['subrace', { name: 'Near Testfolk', source: 'TST', raceName: 'Testfolk' }],
    ];
    renderBuild((d) => {
      d.allowedSources = ['TST', 'TS2', 'XTST', 'PHB'];
    });
    expect(screen.queryByRole('button', { name, hidden: true })).toBeNull();
    cleanup();

    // The same page with no list offers it, so the list is what hid it.
    renderBuild();
    expect(screen.queryByRole('button', { name, hidden: true })).not.toBeNull();
  });

  it('edits the list from a Sources section, through the doc updater', () => {
    const { getDoc } = renderBuild();
    expect(screen.getByText('No restriction', { selector: 'summary *' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2024 core only' }));
    expect(getDoc().allowedSources).toEqual(['XDMG', 'XMM', 'XPHB']);
  });
});

// UX-004: changes that take picks away say what went and offer to put it back,
// and removing a class asks first whichever class it is.
describe('BuildPage destructive changes (UX-004)', () => {
  const undoButton = () => screen.queryByRole('button', { name: /^Undo: / });
  const clickUndo = () => {
    const button = undoButton();
    if (button === null) throw new Error('no undo offered');
    fireEvent.click(button);
  };

  /**
   * A level-1 Warrior (with a subclass, a dormant ASI feat and spells), then
   * Mage. Warrior comes first so its skill prompt is one the sheet shows.
   */
  const twoClasses = (d: CharacterDoc) => {
    d.classes = [
      {
        ref: { name: 'Warrior', source: 'TST' },
        levels: 1,
        hp: ['avg'],
        subclass: { name: 'Path of Tests', source: 'TST' },
      },
      { ref: { name: 'Mage', source: 'TST' }, levels: 1, hp: ['avg'] },
    ];
    d.choices = {
      'class:mage|tst:skill:0': ['arcana'],
      'class:warrior|tst:skill:0': ['athletics', 'survival'],
      'class:warrior|tst:asi:4:feat': ['skilled|tst'],
      'feat:skilled|tst:asi4:skill': ['stealth'],
      'subclass:path of tests|tst:spell': ['shield|tst'],
    };
    d.spellcasting = {
      'mage|tst': { known: [], prepared: [{ name: 'Guidance', source: 'TST' }] },
      'warrior|tst': { known: [{ name: 'Guidance', source: 'TST' }], prepared: [] },
    };
  };

  it('asks before removing a level-1 class that is not the only one, and says what goes', async () => {
    const { getDoc } = renderBuild(twoClasses);
    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Warrior' }));
    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalledTimes(1));
    expect(lastPrompt()?.title).toBe('Remove Warrior?');
    expect(lastPrompt()?.detail).toBe(
      // Two skills under one prompt are two picks; the dormant level-4 feat
      // pick is not one the player can see, so it is not counted.
      'Clears 2 Warrior picks, subclass Path of Tests and its spell list (1 known). You can undo this right after.',
    );
    // Declined: nothing moved.
    expect(getDoc().classes).toHaveLength(2);
    expect(undoButton()).toBeNull();
  });

  it('removes the class with its subclass picks, ASI feat picks and spells, and undoes it', async () => {
    const { getDoc, restore } = renderBuild(twoClasses);
    const original = structuredClone(getDoc());
    dialogs.askConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Warrior' }));
    await waitFor(() => expect(getDoc().classes).toHaveLength(1));
    expect(getDoc().classes[0]?.ref.name).toBe('Mage');
    expect(getDoc().choices).toEqual({ 'class:mage|tst:skill:0': ['arcana'] });
    expect(Object.keys(getDoc().spellcasting)).toEqual(['mage|tst']);

    await waitFor(() => expect(undoButton()).not.toBeNull());
    expect(screen.getByText('Removed Warrior')).toBeTruthy();
    clickUndo();
    expect(restore).toHaveBeenCalledWith(expect.anything(), 'Undo: Removed Warrior');
    expect(getDoc()).toEqual(original);
  });

  it('keeps the offer through the HP sync that follows a level down, and undo restores HP', () => {
    const { getDoc } = renderBuild((d) => {
      d.play.hpInitialized = false;
    });
    const fullHp = getDoc().play.currentHp;
    fireEvent.click(screen.getByRole('button', { name: 'Remove a Warrior level' }));
    // The sync wrote a lower current HP of its own; that is not the player's edit.
    expect(getDoc().play.currentHp).toBeLessThan(fullHp);
    clickUndo();
    expect(getDoc().classes[0]?.levels).toBe(3);
    expect(getDoc().play.currentHp).toBe(fullHp);
  });

  it('offers to put back a level taken off, with the HP rolled for it', () => {
    const { getDoc } = renderBuild((d) => {
      d.hpMethod = 'rolled';
      const c = d.classes[0];
      if (c !== undefined) c.hp = ['avg', 7, 4];
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a Warrior level' }));
    expect(getDoc().classes[0]?.levels).toBe(2);
    expect(getDoc().classes[0]?.hp).toEqual(['avg', 7]);
    expect(screen.getByText(/rolled 4 HP for that level cleared/)).toBeTruthy();
    clickUndo();
    expect(getDoc().classes[0]?.levels).toBe(3);
    expect(getDoc().classes[0]?.hp).toEqual(['avg', 7, 4]);
  });

  it('clears the old species picks on a change, and undo brings species and picks back', () => {
    const { getDoc } = renderBuild((d) => {
      d.choices = {
        'race:testfolk|tst:lang:0': ['elvish'],
        'class:warrior|tst:skill': ['athletics'],
      };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dragonborn', hidden: true }));
    expect(getDoc().race).toEqual({ name: 'Dragonborn', source: 'TST' });
    expect(getDoc().choices).toEqual({ 'class:warrior|tst:skill': ['athletics'] });
    expect(screen.getByText(/1 Testfolk pick cleared/)).toBeTruthy();

    clickUndo();
    expect(getDoc().race).toEqual({ name: 'Testfolk', source: 'TST' });
    expect(getDoc().choices['race:testfolk|tst:lang:0']).toEqual(['elvish']);
    // Focus stays in the bar, which now says what was undone.
    expect(document.activeElement?.textContent).toBe('Undone: Species: Testfolk → Dragonborn');
  });

  it('clears the subrace picks when the subrace is unselected, and undoes it', () => {
    const { getDoc } = renderBuild((d) => {
      d.race = { name: 'Dragonborn', source: 'TST' };
      d.subrace = { name: 'Dragonborn (Blue)', source: 'TST' };
      d.choices = { 'subrace:dragonborn (blue)|tst:skill': ['arcana'] };
    });
    const card = screen
      .getAllByRole('button', { name: 'Dragonborn (Blue)', hidden: true })
      .find((b) => b.getAttribute('aria-pressed') === 'true');
    if (card === undefined) throw new Error('no selected subrace card');
    fireEvent.click(card);
    expect(getDoc().subrace).toBeUndefined();
    expect(getDoc().choices).toEqual({});
    expect(screen.getByText('Subrace: Dragonborn (Blue) → none')).toBeTruthy();
    clickUndo();
    expect(getDoc().subrace).toEqual({ name: 'Dragonborn (Blue)', source: 'TST' });
    expect(getDoc().choices).toEqual({ 'subrace:dragonborn (blue)|tst:skill': ['arcana'] });
  });

  it('clears the sub-choices of a feat the old background granted', () => {
    const { getDoc } = renderBuild((d) => {
      d.choices = {
        'background:scholar|tst:skill': ['arcana', 'history'],
        'feat:skilled|tst:scholar|tst:skill': ['stealth'],
      };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Linguist', hidden: true }));
    expect(getDoc().background).toEqual({ name: 'Linguist', source: 'TST' });
    expect(getDoc().choices).toEqual({});
    clickUndo();
    expect(Object.keys(getDoc().choices).sort()).toEqual([
      'background:scholar|tst:skill',
      'feat:skilled|tst:scholar|tst:skill',
    ]);
  });

  it('clears the old subclass picks on a change, and undoes it', () => {
    const { getDoc } = renderBuild((d) => {
      const c = d.classes[0];
      if (c !== undefined) c.subclass = { name: 'Path of Tests', source: 'TST' };
      d.choices = { 'subclass:path of tests|tst:spell': ['shield|tst'] };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spell Knight', hidden: true }));
    expect(getDoc().classes[0]?.subclass).toEqual({ name: 'Spell Knight', source: 'TST' });
    expect(getDoc().choices).toEqual({});
    clickUndo();
    expect(getDoc().classes[0]?.subclass).toEqual({ name: 'Path of Tests', source: 'TST' });
    expect(getDoc().choices).toEqual({ 'subclass:path of tests|tst:spell': ['shield|tst'] });
  });

  it('undoes the standard array', () => {
    const { getDoc } = renderBuild();
    fireEvent.click(screen.getByRole('button', { name: 'Standard array' }));
    expect(getDoc().abilities.base.str).toBe(15);
    expect(screen.getByText(/was 14\/12\/14\/10\/10\/10/)).toBeTruthy();
    clickUndo();
    expect(getDoc().abilities.base).toEqual({
      str: 14,
      dex: 12,
      con: 14,
      int: 10,
      wis: 10,
      cha: 10,
    });
  });

  it('undoes a 4d6 roll', () => {
    // Every die comes up 6, so every score rolls 18.
    const rng = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
      if (buf instanceof Uint32Array) buf[0] = 5;
      return buf;
    });
    try {
      const { getDoc } = renderBuild();
      fireEvent.click(screen.getByRole('button', { name: 'Roll 4d6' }));
      expect(getDoc().abilities.base.int).toBe(18);
      expect(screen.getByText('Rolled ability scores: 18/18/18/18/18/18')).toBeTruthy();
      clickUndo();
      expect(getDoc().abilities.base.int).toBe(10);
    } finally {
      rng.mockRestore();
    }
  });

  it('offers nothing when the standard array is already what the scores are', () => {
    renderBuild((d) => {
      d.abilities.base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Standard array' }));
    expect(undoButton()).toBeNull();
  });

  it('withdraws the offer at the next edit', () => {
    const { edit } = renderBuild();
    fireEvent.click(screen.getByRole('button', { name: 'Dragonborn', hidden: true }));
    expect(undoButton()).not.toBeNull();
    edit((d) => {
      d.name = 'Renamed';
    });
    expect(undoButton()).toBeNull();
  });
});

// PWA-001: the class download was started with a bare `void`. Without the class
// files (offline, or a failed download) the picker showed "Pick a class" over
// an empty list, and the rejection surfaced only as an uncaught error.
/** The alert beside the class picker (the page has other live regions). */
function classListAlert(): HTMLElement {
  const found = screen
    .getAllByRole('alert')
    .find((el) => el.textContent?.includes('class list') === true);
  if (found === undefined) throw new Error('no class list alert');
  return found;
}

describe('BuildPage class list without its download', () => {
  it('says the device is offline beside the class picker, with Retry', () => {
    classPacks.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderBuild();
    const alert = classListAlert();
    expect(alert.textContent).toContain(
      "You're offline, so the class list can't be downloaded yet.",
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(classPacks.retry).toHaveBeenCalledOnce();
  });

  it('tries the class download again by itself once back online', () => {
    classPacks.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderBuild();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(classPacks.retry).toHaveBeenCalledOnce();
  });

  it('names a failed download online', () => {
    classPacks.current = { status: 'error', error: 'HTTP 503', offline: false };
    renderBuild();
    expect(classListAlert().textContent).toContain(
      "The class list couldn't be downloaded: HTTP 503",
    );
  });

  it('says nothing while the class files are fine', () => {
    renderBuild();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(classPacks.retry).not.toHaveBeenCalled();
    expect(screen.queryByText(/class list/)).toBeNull();
  });
});
