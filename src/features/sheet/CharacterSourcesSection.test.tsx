// @vitest-environment jsdom
// GAME-005: the Build page editor for a character's own book list. It writes
// `allowedSources` through the doc updater (so history and undo come free),
// and never touches a pick already on the character.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePolicy } from '@/data5e/sourceFilter';
import { type CharacterDoc, type DerivedSheet, newCharacterDoc } from '@/engine/types';
import { dataStatusStore } from '@/stores/dataStatus';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { CharacterSourcesSection } from './CharacterSourcesSection';

const ON_DEVICE = ['PHB', 'XGE', 'TCE', 'XPHB'];
const world = vi.hoisted(() => ({ extra: [] as string[], brews: [] as string[] }));
vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => ({
    sourceCounts: () => new Map([...ON_DEVICE, ...world.extra].map((s) => [s, 1])),
  }),
}));
// The only live query left unmocked is the homebrew source list.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => new Set(world.brews) }));
const device = vi.hoisted(() => ({ current: { mode: 'all', except: [] } as SourcePolicy }));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/sourceFilter')>()),
  useSourcePolicy: () => device.current,
}));

afterEach(cleanup);
beforeEach(() => {
  device.current = { mode: 'all', except: [] };
  world.extra = [];
  world.brews = [];
  dataStatusStore.getState().setPhase('done');
});

function renderSection(build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  build?.(doc);
  const before = structuredClone(doc);
  const written: CharacterDoc[] = [];
  const update = vi.fn((recipe: (d: CharacterDoc) => void) => {
    const d = structuredClone(doc);
    recipe(d);
    written.push(d);
  });
  const sheet = { resolvedChoices: [] } as unknown as DerivedSheet;
  render(<CharacterSourcesSection doc={doc} sheet={sheet} update={update} />);
  /** What the last write left `allowedSources` as. */
  const lastList = () => written.at(-1)?.allowedSources;
  return { doc, before, update, written, lastList };
}

/** Open the section, the way a tap on its heading does. */
function open() {
  const details = screen.getByText('Sources').closest('details');
  if (details === null) throw new Error('no section');
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

describe('CharacterSourcesSection (GAME-005)', () => {
  it('writes a preset as a list, and No restriction as the empty list', () => {
    const { lastList } = renderSection();
    expect(screen.getByRole('button', { name: 'No restriction', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2014 core only' }));
    expect(lastList()).toEqual(['DMG', 'MM', 'PHB']);
    cleanup();

    const again = renderSection((d) => {
      d.allowedSources = ['MM', 'DMG', 'PHB'];
    });
    expect(screen.getByRole('button', { name: '2014 core only', pressed: true })).toBeTruthy();
    expect(screen.getByText('3 books')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No restriction' }));
    expect(again.lastList()).toEqual([]);
  });

  it('turns unticking one book from no restriction into every other book here', () => {
    const { lastList } = renderSection();
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Xanathar's Guide to Everything/ }));
    expect(lastList()).toEqual(['PHB', 'TCE', 'XPHB']);
  });

  it('keeps a listed book this device lacks, labelled, never dropped', () => {
    const { lastList } = renderSection((d) => {
      d.allowedSources = ['PHB', 'FriendsBrew'];
    });
    open();
    expect(namelessControls()).toEqual([]);
    const row = screen.getByRole('checkbox', { name: /FriendsBrew/ });
    expect((row as HTMLInputElement).checked).toBe(true);
    expect(row.closest('label')?.textContent).toContain('Not on this device');
    fireEvent.click(screen.getByRole('checkbox', { name: /Tasha's Cauldron/ }));
    expect(lastList()).toEqual(['FriendsBrew', 'PHB', 'TCE']);
  });

  it("copies this device's settings, spelling out a block list", () => {
    device.current = { mode: 'all', except: ['TCE'] };
    const { lastList } = renderSection();
    open();
    fireEvent.click(screen.getByRole('button', { name: "Copy this device's settings" }));
    expect(lastList()).toEqual(['PHB', 'XGE', 'XPHB']);
  });

  it('copies an allow-list device setting as it is, and never an empty one', () => {
    device.current = { mode: 'only', sources: ['XPHB', 'PHB'] };
    const { lastList } = renderSection();
    open();
    fireEvent.click(screen.getByRole('button', { name: "Copy this device's settings" }));
    expect(lastList()).toEqual(['PHB', 'XPHB']);
    cleanup();

    // A device that shows nothing would copy as an empty list, which on a
    // character means the opposite: no restriction. So there is nothing to copy.
    device.current = { mode: 'only', sources: [] };
    const again = renderSection((d) => {
      d.allowedSources = ['PHB'];
    });
    open();
    const copy = screen.getByRole('button', { name: "Copy this device's settings" });
    expect(copy.hasAttribute('disabled')).toBe(true);
    fireEvent.click(copy);
    expect(again.update).not.toHaveBeenCalled();
  });

  it('keeps the last book on a list ticked, and says why', () => {
    renderSection((d) => {
      d.allowedSources = ['XGE'];
    });
    open();
    const last = screen.getByRole('checkbox', { name: /Xanathar's Guide to Everything/ });
    expect(last.hasAttribute('disabled')).toBe(true);
    const hint = document.getElementById(last.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('A list needs at least one book');
    // Any other book can still be ticked.
    const other = screen.getByRole('checkbox', { name: /Tasha's Cauldron/ });
    expect(other.hasAttribute('disabled')).toBe(false);
  });

  it('warns that a list written out mid-download can miss books', () => {
    dataStatusStore.getState().setPhase('working');
    renderSection();
    open();
    expect(screen.getByText(/Game data is still downloading/)).toBeTruthy();
    cleanup();

    dataStatusStore.getState().setPhase('done');
    renderSection();
    open();
    expect(screen.queryByText(/Game data is still downloading/)).toBeNull();
  });

  it('gives homebrew books their own heading', () => {
    world.extra = ['MyBrew'];
    world.brews = ['MyBrew'];
    renderSection();
    open();
    const heading = screen.getByText('Homebrew');
    const group = heading.closest('details');
    expect(group?.textContent).toContain('MyBrew');
    // Not also filed under "everything else", where unknown codes would go.
    expect(screen.queryByText('Everything else')).toBeNull();
  });

  it('names picks from books outside the list, and leaves them alone', () => {
    const { doc, before, update } = renderSection((d) => {
      d.allowedSources = ['PHB'];
      d.classes = [
        {
          ref: { name: 'Cleric', source: 'PHB' },
          subclass: { name: 'Twilight Domain', source: 'TCE' },
          levels: 1,
          hp: ['avg'],
        },
      ];
    });
    expect(screen.getByText(/Twilight Domain \(Tasha's Cauldron of Everything\)/)).toBeTruthy();
    expect(screen.getByText(/These stay/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(doc).toEqual(before);
  });
});
