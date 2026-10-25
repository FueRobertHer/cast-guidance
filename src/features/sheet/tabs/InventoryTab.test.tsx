// @vitest-environment jsdom
// A phone reported item search as broken. Magic items come from the items-full
// pack, which the background drain fetches after essentials, so the picker can
// open before they exist. It rendered an empty list with no explanation, which
// is indistinguishable from a broken feature.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';

const registryRef: { current: { byType: (t: string) => Entity[] } | null } = { current: null };
const ensureTypePacks = vi.fn(async (_type: string) => undefined);

vi.mock('@/data5e/hooks', () => ({ useRegistry: () => registryRef.current }));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: (t: string) => ensureTypePacks(t) }));

// vaul renders through a portal with animation; a pass-through keeps the test
// about the drawer's own states rather than the library's.
vi.mock('vaul', async () => {
  const { useEffect, useRef } = await import('react');
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Drawer: {
      Root: ({
        children,
        onOpenChange,
      }: {
        children?: React.ReactNode;
        onOpenChange?: (open: boolean) => void;
      }) => {
        // Exactly one open transition, which is what real vaul does. A per-render
        // call would re-run the component's open handler after every state change
        // that handler causes, undoing it. `onOpenChange` is an inline arrow, so
        // a dependency array cannot express "once" here.
        const opened = useRef(false);
        useEffect(() => {
          if (opened.current) return;
          opened.current = true;
          onOpenChange?.(true);
        });
        return <div>{children}</div>;
      },
      Trigger: Pass,
      Portal: Pass,
      Overlay: Pass,
      Content: Pass,
      Title: Pass,
      Close: Pass,
    },
  };
});

const { AddItemDrawer, Component: InventoryTab } = await import('./InventoryTab');

const items = (...names: string[]): Entity[] =>
  names.map((name) => ({ name, source: 'PHB' }) as Entity);

function renderTab(pool: Entity[] | null) {
  registryRef.current = pool === null ? null : { byType: (t) => (t === 'baseitem' ? pool : []) };
  render(<AddItemDrawer onAdd={() => undefined} />);
}

const search = () => screen.getByPlaceholderText('Search items…');

beforeEach(() => {
  ensureTypePacks.mockClear();
  ensureTypePacks.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('AddItemDrawer while the item compendium is still arriving', () => {
  it('says it is downloading rather than showing an empty list', () => {
    renderTab([]);
    fireEvent.change(search(), { target: { value: 'sword' } });

    expect(screen.getByText(/Downloading the item compendium/)).toBeTruthy();
    // The custom-item escape hatch is the point of mentioning it.
    expect(screen.getByPlaceholderText('Or add a custom item…')).toBeTruthy();
  });

  it('treats a registry that has not loaded at all the same way', () => {
    renderTab(null);
    expect(screen.getByText(/Downloading the item compendium/)).toBeTruthy();
  });

  it('does not claim to be downloading once the load has finished empty', async () => {
    // A pack that resolves but yields no items (renamed data files in a future
    // tag, say) must not sit on a download message forever.
    renderTab([]);
    expect(await screen.findByText(/loaded, but it contains no items/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('offers a retry when the download fails', async () => {
    ensureTypePacks.mockRejectedValueOnce(new Error('offline'));
    renderTab([]);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText(/Could not download the item compendium/)).toBeTruthy();
    ensureTypePacks.mockClear();
    fireEvent.click(retry);
    expect(ensureTypePacks).toHaveBeenCalledExactlyOnceWith('item');
  });
});

describe('AddItemDrawer once items are queryable', () => {
  it('prompts for a query instead of sitting blank', () => {
    renderTab(items('Longsword', 'Shortsword'));
    expect(screen.getByText('Type at least two letters to search 2 items.')).toBeTruthy();
    // One letter is below the search threshold, so the prompt stands.
    fireEvent.change(search(), { target: { value: 's' } });
    expect(screen.getByText('Type at least two letters to search 2 items.')).toBeTruthy();
  });

  it('lists matches', () => {
    renderTab(items('Longsword', 'Shortsword', 'Shield'));
    fireEvent.change(search(), { target: { value: 'sword' } });

    expect(screen.getByRole('button', { name: /Longsword/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Shortsword/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Shield/ })).toBeNull();
    expect(screen.queryByText(/Downloading/)).toBeNull();
  });

  it('distinguishes "no match" from "not downloaded yet"', () => {
    renderTab(items('Longsword'));
    fireEvent.change(search(), { target: { value: 'banjo' } });

    expect(screen.getByText('No items match “banjo”.')).toBeTruthy();
    expect(screen.queryByText(/Downloading/)).toBeNull();
  });
});

// A11Y-001: each row's attune, quantity and remove controls were bare glyphs
// or an icon named by a tooltip, and the equip and attune toggles had no state.
describe('InventoryTab rows', () => {
  /** The tab over a doc holding an equipped Longsword and a carried Rope. */
  function renderRows() {
    // No registry: every entry stays plain text, which is all these rows need.
    registryRef.current = null;
    const doc = newCharacterDoc('i1', 'Hero', 't');
    doc.equipment = [
      { id: 'a', custom: { name: 'Longsword' }, qty: 1, equipped: true, attuned: false },
      { id: 'b', custom: { name: 'Rope' }, qty: 2, equipped: false, attuned: false },
    ];
    let current = doc;
    const update = (recipe: (d: CharacterDoc) => void) => {
      const d = structuredClone(current);
      recipe(d);
      current = d;
      view.rerender(<RouterProvider router={router()} />);
    };
    const router = () =>
      createMemoryRouter([
        {
          path: '/',
          element: (
            <Outlet
              context={
                {
                  doc: current,
                  sheet: deriveSheet(current, makeTestContext()),
                  update,
                } as unknown as CharacterSheetState
              }
            />
          ),
          children: [{ index: true, element: <InventoryTab /> }],
        },
      ]);
    const view = render(<RouterProvider router={router()} />);
  }

  it('names every control, after the item it acts on', () => {
    renderRows();
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Increase Rope quantity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Longsword' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search items' })).toBeTruthy();
  });

  it('reports equipped and attuned as pressed states', () => {
    renderRows();
    expect(screen.getByRole('button', { name: 'Equip Longsword', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Equip Rope', pressed: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Attune Longsword', pressed: false }));
    expect(screen.getByRole('button', { name: 'Attune Longsword', pressed: true })).toBeTruthy();
  });
});
