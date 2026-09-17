// @vitest-environment jsdom
// FIX-003: the HP damage/heal controls apply an exact, deterministic amount and
// roll exactly one concentration save per gesture. (The old single/double-tap
// combo double-fired: a "double-tap −5" applied −6 and rolled up to three saves.)
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';

// The sheet reads spell text through the registry: without one, every granted
// spell renders as a bare Cast button, which is the one path a limited grant
// usually does NOT take. The synthetic world stands in for the compendium.
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => makeTestContext() }));

// The cast chooser is a bottom sheet mounted by AppShell, which this router does
// not render; mocking it puts the offered options themselves under assertion and
// lets a test answer the prompt.
const dialogs = vi.hoisted(() => ({
  askChoice: vi.fn<(req: ChoiceRequest) => Promise<string | null>>(),
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: dialogs.askChoice,
  askConfirm: () => Promise.resolve(false),
  askNumber: () => Promise.resolve(null),
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
function renderSorcerer(mutate?: (doc: CharacterDoc) => void) {
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
      sheet,
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
  return { sheet, getDoc: () => current };
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
