// @vitest-environment jsdom
// FIX-003: the HP damage/heal controls apply an exact, deterministic amount and
// roll exactly one concentration save per gesture. (The old single/double-tap
// combo double-fired: a "double-tap −5" applied −6 and rolled up to three saves.)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { rollLogStore } from '@/stores/rollLog';
import { namelessControls } from '../../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { HP_SETTLE_MS, Component as PlayTab } from './PlayTab';

// The sheet reads spell text through the registry: without one, every granted
// spell renders as a bare Cast button, which is the one path a limited grant
// usually does NOT take. The synthetic world stands in for the compendium.
vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => makeTestContext(),
  useRegistryRefreshing: () => false,
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
}));

// The cast chooser is a bottom sheet mounted by AppShell, which this router does
// not render; mocking it puts the offered options themselves under assertion and
// lets a test answer the prompt.
const dialogs = vi.hoisted(() => ({
  askChoice: vi.fn<(req: ChoiceRequest) => Promise<string | null>>(),
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: dialogs.askChoice,
  askConfirm: () => Promise.resolve(false),
  askText: () => Promise.resolve(null),
}));

interface ChoiceRequest {
  title: string;
  detail?: string;
  options: Array<{ id: string; label: string; hint?: string }>;
}

/** The options the last chooser offered. */
const offered = () => {
  const req = dialogs.askChoice.mock.calls.at(-1)?.[0];
  return (req?.options ?? []).map((o) => `${o.label} | ${o.hint ?? ''}`);
};
/** Answer the next chooser with the option carrying this id. */
const answerWith = (id: string) => dialogs.askChoice.mockResolvedValueOnce(id);

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
  dialogs.askChoice.mockReset();
});

