// @vitest-environment jsdom
// PWA-001 (#106): the spell list started its spell download with a bare
// `void`, once per casting class, and read the class spell index with no
// catch. Without the spell files (offline, or a failed download) the list was
// short with no reason given, the rejections went to the console as uncaught
// errors, and a failed index read left "Loading spell list…" up for good.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpellClassLookup } from '@/data5e/spellLookup';
import { type DerivedSheet, newCharacterDoc, type SpellcastingBlock } from '@/engine/types';
import { dataStatusStore } from '@/stores/dataStatus';
import { SpellManager } from './SpellManager';

/** One spell from the index, and one homebrew spell that names its class inline. */
const SPELLS = [
  { name: 'Shield', source: 'PHB', level: 1 },
  {
    name: 'Brew Bolt',
    source: 'HB',
    level: 1,
    classes: { fromClassList: [{ name: 'Wizard', source: 'PHB' }] },
  },
];

/** What `useTypePacks` reports, and every type it was asked for. */
const packs = vi.hoisted(() => ({
  current: { status: 'ready', error: null, offline: false } as {
    status: 'loading' | 'ready' | 'error';
    error: string | null;
    offline: boolean;
  },
  retry: vi.fn(),
  asked: [] as Array<string | undefined>,
}));

/** The class spell index read: replaced per test. */
const lookup = vi.hoisted(() => ({
  read: vi.fn<() => Promise<SpellClassLookup>>(),
}));

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: (type: string | undefined) => {
    packs.asked.push(type);
    return { ...packs.current, retry: packs.retry, repair: () => undefined };
  },
  useRegistry: () => ({
    get: (_type: string, name: string, source?: string) =>
      SPELLS.find(
        (s) =>
          s.name.toLowerCase() === name.toLowerCase() &&
          (source === undefined || s.source.toLowerCase() === source.toLowerCase()),
      ),
    byType: () => SPELLS,
  }),
}));
vi.mock('@/data5e/spellLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: lookup.read,
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/sourceFilter')>();
  return { ...real, useSourcePolicy: () => real.ALLOW_ALL };
});

afterEach(() => {
  cleanup();
  dataStatusStore.setState({ phase: 'idle', error: undefined, failedTag: undefined });
  packs.current = { status: 'ready', error: null, offline: false };
  packs.retry.mockReset();
  packs.asked = [];
  lookup.read.mockReset();
});

const ON_WIZARD_LIST: SpellClassLookup = { phb: { shield: { class: { PHB: { Wizard: true } } } } };

const block = (className: string, ability: 'int' | 'wis') =>
  ({
    classUid: `${className.toLowerCase()}|phb`,
    className,
    ability,
    mode: 'prepared',
    saveDc: { value: 13 },
    attackMod: { value: 5 },
    slots: [2],
  }) as SpellcastingBlock;

