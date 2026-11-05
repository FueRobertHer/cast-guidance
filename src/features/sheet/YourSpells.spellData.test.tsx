// @vitest-environment jsdom
// A spell's file says its level, and its level says what casting it spends and
// where its row goes. Until the file is here a row offers no way to cast, as on
// Play, and one panel says why.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypePacksState } from '@/data5e/hooks';
import { deriveSheet } from '@/engine/derive';
import { type EntityRef, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { YourSpells } from './YourSpells';

const data = vi.hoisted(() => ({
  /** Whether the spell files have reached the registry. */
  spellsHere: true,
  refreshing: false,
  requested: [] as Array<string | undefined>,
  packs: {} as unknown,
}));

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

function renderCaster(known: EntityRef[]) {
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
  const router = createMemoryRouter([
    { path: '/', element: <YourSpells doc={doc} sheet={sheet} update={() => undefined} /> },
  ]);
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  data.spellsHere = true;
  data.refreshing = false;
  data.requested = [];
  data.packs = packs();
});

afterEach(cleanup);

describe('a known spell on the Spells tab', () => {
  it('reads as what it is once its file has arrived, asking for nothing', () => {
    renderCaster([GUIDANCE]);
    expect(screen.getByRole('heading', { name: 'Cantrips' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast Guidance' })).toBeTruthy();
    expect(data.requested.at(-1)).toBeUndefined();
  });

  it('asks for the spell files and offers no cast until they arrive', () => {
    data.spellsHere = false;
    data.packs = packs({ status: 'loading' });
    renderCaster([GUIDANCE]);
    expect(data.requested.at(-1)).toBe('spell');
    expect(screen.getByRole('heading', { name: 'Waiting for spell details' })).toBeTruthy();
    // The name still opens the rules sheet, which reports on the file.
    expect(screen.getByRole('button', { name: 'Guidance' })).toBeTruthy();
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
    expect(screen.getByText("The spell list couldn't be downloaded: HTTP 503")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.retry).toHaveBeenCalledOnce();
  });

  it('leaves a spell no file holds to the player, under its own heading', () => {
    renderCaster([{ name: 'Forgotten Word', source: 'HB' }]);
    expect(data.requested.at(-1)).toBe('spell');
    expect(screen.getByRole('heading', { name: 'Level unknown' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast Forgotten Word' })).toBeTruthy();
  });
});