/** Render the Play tab for a level-3 Warrior at full HP; returns a live doc getter. */
function renderPlay(mutate?: (doc: CharacterDoc) => void, build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('p1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  // "build" changes what the sheet is derived FROM (equipment, classes);
  // "mutate" changes play state afterwards, which derivation does not read.
  build?.(doc);
  const sheet = deriveSheet(doc, makeTestContext());
  doc.play.currentHp = sheet.maxHp.value;
  doc.play.hpInitialized = true;
  mutate?.(doc);

  let current = doc;
  const update = (recipe: (d: CharacterDoc) => void) => {
    const d = structuredClone(current);
    recipe(d);
    current = d;
  };
  const ctxValue = {
    doc,
    sheet,
    update,
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    retryLoad: () => undefined,
  } as unknown as CharacterSheetState;

  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={ctxValue} />,
      children: [{ index: true, element: <PlayTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  return { start: sheet.maxHp.value, sheet, getDoc: () => current };
}

describe('PlayTab HP controls (FIX-003)', () => {
  it('applies an exact amount per click (−5 is −5, not −6)', () => {
    const { start, getDoc } = renderPlay();
    fireEvent.click(screen.getByLabelText('Damage 5 hit points'));
    expect(getDoc().play.currentHp).toBe(start - 5);
    fireEvent.click(screen.getByLabelText('Damage 1 hit point'));
    expect(getDoc().play.currentHp).toBe(start - 6);
    fireEvent.click(screen.getByLabelText('Heal 5 hit points'));
    expect(getDoc().play.currentHp).toBe(start - 1);
  });

  it('rolls exactly one concentration save for a single damage gesture', () => {
    const { getDoc } = renderPlay((d) => {
      d.play.concentratingOn = { label: 'Bless' };
    });
    rollLogStore.getState().clear();
    fireEvent.click(screen.getByLabelText('Damage 5 hit points'));
    const { rolls } = rollLogStore.getState();
    const conc = rolls.filter((r) => /Concentration save/.test(r.label ?? ''));
    expect(conc).toHaveLength(1);
    // Concentration is still held (nothing dropped it to 0) unless the save failed.
    expect(getDoc().play.currentHp).toBeGreaterThan(0);
  });
});

/** A wand granting searing bolt once a day, equipped. */
const withWand = (doc: CharacterDoc) => {
  doc.equipment = [
    {
      id: 'w1',
      ref: { name: 'Wand of Searing', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
};

describe('PlayTab limited granted spells', () => {
  it('spends a use when the spell is cast from its roll chip', () => {
    const { sheet, getDoc } = renderPlay(undefined, withWand);
    const grant = sheet.grantedSpells.find((g) => g.name === 'searing bolt');
    expect(grant?.usage).toBe('1/day');
    expect(screen.getByText('1/1 per day')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2d6' }));

    const key = grant?.resourceKey ?? '';
    expect(getDoc().play.resources).toContainEqual({ key, used: 1 });
    // Casting also marks the action it took, as any other cast does.
    expect(getDoc().play.turn?.action).toBe(true);
  });

  it('will not cast a grant with no uses left, from the chip or anywhere else', () => {
    // Most limited spells have dice and so cast from a chip rather than the
    // Cast button; a guard on the button alone would leave the limit unenforced.
    const { sheet, getDoc } = renderPlay((doc) => {
      const key = sheet_key(doc);
      doc.play.resources = [{ key, used: 1 }];
    }, withWand);
    expect(screen.getByText('0/1 per day')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2d6' }));

    // The dice still rolled (rolling is always allowed), but nothing was spent
    // and no part of the turn was consumed.
    expect(rollLogStore.getState().rolls.length).toBeGreaterThan(0);
    expect(getDoc().play.resources).toEqual([{ key: sheet_key(getDoc()), used: 1 }]);
    expect(getDoc().play.turn?.action).not.toBe(true);
    expect(sheet.grantedSpells).toHaveLength(1);
  });
});

/** The resource key the engine gives the wand's grant, read from a derived sheet. */
function sheet_key(doc: CharacterDoc): string {
  const derived = deriveSheet(doc, makeTestContext());
  return derived.grantedSpells.find((g) => g.name === 'searing bolt')?.resourceKey ?? '';
}

/**
 * A level-5 sorcerer who knows one scaling level-1 spell, with slots [4,3,2] and
 * a five-point Font of Magic pool: the shipped non-slot cast source.
 */
function renderSorcerer(mutate?: (doc: CharacterDoc) => void, build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('s1', 'Sparks', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 16 };
  doc.classes = [
    {
      ref: { name: 'Sorcerer', source: 'TST' },
      levels: 5,
      hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
    },
  ];
  const bolt = { name: 'Searing Bolt', source: 'TST' };
  doc.spellcasting = { 'sorcerer|tst': { known: [bolt], prepared: [bolt] } };
  // "build" changes what the sheet is derived FROM; "mutate" changes play state.
  build?.(doc);
  const sheet = deriveSheet(doc, makeTestContext());
  doc.play.currentHp = sheet.maxHp.value;
  doc.play.hpInitialized = true;
  mutate?.(doc);

  let current = doc;
  const update = (recipe: (d: CharacterDoc) => void) => {
    const d = structuredClone(current);
    recipe(d);
    current = d;
    rerender();
  };
  const ctxValue = () =>
    ({
      doc: current,
      sheet: deriveSheet(current, makeTestContext()),
      update,
      loadStatus: 'ready',
      missing: false,
      error: null,
      saveStatus: 'saved',
      retryLoad: () => undefined,
    }) as unknown as CharacterSheetState;
  const routes = () => [
    {
      path: '/',
      element: <Outlet context={ctxValue()} />,
      children: [{ index: true, element: <PlayTab /> }],
    },
  ];
  const view = render(<RouterProvider router={createMemoryRouter(routes())} />);
  // The doc lives outside React here, so a save has to be pushed back in for the
  // tab to re-read it, exactly as the real character session does.
  const rerender = () => view.rerender(<RouterProvider router={createMemoryRouter(routes())} />);
  /** Change what the sheet is derived from, leaving play state alone. */
  const rebuild = (recipe: (d: CharacterDoc) => void) => update(recipe);
  return { sheet, rebuild, getDoc: () => current };
}

describe('PlayTab cast resource choice (GAME-001)', () => {
  it('offers every slot level and every pool conversion, not just the lowest slot', async () => {
    renderSorcerer();
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await waitFor(() => expect(dialogs.askChoice).toHaveBeenCalled());
    expect(offered()).toEqual([
      'Level 1 slot | 2d6 · 4 left',
      'Level 2 slot (upcast) | 3d6 · 3 left',
      'Level 3 slot (upcast) | 4d6 · 2 left',
      'Level 1 slot from Sorcery Points | 2d6 · 2 points of 5 · Bonus Action to convert',
      'Level 2 slot from Sorcery Points (upcast) | 3d6 · 3 points of 5 · Bonus Action to convert',
      'Level 3 slot from Sorcery Points (upcast) | 4d6 · 5 points of 5 · Bonus Action to convert',
    ]);
  });

  it('scales the roll chip to the chosen slot before the roll happens', async () => {
    renderSorcerer();
    expect(screen.getByRole('button', { name: '2d6' })).toBeTruthy();
    answerWith('slot-3');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    // Choosing does not cast: it re-aims the roll chip, and the roll spends it.
    await screen.findByRole('button', { name: '4d6' });
    expect(screen.queryByRole('button', { name: '2d6' })).toBeNull();
  });

  it('spends the chosen slot on the roll, and returns to the automatic pick after', async () => {
    const { getDoc } = renderSorcerer();
    answerWith('slot-3');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    fireEvent.click(await screen.findByRole('button', { name: '4d6' }));

    expect(getDoc().play.slotsSpent[2]).toBe(1); // the level 3 slot
    expect(getDoc().play.slotsSpent[0]).toBe(0); // level 1 untouched
    // The pick was about that cast: the next one starts from the lowest slot.
    await screen.findByRole('button', { name: /casting with level 1 slot/i });
    expect(screen.getByRole('button', { name: '2d6' })).toBeTruthy();
  });

  it('casts from the point pool when that is the choice, spending points and a Bonus Action', async () => {
    const { getDoc } = renderSorcerer();
    answerWith('pool-sorcery-points-2');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    fireEvent.click(await screen.findByRole('button', { name: '3d6' }));

    expect(getDoc().play.resources).toContainEqual({ key: 'sorcery-points', used: 3 });
    expect(getDoc().play.slotsSpent.every((n) => n === 0)).toBe(true);
    expect(getDoc().play.turn?.action).toBe(true); // the spell
    expect(getDoc().play.turn?.bonus).toBe(true); // converting the points
  });

  it('reaches for the pool rather than a slotless cast once the slots are gone', async () => {
    const { getDoc } = renderSorcerer((doc) => {
      doc.play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    });
    // No slots left, but three points buy a level 2 slot: the chip says so
    // instead of offering a cast that spends nothing.
    await screen.findByRole('button', { name: /casting with level 1 slot from sorcery points/i });
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(getDoc().play.resources).toContainEqual({ key: 'sorcery-points', used: 2 });
  });

  it('drops a stale pick instead of spending what the character no longer has', async () => {
    const { getDoc } = renderSorcerer((doc) => {
      doc.play.slotsSpent = [0, 0, 1, 0, 0, 0, 0, 0, 0]; // one level 3 slot left
    });
    answerWith('slot-3');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await screen.findByRole('button', { name: '4d6' });

    // That last level 3 slot goes elsewhere (the slot pips) before the roll.
    fireEvent.click(screen.getByLabelText('Level 3 slot 2'));
    await screen.findByRole('button', { name: /casting with level 1 slot/i });
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(getDoc().play.slotsSpent[0]).toBe(1); // fell back to level 1
    expect(getDoc().play.slotsSpent[2]).toBe(2); // not over-spent
  });
});

describe('PlayTab cast resource cues (GAME-001)', () => {
  it('still shows the chip when the only thing left to spend is a conversion', async () => {
    // Two points buys a level 1 slot and nothing else, so there is one option.
    // With no chip the row's only control is the damage roll, and pressing it
    // would empty the pool and take a Bonus Action with nothing said first.
    const { getDoc } = renderSorcerer((doc) => {
      doc.play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
      doc.play.resources = [{ key: 'sorcery-points', used: 3 }];
    });
    const chip = await screen.findByRole('button', {
      name: /casting with level 1 slot from sorcery points/i,
    });
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');

    // Pressing it prices the one option rather than casting it.
    fireEvent.click(chip);
    await waitFor(() => expect(dialogs.askChoice).toHaveBeenCalled());
    expect(offered()).toEqual([
      'Level 1 slot from Sorcery Points | 2d6 · 2 points of 2 · Bonus Action to convert',
    ]);
    expect(getDoc().play.resources).toEqual([{ key: 'sorcery-points', used: 3 }]);
  });

  it('does not bring a suppressed pick back when its slot returns', async () => {
    const { getDoc } = renderSorcerer((doc) => {
      doc.play.slotsSpent = [0, 0, 1, 0, 0, 0, 0, 0, 0]; // one level 3 slot left
    });
    answerWith('slot-3');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await screen.findByRole('button', { name: '4d6' });

    // Spend that last level 3 slot elsewhere, then get it back (an undo, or the
    // long rest that happens on this very tab). The pick was made against a
    // state that no longer exists and must not reapply itself.
    fireEvent.click(screen.getByLabelText('Level 3 slot 2'));
    await screen.findByRole('button', { name: /casting with level 1 slot/i });
    fireEvent.click(screen.getByLabelText('Level 3 slot 2'));
    await waitFor(() => expect(getDoc().play.slotsSpent[2]).toBe(1));

    expect(screen.getByRole('button', { name: /casting with level 1 slot/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(getDoc().play.slotsSpent[0]).toBe(1); // level 1, not the abandoned pick
  });

  it('warns when converting wants the Bonus Action the spell already wants', async () => {
    renderSorcerer(undefined, (doc) => {
      doc.spellcasting = {
        'sorcerer|tst': { known: [{ name: 'Quick Bolt', source: 'TST' }], prepared: [] },
      };
    });
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await waitFor(() => expect(dialogs.askChoice).toHaveBeenCalled());
    expect(offered().filter((o) => o.includes('Sorcery Points'))).toEqual([
      "Level 1 slot from Sorcery Points | 2d6 · 2 points of 5 · Bonus Action to convert, on top of the spell's own",
      "Level 2 slot from Sorcery Points (upcast) | 3d6 · 3 points of 5 · Bonus Action to convert, on top of the spell's own",
      "Level 3 slot from Sorcery Points (upcast) | 4d6 · 5 points of 5 · Bonus Action to convert, on top of the spell's own",
    ]);
  });

  it('labels a 2024 conversion the Sorcerer is too low to create, and still offers it', async () => {
    // GAME-008: 2024 "Create Spell Slot" needs Sorcerer 9 for a 5th-level slot.
    // Seven points buy one at Sorcerer 7, so it is offered, with the level said.
    const { getDoc } = renderSorcerer(undefined, (doc) => {
      doc.rulesVersion = '2024';
      const c = doc.classes[0];
      if (c !== undefined) {
        c.levels = 7;
        c.hp = Array(7).fill('avg');
      }
    });
    answerWith('pool-sorcery-points-5');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await waitFor(() => expect(dialogs.askChoice).toHaveBeenCalled());
    const points = offered().filter((o) => o.includes('Sorcery Points'));
    expect(points.at(-1)).toBe(
      'Level 5 slot from Sorcery Points (upcast) | 6d6 · 7 points of 7 · Bonus Action to convert · 2024: needs Sorcerer 9',
    );
    // Only the row that needs more says so.
    expect(points.filter((o) => o.includes('needs'))).toHaveLength(1);

    fireEvent.click(await screen.findByRole('button', { name: '6d6' }));
    expect(getDoc().play.resources).toContainEqual({ key: 'sorcery-points', used: 7 });
  });
});

describe('PlayTab always-prepared grants (GAME-001)', () => {
  /** Warrior 3 / Path of Tests, whose subclass always-prepares bless at level 1. */
  const withPreparedGrant = (doc: CharacterDoc) => {
    doc.classes = [
      {
        ref: { name: 'Warrior', source: 'TST' },
        subclass: { name: 'Path of Tests', source: 'TST' },
        levels: 3,
        hp: ['avg', 'avg', 'avg'],
      },
      ...doc.classes,
    ];
  };

  it('offers the same choice on a grant cast from class slots, and spends the pick', async () => {
    const { sheet, getDoc } = renderSorcerer(undefined, withPreparedGrant);
    expect(sheet.grantedSpells.some((g) => g.name === 'bless' && g.usage === 'prepared')).toBe(
      true,
    );

    answerWith('slot-2');
    fireEvent.click(screen.getByRole('button', { name: /^bless: casting with level 1 slot/i }));
    await waitFor(() => expect(dialogs.askChoice).toHaveBeenCalled());
    expect(offered()[1]).toContain('Level 2 slot (upcast)');

    const cast = await screen.findByRole('button', { name: /^bless: casting with level 2 slot/i });
    expect(cast).toBeTruthy();
    fireEvent.click(screen.getByTitle('Cast (spends level 2 slot)'));
    expect(getDoc().play.slotsSpent[1]).toBe(1);
    expect(getDoc().play.slotsSpent[0]).toBe(0);
    // The pick was for that cast only.
    await screen.findByRole('button', { name: /^bless: casting with level 1 slot/i });
  });
});

describe('PlayTab limited always-prepared grants', () => {
  const withSigil = (doc: CharacterDoc) => {
    doc.feats = [{ ref: { name: 'Mote Sigil', source: 'TST' }, instanceId: 'i1' }];
  };
  const keyOf = (sheet: { grantedSpells: Array<{ resourceKey?: string }> }) =>
    sheet.grantedSpells.find((g) => g.resourceKey !== undefined)?.resourceKey ?? '';

  it('gives a non-caster its free use and nothing past it', () => {
    const { sheet, getDoc } = renderPlay(undefined, withSigil);
    expect(sheet.grantedSpells).toHaveLength(1);
    expect(screen.queryByText('Always prepared')).toBeNull();

    const cast = screen.getByRole('button', { name: 'Cast daze mote' });
    fireEvent.click(cast);
    expect(getDoc().play.resources).toContainEqual({ key: keyOf(sheet), used: 1 });
  });

  it('will not cast for a non-caster once the free use is spent', () => {
    renderPlay((doc) => {
      doc.play.resources = [{ key: 'spell:mote sigil|tst:daze-mote', used: 1 }];
    }, withSigil);
    expect(screen.getByText('0/1 per day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast daze mote' })).toHaveProperty('disabled', true);
  });

  it('gives a caster a slot row and a free row, each spending its own', () => {
    const { sheet, getDoc } = renderSorcerer(undefined, withSigil);
    expect(sheet.grantedSpells.map((g) => g.usage)).toEqual(['prepared', '1/day']);
    expect(screen.getByText('Always prepared')).toBeTruthy();
    expect(screen.getByText('1/1 per day')).toBeTruthy();

    const [withSlot, free] = screen.getAllByRole('button', { name: 'Cast daze mote' });
    if (withSlot === undefined || free === undefined) throw new Error('expected two rows');
    fireEvent.click(free);
    expect(getDoc().play.resources).toContainEqual({ key: keyOf(sheet), used: 1 });
    expect(getDoc().play.slotsSpent[0]).toBe(0);

    fireEvent.click(withSlot);
    expect(getDoc().play.slotsSpent[0]).toBe(1);
  });
});

describe('PlayTab inherited casting ability', () => {
  it('shows the DC of the ability the feat raised', () => {
    // Level 3, so proficiency +2. Charisma 10 raised to 11 is still +0.
    renderPlay(undefined, (doc) => {
      doc.feats = [{ ref: { name: 'Mote Gift', source: 'TST' }, instanceId: 'i1' }];
    });
    expect(screen.getByText('CHA')).toBeTruthy();
    expect(screen.getByText('DC 10')).toBeTruthy();
  });
});

describe('PlayTab pick lifecycle (GAME-001)', () => {
  it('drops a pick the build invalidated, with play state untouched', async () => {
    // The other stale-pick tests invalidate by spending a slot, which moves
    // play state and so cannot tell the live-options check apart from the
    // spend-state effect. A level drop moves neither: only the check can catch
    // it, so this is what pins that half of the lifecycle.
    const { getDoc, rebuild } = renderSorcerer();
    answerWith('slot-3');
    fireEvent.click(screen.getByRole('button', { name: /casting with level 1 slot/i }));
    await screen.findByRole('button', { name: '4d6' });
    const spendBefore = JSON.stringify(getDoc().play.slotsSpent);

    rebuild((d) => {
      d.classes = [
        { ref: { name: 'Sorcerer', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
      ];
    });

    // A level-3 sorcerer has no level 3 slots, and nothing was spent to say so.
    expect(JSON.stringify(getDoc().play.slotsSpent)).toBe(spendBefore);
    await screen.findByRole('button', { name: /casting with level 1 slot/i });
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(getDoc().play.slotsSpent[0]).toBe(1);
    expect(getDoc().play.slotsSpent[2]).toBe(0);
  });
});

// A11Y-001: toggles that showed their state only by colour or a strike-through,
// warning icons that lucide hides and nothing else named, and repeated "Use"
// and "Cast" buttons that did not say what they act on.
describe('PlayTab accessible names and states (A11Y-001)', () => {
  // jsdom has no matchMedia and the breakdown drawer asks for one on mount.
  beforeAll(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });

  it('names every control while dying, concentrating and stunned, and in an open sheet', async () => {
    const { sheet } = renderPlay((d) => {
      d.play.currentHp = 0;
      d.play.concentratingOn = { label: 'Bless' };
      d.play.conditions = [{ id: 'Stunned' }];
    });
    expect(namelessControls()).toEqual([]);

    const [die, total] = Object.entries(sheet.hitDice)[0] ?? [];
    expect(
      screen.getByRole('button', { name: `Spend a ${die} hit die, ${total} left` }),
    ).toBeTruthy();
    // Stunned's own controls (its rules, its removal) are on the condition
    // strip now; ConditionStrip.test.tsx names them.

    // Portaled sheet content renders outside the tab, so sweep it once open.
    fireEvent.click(screen.getByRole('button', { name: 'How is this worked out?' }));
    expect(await screen.findByRole('textbox', { name: 'Override Max HP' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('reads out the warnings a hidden icon carries, and names Cast after its spell', () => {
    renderSorcerer(
      (d) => {
        d.play.conditions = [{ id: 'Stunned' }];
      },
      (d) => {
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            subclass: { name: 'Path of Tests', source: 'TST' },
            levels: 3,
            hp: ['avg', 'avg', 'avg'],
          },
          ...d.classes,
        ];
      },
    );
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Cast bless' })).toBeTruthy();
    expect(
      screen.getAllByText(/^Stunned: you can't speak, and this spell has a verbal component$/)
        .length,
    ).toBeGreaterThan(0);
  });

  it('reports each toggle as not pressed on a fresh sheet', () => {
    renderPlay();
    expect(screen.getByRole('button', { name: 'Inspiration', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Concentration', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Action', pressed: false })).toBeTruthy();
    // The condition toggles are in the condition picker: ConditionStrip.test.tsx.
  });

  it('reports each toggle that is on as pressed', () => {
    renderPlay((d) => {
      d.play.inspiration = true;
      d.play.concentratingOn = { label: 'Bless' };
      d.play.turn = { action: true, bonus: false, reaction: false };
      d.play.conditions = [{ id: 'Poisoned' }];
      d.play.currentHp = 0;
      d.play.deathSaves = { success: 1, fail: 0 };
    });
    expect(screen.getByRole('button', { name: 'Inspiration', pressed: true })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Concentrating on Bless', pressed: true }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Action', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bonus action', pressed: false })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Death save success 1', pressed: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Death save success 2', pressed: false }),
    ).toBeTruthy();
  });
});

describe('PlayTab hit point meter (A11Y-002)', () => {
  it('reports current and maximum hit points, and follows a damage tap', () => {
    // The sorcerer sheet rerenders on every update, so the meter is read live.
    const { sheet } = renderSorcerer((d) => {
      d.play.tempHp = 3;
    });
    const max = sheet.maxHp.value;
    const meter = screen.getByRole('meter', { name: 'Hit points' });
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe(String(max));
    expect(meter.getAttribute('aria-valuenow')).toBe(String(max));
    expect(meter.getAttribute('aria-valuetext')).toBe(`${max} of ${max}, plus 3 temporary`);

    // Temp HP soaks damage first: 3 of the 5 come off it, 2 off current.
    fireEvent.click(screen.getByRole('button', { name: 'Damage 5 hit points' }));
    const after = screen.getByRole('meter', { name: 'Hit points' });
    expect(after.getAttribute('aria-valuenow')).toBe(String(max - 2));
    expect(after.getAttribute('aria-valuetext')).toBe(`${max - 2} of ${max}`);
  });

  it('says the HP on screen when a house rule leaves it above max', () => {
    // The overage banner lets a player keep HP over a lowered maximum. The
    // value has to stay in range; the spoken text must not quietly cap it.
    const { sheet } = renderSorcerer((d) => {
      d.play.currentHp = d.play.currentHp + 4;
    });
    const max = sheet.maxHp.value;
    const meter = screen.getByRole('meter', { name: 'Hit points' });
    expect(meter.getAttribute('aria-valuenow')).toBe(String(max));
    expect(meter.getAttribute('aria-valuetext')).toBe(`${max + 4} of ${max}`);
  });
});

// A11Y-002: HP is said once it settles, never per tap. A run of steppers is one
// change to a listener, so only where it ends is spoken.
describe('PlayTab hit point announcements (A11Y-002)', () => {
  const spoken = () => getAnnouncerState().messages.map((m) => m.text);

  afterEach(() => {
    resetAnnouncer();
    vi.useRealTimers();
  });

  it('says a burst of damage taps once, with where it ended', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    resetAnnouncer();
    const { start, sheet } = renderPlay();
    const max = sheet.maxHp.value;
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByLabelText('Damage 1 hit point'));
      act(() => vi.advanceTimersByTime(100));
    }
    // Nothing while the taps keep coming, or just after.
    act(() => vi.advanceTimersByTime(HP_SETTLE_MS - 200));
    expect(getAnnouncerState().emitted).toBe(0);
    act(() => vi.advanceTimersByTime(200));
    expect(spoken()).toEqual([`${start - 5} of ${max} hit points`]);
    act(() => vi.advanceTimersByTime(HP_SETTLE_MS * 5));
    expect(getAnnouncerState().emitted).toBe(1);
  });

  it('drops an HP line still settling when the tab goes away', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    resetAnnouncer();
    renderPlay();
    fireEvent.click(screen.getByLabelText('Damage 1 hit point'));
    act(() => vi.advanceTimersByTime(HP_SETTLE_MS / 2));
    cleanup();
    act(() => vi.advanceTimersByTime(HP_SETTLE_MS * 2));
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('says where an exact amount from the HP sheet left it', async () => {
    resetAnnouncer();
    const { sheet: derived, getDoc } = renderPlay();
    const max = derived.maxHp.value;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`/ ${max}\\s*hit points`) }));
    const sheet = await screen.findByRole('dialog', { name: 'Hit points' });
    fireEvent.click(
      within(within(sheet).getByRole('group', { name: 'Keypad' })).getByRole('button', {
        name: '7',
      }),
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Take 7 damage' }));
    expect(getDoc().play.currentHp).toBe(max - 7);
    await waitFor(() => expect(spoken()).toEqual([`${max - 7} of ${max} hit points`]), {
      timeout: HP_SETTLE_MS + 1000,
    });
  });
});

describe('PlayTab while game data is still landing', () => {
  it('does not call spent slots over a limit its class has not delivered yet', () => {
    renderPlay(
      (d) => {
        d.play.slotsSpent[0] = 1;
      },
      (d) => {
        d.classes = [{ ref: { name: 'Not Here Yet', source: 'TST' }, levels: 3, hp: [] }];
      },
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bring within limits' })).toBeNull();
  });

  it('does once the class is there and a limit really was lowered', () => {
    renderPlay((d) => {
      d.play.slotsSpent[0] = 1;
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Level 1 spell slots spent: 1 → max 0/);
  });
});

describe('PlayTab HP card (DS-001 HitPoints)', () => {
  it('keeps temp HP on a chip of its own, named for what it holds', () => {
    renderPlay();
    expect(screen.getByRole('button', { name: 'Temp HP' })).toBeTruthy();
    cleanup();
    renderPlay((d) => {
      d.play.tempHp = 5;
    });
    const chip = screen.getByRole('button', { name: '+5 temporary hit points' });
    expect(chip.textContent).toBe('+5 temp');
  });

  it('says hit dice in words, and cannot spend one that is not there', () => {
    const { getDoc } = renderPlay((d) => {
      d.play.hitDiceSpent = { d10: 3 };
    });
    const die = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Spend a d10 hit die, 0 left',
    });
    expect(die.textContent).toBe('0 of 3 d10');
    expect(die.disabled).toBe(true);
    fireEvent.click(die);
    expect(getDoc().play.hitDiceSpent.d10).toBe(3);
  });
});

describe('PlayTab numbers', () => {
  it('shows a negative with a true minus, and rolls it with the hyphen dice read', () => {
    renderPlay(undefined, (d) => {
      d.abilities.base.dex = 8;
    });
    const initiative = screen.getByRole('button', { name: /Initiative/ });
    expect(initiative.textContent).toContain('\u22121');
    fireEvent.click(initiative);
    expect(rollLogStore.getState().rolls[0]?.expr).toMatch(/-1$/);
  });

  it('says each spell slot level in words beside its pips', () => {
    renderPlay(undefined, (d) => {
      d.classes = [{ ref: { name: 'Sorcerer', source: 'TST' }, levels: 3, hp: [] }];
    });
    expect(screen.getByText('Level 1')).toBeTruthy();
    expect(screen.getByText('4 of 4')).toBeTruthy();
  });
});

describe('PlayTab toggles', () => {
  it('says On or Off to the eye, and leaves the state to aria-pressed in the name', () => {
    renderPlay();
    const off = screen.getByRole('button', { name: 'Inspiration', pressed: false });
    expect(off.textContent).toBe('InspirationOff');
    expect(screen.getByRole('button', { name: 'Concentration' }).textContent).toBe(
      'ConcentrationOff',
    );
    cleanup();
    renderPlay((d) => {
      d.play.inspiration = true;
      d.play.concentratingOn = { label: 'Bless' };
    });
    expect(screen.getByRole('button', { name: 'Inspiration', pressed: true }).textContent).toBe(
      'InspirationOn',
    );
    expect(
      screen.getByRole('button', { name: 'Concentrating on Bless', pressed: true }).textContent,
    ).toContain('Concentrating: ');
  });
});

describe('PlayTab turn tracker (DS-001 TurnTracker)', () => {
  it('says Ready or Used in words, and keeps each name whatever its state', () => {
    renderPlay((d) => {
      d.play.turn = { action: true, bonus: false, reaction: false };
    });
    const action = screen.getByRole('button', { name: 'Action', pressed: true });
    const bonus = screen.getByRole('button', { name: 'Bonus action', pressed: false });
    expect(action.textContent).toBe('ActionUsed');
    expect(bonus.textContent).toBe('Bonus actionReady');
    // Used strikes the name, not the word that says so.
    expect(within(action).getByText('Action').className).toContain('line-through');
    expect(within(action).getByText('Used').className).not.toContain('line-through');
  });
});

describe('PlayTab HP tip (DS-001 Hint)', () => {
  const TIP = 'Tap the number to type an exact amount.';
  // Other tests here tap the number, which dismisses the tip for the file.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows once, and stays dismissed on this device', () => {
    const { start } = renderPlay();
    expect(screen.getByText(TIP)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(screen.queryByText(TIP)).toBeNull();
    // Focus goes to the number the tip was about, not the page.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: new RegExp(`^${start} / ${start}`) }),
    );
    cleanup();
    renderPlay();
    expect(screen.queryByText(TIP)).toBeNull();
  });

  it('goes for good once the number is tapped', () => {
    const { start } = renderPlay();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${start} / ${start}`) }));
    expect(screen.queryByText(TIP)).toBeNull();
    cleanup();
    renderPlay();
    expect(screen.queryByText(TIP)).toBeNull();
  });

  it('no longer puts the old how-to line on the card', () => {
    renderPlay();
    expect(screen.queryByText(/tap ±1 or ±5/)).toBeNull();
  });
});

describe('PlayTab action costs', () => {
  const origin = 'Test feature';
  const POOL = { key: 'pool', label: 'Test Pool (d6)', max: 3, resetOn: 'long', origin } as const;
  type SheetAction = NonNullable<CharacterSheetState['sheet']>['actions'][number];
  type SheetResource = NonNullable<CharacterSheetState['sheet']>['resources'][number];

  /** A Warrior's Play tab with these actions and one pool, re-read after each save. */
  function renderCosts(
    actions: Array<Partial<SheetAction>>,
    moreResources: readonly SheetResource[] = [],
  ) {
    const doc = newCharacterDoc('p1', 'Hero', 't');
    doc.abilities.method = 'manual';
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
    ];
    doc.play.hpInitialized = true;
    doc.play.currentHp = 10;
    let current = doc;
    const sheetNow = () => {
      const sheet = deriveSheet(current, makeTestContext());
      sheet.resources.push({ ...POOL }, ...moreResources);
      sheet.actions.push(...actions.map((a) => ({ origin, ...a }) as SheetAction));
      return sheet;
    };
    let lastLabel: string | undefined;
    const update = (recipe: (d: CharacterDoc) => void, label?: string) => {
      const d = structuredClone(current);
      recipe(d);
      current = d;
      lastLabel = label;
      rerender();
    };
    const ctxValue = () =>
      ({
        doc: current,
        sheet: sheetNow(),
        update,
        loadStatus: 'ready',
        missing: false,
        error: null,
        saveStatus: 'saved',
        retryLoad: () => undefined,
      }) as unknown as CharacterSheetState;
    const routes = () => [
      {
        path: '/',
        element: <Outlet context={ctxValue()} />,
        children: [{ index: true, element: <PlayTab /> }],
      },
    ];
    const view = render(<RouterProvider router={createMemoryRouter(routes())} />);
    const rerender = () => view.rerender(<RouterProvider router={createMemoryRouter(routes())} />);
    return {
      used: () => current.play.resources.find((r) => r.key === 'pool')?.used ?? 0,
      usedOf: (key: string) => current.play.resources.find((r) => r.key === key)?.used ?? 0,
      turn: () => current.play.turn,
      logged: () => lastLabel,
      spendPool: (amount: number) =>
        update((d) => {
          d.play.resources.push({ key: 'pool', used: amount });
        }),
      /** Changes the doc with no render, so the buttons still act on what they last saw. */
      refillUnseen: () => {
        current = structuredClone(current);
        current.play.resources = current.play.resources.filter((r) => r.key !== 'pool');
      },
    };
  }

  const useButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Use Quick Step' });

  it('spends the amount the cost names and marks the slot', () => {
    const { used, turn } = renderCosts([
      { economy: 'bonus', label: 'Quick Step', cost: { resource: 'pool', amount: 2 } },
    ]);
    fireEvent.click(useButton());
    expect(used()).toBe(2);
    expect(turn()?.bonus).toBe(true);
  });

  it('turns the button off when the pool cannot pay', () => {
    const { used } = renderCosts([
      { economy: 'action', label: 'Quick Step', cost: { resource: 'pool', amount: 2 } },
    ]);
    fireEvent.click(useButton());
    expect(useButton().disabled).toBe(true);
    expect(useButton().title).toBe('Not enough Test Pool');
    expect(used()).toBe(2);
  });

  it('spends on a rider without marking any slot', () => {
    const { used, turn } = renderCosts([
      { economy: 'none', label: 'Quick Step', cost: { resource: 'pool', amount: 1 } },
    ]);
    fireEvent.click(useButton());
    expect(used()).toBe(1);
    expect(turn()?.action ?? false).toBe(false);
    expect(turn()?.bonus ?? false).toBe(false);
    expect(turn()?.reaction ?? false).toBe(false);
  });

  it('records a rolled use only while the pool can pay', () => {
    const rolled = (amount: number) => ({
      economy: 'action' as const,
      label: 'Quick Step',
      roll: '1d4',
      cost: { resource: 'pool', amount },
    });
    const first = renderCosts([rolled(2)]);
    const chip = () => screen.getByTitle('Quick Step');
    fireEvent.click(chip());
    expect(first.used()).toBe(2);
    expect(first.turn()?.action).toBe(true);
    // One left of three: the dice roll, and nothing more is spent.
    fireEvent.click(chip());
    expect(first.used()).toBe(2);
    cleanup();

    // Short from the start: nothing is spent and the slot stays open.
    const short = renderCosts([rolled(4)]);
    fireEvent.click(chip());
    expect(short.used()).toBe(0);
    expect(short.turn()?.action ?? false).toBe(false);
  });

  it('warns about a condition on an action, not on a rider', () => {
    renderCosts([
      { economy: 'none', label: 'Quick Step', cost: { resource: 'pool', amount: 1 } },
      { economy: 'action', label: 'Slow Step' },
    ]);
    expect(screen.queryByText(/normally can't take/)).toBeNull();
  });

  it('offers a free use and a paid one, each doing only that', () => {
    const { used, turn } = renderCosts([
      {
        economy: 'bonus',
        label: 'Quick Step',
        cost: { resource: 'pool', amount: 1, optional: true },
      },
    ]);
    fireEvent.click(useButton());
    expect(used()).toBe(0);
    expect(turn()?.bonus).toBe(true);
    const paid = screen.getByRole('button', { name: 'Use Quick Step, spending 1 Test Pool' });
    expect(paid.textContent).toBe('+1 Test Pool');
    fireEvent.click(paid);
    expect(used()).toBe(1);
  });

  it('leaves the spending to the player when the amount varies', () => {
    const { used, turn } = renderCosts([
      { economy: 'action', label: 'Quick Step', cost: { resource: 'pool', amount: 'varies' } },
    ]);
    fireEvent.click(useButton());
    expect(used()).toBe(0);
    expect(turn()?.action).toBe(true);
  });

  it('has no button for a rider whose amount the player decides, and still says the pool', () => {
    renderCosts([
      { economy: 'none', label: 'Quick Step', cost: { resource: 'pool', amount: 'varies' } },
    ]);
    expect(screen.queryByRole('button', { name: 'Use Quick Step' })).toBeNull();
    expect(screen.getByText('Test Pool: you choose, 3 of 3 left')).toBeTruthy();
  });

  it('offers Restore only at no uses left, and it pays without taking a slot', () => {
    const { used, turn, usedOf, logged } = renderCosts(
      [{ economy: 'none', label: 'Quick Step', buyBack: { resource: 'pool', amount: 2 } }],
      [{ key: 'own', label: 'Quick Step', max: 1, resetOn: 'long', origin }],
    );
    const restore = () =>
      screen.queryByRole<HTMLButtonElement>('button', {
        name: 'Restore Quick Step, spending 2 Test Pool',
      });
    expect(screen.getByText('1 of 1 left · Test Pool: 2 to restore, 3 of 3 left')).toBeTruthy();
    expect(restore()).toBeNull();

    fireEvent.click(useButton());
    expect(usedOf('own')).toBe(1);
    expect(used()).toBe(0);
    expect(useButton().disabled).toBe(true);

    const button = restore();
    if (button === null) throw new Error('no Restore');
    expect(button.textContent).toBe('Restore');
    fireEvent.click(button);
    expect(usedOf('own')).toBe(0);
    expect(used()).toBe(2);
    expect(turn()?.action ?? false).toBe(false);
    expect(turn()?.bonus ?? false).toBe(false);
    expect(turn()?.reaction ?? false).toBe(false);
    expect(restore()).toBeNull();
    expect(useButton().disabled).toBe(false);
    expect(logged()).toBe('Restored Quick Step');
  });

  it('spends the use and refills the pool in one tap, when the action regains', () => {
    const { used, turn, usedOf, spendPool } = renderCosts(
      [{ economy: 'bonus', label: 'Quick Step', regains: { resource: 'pool', amount: 1 } }],
      [{ key: 'own', label: 'Quick Step', max: 1, resetOn: 'short', origin }],
    );
    expect(useButton().disabled).toBe(true);
    spendPool(2);
    fireEvent.click(useButton());
    expect(used()).toBe(1);
    expect(usedOf('own')).toBe(1);
    expect(turn()?.bonus).toBe(true);
  });

  it('takes nothing when a tap beat the render that showed the pool refilled', () => {
    const { used, turn, usedOf, spendPool, refillUnseen } = renderCosts(
      [{ economy: 'bonus', label: 'Quick Step', regains: { resource: 'pool', amount: 1 } }],
      [{ key: 'own', label: 'Quick Step', max: 1, resetOn: 'short', origin }],
    );
    spendPool(1);
    expect(useButton().disabled).toBe(false);
    refillUnseen();
    fireEvent.click(useButton());
    expect(used()).toBe(0);
    expect(usedOf('own')).toBe(0);
    expect(turn()?.bonus ?? false).toBe(false);
  });

  it('says when a pool comes back in part, on its row', () => {
    renderCosts(
      [],
      [{ key: 'own', label: 'Quick Step', max: 1, resetOn: 'long', regainOnShort: 1, origin }],
    );
    expect(screen.getByText('One back on a short rest, all on a long rest')).toBeTruthy();
  });

  it('keeps Restore in sight but off when the pool cannot pay', () => {
    const { usedOf } = renderCosts(
      [{ economy: 'none', label: 'Quick Step', buyBack: { resource: 'pool', amount: 4 } }],
      [{ key: 'own', label: 'Quick Step', max: 1, resetOn: 'long', origin }],
    );
    fireEvent.click(useButton());
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Restore Quick Step, spending 4 Test Pool',
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Not enough Test Pool');
    expect(usedOf('own')).toBe(1);
  });
});