/** A Wizard and Cleric multiclass by default: two casting blocks, one page. */
function renderSpells(
  blocks: SpellcastingBlock[] = [block('Wizard', 'int'), block('Cleric', 'wis')],
) {
  const doc = newCharacterDoc('c1', 'Caster', 't');
  const sheet = {
    spellcasting: blocks,
    grantedSpells: [],
    totalLevel: 2,
    resources: [],
  } as unknown as DerivedSheet;
  const update = vi.fn();
  // A fresh element each time: React skips re-rendering an identical one.
  const ui = () => (
    <MemoryRouter>
      <SpellManager doc={doc} sheet={sheet} update={update} />
    </MemoryRouter>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}

/** The panel around a line of its words. */
function panelSaying(text: string | RegExp): HTMLElement {
  const panel = screen.getByText(text).parentElement;
  if (panel === null) throw new Error(`no panel saying ${String(text)}`);
  return panel;
}

const OFFLINE = "You're offline, so the spell list can't be downloaded yet.";

describe('SpellManager without the spell files', () => {
  it('says the device is offline once for every casting class, with Retry', async () => {
    lookup.read.mockResolvedValue(ON_WIZARD_LIST);
    // The shell's data banner is alerting the stopped download, as it does offline.
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderSpells();
    await waitFor(() => expect(screen.queryByText('Loading spell list…')).toBeNull());
    expect(screen.getAllByText(OFFLINE)).toHaveLength(1);
    // Both classes are still on the page, over what is already downloaded.
    expect(screen.getByRole('heading', { name: /Wizard spells/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Cleric spells/ })).toBeTruthy();
    // The banner is the alert offline (A11Y-002).
    const panel = panelSaying(OFFLINE);
    expect(panel.getAttribute('role')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(packs.retry).toHaveBeenCalledOnce();
  });

  it('names a failed download online, as the one alert', async () => {
    lookup.read.mockResolvedValue(ON_WIZARD_LIST);
    packs.current = { status: 'error', error: 'HTTP 503', offline: false };
    renderSpells();
    const panel = panelSaying("The spell list couldn't be downloaded: HTTP 503");
    expect(panel.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(screen.getByText('Shield')).toBeTruthy());
  });

  it('tries the spell download again by itself once back online', async () => {
    lookup.read.mockResolvedValue(ON_WIZARD_LIST);
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderSpells();
    await waitFor(() => expect(screen.getByText('Shield')).toBeTruthy());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(packs.retry).toHaveBeenCalledOnce();
  });

  it('downloads nothing for a character with no spellcasting', () => {
    renderSpells([]);
    expect(screen.getByText('This character has no spellcasting.')).toBeTruthy();
    expect(packs.asked.length).toBeGreaterThan(0);
    expect(packs.asked.every((type) => type === undefined)).toBe(true);
    expect(lookup.read).not.toHaveBeenCalled();
  });

  it('asks for the spell files, and only by type', async () => {
    lookup.read.mockResolvedValue(ON_WIZARD_LIST);
    renderSpells();
    await waitFor(() => expect(screen.getByText('Shield')).toBeTruthy());
    expect(packs.asked.every((type) => type === 'spell')).toBe(true);
    // One read of the index for both classes.
    expect(lookup.read).toHaveBeenCalledOnce();
  });

  it('does not wait on the index while the spell files are failing', () => {
    // Still being read (a cold network), with the download already failed:
    // the panel says why the list is short, and nothing claims to be loading.
    lookup.read.mockReturnValue(new Promise(() => undefined));
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderSpells();
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.queryByText('Loading spell list…')).toBeNull();
  });

  it('catches an index read that fails along with the download, and says it once', async () => {
    lookup.read.mockRejectedValue(new Error('Failed to fetch'));
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    renderSpells();
    // The homebrew spell is still offered, from its own class list.
    await waitFor(() => expect(screen.getByText('Brew Bolt')).toBeTruthy());
    expect(screen.queryByText('Loading spell list…')).toBeNull();
    // One panel for the outage: the spell list's Retry reads the index again too.
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(screen.queryByText(/class spell lists/)).toBeNull();
  });

  it('reads the index again when a retried download succeeds', async () => {
    lookup.read.mockRejectedValueOnce(new Error('Failed to fetch'));
    lookup.read.mockResolvedValue(ON_WIZARD_LIST);
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    const { rerender } = renderSpells();
    await waitFor(() => expect(screen.getByText('Brew Bolt')).toBeTruthy());
    expect(screen.queryByText('Shield')).toBeNull();
    packs.current = { status: 'ready', error: null, offline: false };
    rerender();
    await waitFor(() => expect(screen.getByText('Shield')).toBeTruthy());
    expect(screen.queryByText(/couldn't be downloaded/)).toBeNull();
  });

  it('says why an index read failed with the spell files in hand, and retries it', async () => {
    lookup.read.mockRejectedValueOnce(new Error('UnknownError'));
    let answer: (value: SpellClassLookup) => void = () => undefined;
    lookup.read.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderSpells();
    const panel = await waitFor(() =>
      panelSaying("The class spell lists couldn't be downloaded: UnknownError"),
    );
    // Nothing else says this one, so it is the alert.
    expect(panel.getAttribute('role')).toBe('alert');
    expect(screen.queryByText('Loading spell list…')).toBeNull();
    expect(screen.getByText('Brew Bolt')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    // Read again, it waits as a retried download does, not under the old failure.
    await waitFor(() => expect(screen.queryByText(/couldn't be downloaded/)).toBeNull());
    expect(screen.getAllByText('Loading spell list…')).toHaveLength(2);
    act(() => answer(ON_WIZARD_LIST));
    await waitFor(() => expect(screen.getByText('Shield')).toBeTruthy());
    expect(packs.retry).not.toHaveBeenCalled();
  });
});
