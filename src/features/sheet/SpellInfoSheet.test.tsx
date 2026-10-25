// @vitest-environment jsdom
// PWA-001 (#106): the spell info sheet started the spell download with a bare
// `void` and waited on it with no catch. Without the spell files (offline, or
// a failed download) it said "Loading spell…" for good, with nothing to press.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { computeAccessibleDescription } from 'dom-accessibility-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataStatusStore } from '@/stores/dataStatus';
import { SpellInfoSheet } from './SpellInfoSheet';

// vaul reads this on close and jsdom does not provide it.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

const SPELLS = [
  {
    name: 'Fireball',
    source: 'PHB',
    level: 3,
    school: 'V',
    entries: ['A bright streak flashes from your pointing finger.'],
  },
];

/**
 * What `useTypePacks` reports, and every type it was asked for. Asked for no
 * type, it reports `ready`, as the real hook settles then.
 */
const packs = vi.hoisted(() => ({
  current: { status: 'loading', error: null, offline: false } as {
    status: 'loading' | 'ready' | 'error';
    error: string | null;
    offline: boolean;
  },
  retry: vi.fn(),
  asked: [] as Array<string | undefined>,
}));

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: (type: string | undefined) => {
    packs.asked.push(type);
    const state =
      type === undefined
        ? { status: 'ready' as const, error: null, offline: false }
        : packs.current;
    return { ...state, retry: packs.retry, repair: () => undefined };
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

afterEach(() => {
  cleanup();
  dataStatusStore.setState({ phase: 'idle', error: undefined, failedTag: undefined });
  packs.current = { status: 'loading', error: null, offline: false };
  packs.retry.mockReset();
  packs.asked = [];
});

/** Renders a spell row's trigger and returns a way to press it open. */
function renderRow(name: string, source = 'PHB') {
  render(
    <SpellInfoSheet name={name} source={source} trigger={<button type="button">{name}</button>} />,
  );
  return async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    return waitFor(() => screen.getByRole('dialog'));
  };
}

const OFFLINE = "You're offline, so this spell's description can't be downloaded yet.";

describe('SpellInfoSheet without the spell files', () => {
  it('downloads nothing until the row is pressed', () => {
    renderRow('Fireball');
    expect(packs.asked).toEqual([]);
  });

  it('asks for the spell files from its first render, never for nothing', async () => {
    // Asked for no type while it opens, the hook would report `ready` and the
    // sheet would say there is no rules text before the download started.
    const open = renderRow('Lost Spell', 'XYZ');
    const dialog = await open();
    expect(within(dialog).getByText('Loading spell…')).toBeTruthy();
    expect(packs.asked.length).toBeGreaterThan(0);
    expect(packs.asked.every((type) => type === 'spell')).toBe(true);
  });

  it('says the device is offline inside the sheet, as its alert, with Retry', async () => {
    // The shell's banner alerts the outage, but the open sheet hides it.
    dataStatusStore.setState({ phase: 'error', error: 'Failed to fetch' });
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    const dialog = await renderRow('Lost Spell', 'XYZ')();
    const panel = within(dialog).getByRole('alert');
    expect(panel.textContent).toContain(OFFLINE);
    expect(within(dialog).queryByText('Loading spell…')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(packs.retry).toHaveBeenCalledOnce();
  });

  it('names a failed download online', async () => {
    packs.current = { status: 'error', error: 'HTTP 503', offline: false };
    const dialog = await renderRow('Lost Spell', 'XYZ')();
    expect(within(dialog).getByRole('alert').textContent).toContain(
      "This spell's description couldn't be downloaded: HTTP 503",
    );
  });

  it('says there is no rules text only once the files are in', async () => {
    const open = renderRow('Lost Spell', 'XYZ');
    const dialog = await open();
    expect(within(dialog).queryByText(/Couldn’t find rules text/)).toBeNull();
    cleanup();
    packs.current = { status: 'ready', error: null, offline: false };
    const ready = await renderRow('Lost Spell', 'XYZ')();
    expect(within(ready).getByText('Couldn’t find rules text for “Lost Spell”.')).toBeTruthy();
    expect(within(ready).queryByText('Loading spell…')).toBeNull();
  });

  it('tries the download again when it is opened again after a failure', async () => {
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    const dialog = await renderRow('Lost Spell', 'XYZ')();
    // Opening the first time is the download itself, not a retry.
    expect(packs.retry).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Lost Spell' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(packs.retry).toHaveBeenCalledOnce();
  });

  it('shows a spell it has, whatever the download says', async () => {
    // A homebrew spell, or one from a file that landed before the rest failed.
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    const dialog = await renderRow('Fireball')();
    expect(within(dialog).getByText(/A bright streak/)).toBeTruthy();
    expect(within(dialog).queryByText(OFFLINE)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('is described by the line saying why there is no spell, not by its Retry', async () => {
    packs.current = { status: 'error', error: 'Failed to fetch', offline: true };
    const dialog = await renderRow('Lost Spell', 'XYZ')();
    expect(computeAccessibleDescription(dialog)).toBe(OFFLINE);
  });

  it('is described by its waiting line too', async () => {
    const dialog = await renderRow('Lost Spell', 'XYZ')();
    expect(computeAccessibleDescription(dialog)).toBe('Loading spell…');
  });
});
