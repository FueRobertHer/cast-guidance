// @vitest-environment jsdom
// A spell's file says its level, and its level says what casting it spends. A
// spell whose file had not arrived read as level 1, so a known cantrip showed
// "L1" and casting it spent a slot. The row now waits for the file, and only a
// spell no file holds is left to the player, marked as unknown.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypePacksState } from '@/data5e/hooks';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, type EntityRef, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';

const data = vi.hoisted(() => ({
  /** Whether the spell files have reached the registry. */
  spellsHere: true,
  refreshing: false,
  requested: [] as Array<string | undefined>,
  packs: {} as unknown,
}));

/** The test world, with or without the spells a character's file would hold. */
const registry = () => {
  const ctx = makeTestContext();
  if (data.spellsHere) return ctx;
  return {
    get: (type: string, name: string, source?: string) =>
      type === 'spell' ? undefined : ctx.get(type, name, source),
    byType: (type: string) => (type === 'spell' ? [] : ctx.byType(type)),
  };
};

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => registry(),
  useRegistryRefreshing: () => data.refreshing,
  useTypePacks: (type: string | undefined) => {
    data.requested.push(type);
    return data.packs;
  },
}));

const packs = (over: Partial<TypePacksState> = {}): TypePacksState => ({
  status: 'ready',
  error: null,
  offline: false,
  retry: vi.fn(),
  repair: () => undefined,
  ...over,
});

const GUIDANCE: EntityRef = { name: 'Guidance', source: 'TST' };

/** The slot tracker's own row is labelled L1, so one is the most there should be. */
const expectNoSpellClaimsLevel1 = () => expect(screen.getAllByText('L1')).toHaveLength(1);

/** A level-5 sorcerer who knows `known`, with slots to spend. */
function renderCaster(known: EntityRef[], granted: unknown[] = []) {
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
  doc.spellcasting = { 'sorcerer|tst': { known, prepared: known } };
  const sheet = deriveSheet(doc, makeTestContext());
  sheet.grantedSpells = granted as typeof sheet.grantedSpells;
  doc.play.currentHp = sheet.maxHp.value;
  doc.play.hpInitialized = true;

  const updates: Array<(d: CharacterDoc) => void> = [];
  const context = {
    doc,
    sheet,
    update: (recipe: (d: CharacterDoc) => void) => updates.push(recipe),
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    retryLoad: () => undefined,
  } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={context} />,
      children: [{ index: true, element: <PlayTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  return { updates };
}

beforeEach(() => {
  data.spellsHere = true;
  data.refreshing = false;
  data.requested = [];
  data.packs = packs();
});

afterEach(cleanup);

describe('a known spell on the Play tab', () => {
  it('reads as what it is once its file has arrived, asking for nothing', () => {
    renderCaster([GUIDANCE]);
    expect(screen.getByRole('button', { name: 'Cast Guidance' })).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();
    expect(data.requested.at(-1)).toBeUndefined();
  });

  it('asks for the spell files and offers no cast until they arrive', () => {
    data.spellsHere = false;
    data.packs = packs({ status: 'loading' });
    renderCaster([GUIDANCE]);
    expect(data.requested.at(-1)).toBe('spell');
    // The name still opens the rules sheet, which reports on the file.
    expect(screen.getByRole('button', { name: 'Guidance' })).toBeTruthy();
    // The bug itself: a cantrip with a level-1 label and a button that spends a slot.
    expectNoSpellClaimsLevel1();
    expect(screen.queryByRole('button', { name: 'Cast Guidance' })).toBeNull();
  });

  it('keeps waiting while the registry catches up with a finished download', () => {
    data.spellsHere = false;
    data.refreshing = true;
    renderCaster([GUIDANCE]);
    expect(screen.queryByRole('button', { name: 'Cast Guidance' })).toBeNull();
  });

  it('says so when the files cannot arrive, and Retry asks again', () => {
    data.spellsHere = false;
    const failed = packs({ status: 'error', error: 'HTTP 503' });
    data.packs = failed;
    renderCaster([GUIDANCE]);
    expect(screen.getByText("Spell details couldn't be downloaded: HTTP 503")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast Guidance' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.retry).toHaveBeenCalledOnce();
  });

  it('marks a spell no file holds as unknown, and leaves casting it to the player', () => {
    renderCaster([{ name: 'Forgotten Word', source: 'HB' }]);
    expect(data.requested.at(-1)).toBe('spell');
    expect(screen.getByText('level unknown', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast Forgotten Word' })).toBeTruthy();
    // Nothing says what level it is, so the slot it spends is on show and theirs to change.
    expect(
      screen.getByRole('button', { name: 'Forgotten Word: casting with Level 1 slot. Change' }),
    ).toBeTruthy();
  });
});

describe('a granted spell on the Play tab', () => {
  const AID = { name: 'Aid', source: 'TST', origin: 'Test feat' };

  it('offers no cast until its file arrives', () => {
    data.spellsHere = false;
    data.packs = packs({ status: 'loading' });
    renderCaster([], [AID]);
    expect(data.requested.at(-1)).toBe('spell');
    expect(screen.getByRole('button', { name: 'Aid' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast Aid' })).toBeNull();
  });

  it('can be cast once it has', () => {
    renderCaster([], [AID]);
    expect(screen.getByRole('button', { name: 'Cast Aid' })).toBeTruthy();
    expect(data.requested.at(-1)).toBeUndefined();
  });
});
