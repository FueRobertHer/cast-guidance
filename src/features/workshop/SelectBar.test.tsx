// @vitest-environment jsdom
// Select mode on the Workshop's Yours shelf (ADR-002 board 9, phase U8), over
// the app's routes: delete then Undo puts each entry back on every sheet that
// had it; a move keeps it on every sheet and says what it could not reach; an
// export is a file anyone can import.
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { engineContextFor } from '@/data5e/engineAdapter';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { COLLECTION_ID_KEY } from '@/db/homebrewOrder';
import { homebrewRepo } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc } from '@/engine/types';
import { downloadJson } from '@/lib/download';
import { resetAnnouncer } from '@/stores/announcer';
import {
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
  sorcerer,
} from '../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);
vi.mock('@/lib/download', () => ({
  downloadJson: vi.fn(),
  downloadBlob: vi.fn(),
  jsonFilename: (n: string) => `${n}.json`,
}));

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

beforeEach(resetAnnouncer);
afterEach(resetSheetHarness);
afterEach(() => vi.mocked(downloadJson).mockClear());

const WAIT = 30_000;
type Row = Record<string, unknown>;

async function visit() {
  window.matchMedia ??= (query: string) =>
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
  const router = createMemoryRouter(routes, { initialEntries: ['/workshop'] });
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1 }, { timeout: WAIT });
}

/** A feat the sheet counts (10 ft of speed), and a spell. */
const gift = (source: string) => ({
  name: 'Gift',
  source,
  entries: ['A gift.'],
  castGuidance: { v: 1, effects: [{ kind: 'speedBonus', amount: 10 }] },
});
const bolt = (source: string) => ({
  name: 'Glimmer Bolt',
  source,
  level: 1,
  school: 'V',
  entries: ['Zap.'],
});

/** A collection of the player's holding `extra`. */
async function collection(name: string, source: string, extra: Row): Promise<string> {
  const row = await homebrewRepo.createEditable(name, source);
  await homebrewRepo.saveEditable(row.id, { ...(row.json as Row), ...extra });
  return row.id;
}

const content = async (id: string) => (await db.homebrewJson.get(id))?.json as Row;

/** Sparks, holding Gift and knowing Glimmer Bolt from Lantern Coast. */
async function sparks(): Promise<CharacterDoc> {
  const doc = sorcerer();
  doc.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'gift' }];
  const own = doc.spellcasting['sorcerer|tst'];
  doc.spellcasting = {
    'sorcerer|tst': {
      ...own,
      known: [...(own?.known ?? []), { name: 'Glimmer Bolt', source: 'HB' }],
    },
  };
  await characterRepo.put(doc);
  return doc;
}

const sheetOf = async (doc: CharacterDoc) => {
  invalidateRegistry();
  return deriveSheet(doc, engineContextFor(await getRegistry()));
};

/** The world, Lantern Coast (Gift, Glimmer Bolt and a lamp) and Tidewater (a rope). */
async function world() {
  await seedWorld();
  const lantern = await collection('Lantern Coast', 'HB', {
    feat: [gift('HB')],
    spell: [bolt('HB')],
    item: [{ name: 'Lamp', source: 'HB', type: 'G', entries: ['Bright.'] }],
  });
  const tide = await collection('Tidewater', 'TW', {
    item: [{ name: 'Rope', source: 'TW', type: 'G', entries: ['Long.'] }],
  });
  return { lantern, tide };
}

/** A row's checkbox in select mode, by its name and, when two share it, its collection. */
function row(name: string, inside?: string): HTMLElement {
  const all = screen.getAllByRole('checkbox', { name: new RegExp(`^${name}\\s*,`) });
  const one = all.filter(
    (b) => inside === undefined || b.closest('label')?.textContent?.includes(inside),
  );
  expect(one).toHaveLength(1);
  return one[0] as HTMLElement;
}

async function selectMode() {
  fireEvent.click(await screen.findByRole('button', { name: 'Select' }, { timeout: WAIT }));
  return screen.findByRole('group', { name: 'With what is selected' }, { timeout: WAIT });
}

describe('select mode on Yours', () => {
  it('picks rows, selects all of a kind, and Escape gives the keyboard back to Select', async () => {
    await world();
    await visit();
    const bar = await selectMode();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Stop selecting');
    expect(screen.getByText('Select entries')).toBeTruthy();
    for (const b of within(bar).getAllByRole('button')) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
    }
    // Search and the shelves give way while selecting.
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(row('Gift'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    // Items only: Select all picks the two items, and the feat out of sight is let go.
    fireEvent.click(screen.getByRole('button', { name: /^Items/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByText('Select entries')).toBeTruthy();

    fireEvent.keyDown(row('Lamp'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: /selected/ })).toBeNull());
    expect(document.activeElement?.textContent).toBe('Select');
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('deletes, naming who uses them, and Undo puts each back on every sheet that had it', async () => {
    const { lantern } = await world();
    const doc = await sparks();
    const before = {
      file: await content(lantern),
      row: await db.characters.get(doc.id),
      sheet: await sheetOf(doc),
    };
    await visit();
    await selectMode();
    fireEvent.click(row('Gift'));
    fireEvent.click(row('Glimmer Bolt'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Delete 2 entries?' },
      { timeout: WAIT },
    );
    expect(within(sheet).getByText(/They leave Lantern Coast/)).toBeTruthy();
    await within(sheet).findByText('Sparks', {}, { timeout: WAIT });
    expect(within(sheet).getByText('Gift leaves the sheet.')).toBeTruthy();
    expect(within(sheet).getByText('Glimmer Bolt leaves the sheet.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete 2 entries' }));

    const undo = await screen.findByRole(
      'button',
      { name: 'Undo: Deleted 2 entries' },
      { timeout: WAIT },
    );
    await waitFor(() => expect(document.activeElement).toBe(undo));
    await waitFor(() => expect(screen.queryByRole('link', { name: /^Gift\s*,/ })).toBeNull());
    expect(screen.getByRole('link', { name: /^Lamp\s*,/ })).toBeTruthy();
    const gone = await content(lantern);
    expect(gone.feat).toEqual([]);
    expect(gone.spell).toEqual([]);
    // The character is left as it was; its sheet loses what they gave.
    expect(await db.characters.get(doc.id)).toEqual(before.row);
    const without = await sheetOf(doc);
    expect(without.speedWalk.value).toBe(before.sheet.speedWalk.value - 10);
    expect(without).not.toEqual(before.sheet);

    fireEvent.click(undo);
    await waitFor(async () => expect(await content(lantern)).toEqual(before.file), {
      timeout: WAIT,
    });
    expect(
      await screen.findByText(/Undone: Deleted 2 entries/, {}, { timeout: WAIT }),
    ).toBeTruthy();
    expect(await db.characters.get(doc.id)).toEqual(before.row);
    expect(await sheetOf(doc)).toEqual(before.sheet);
    await screen.findByRole('link', { name: /^Gift\s*,/ }, { timeout: WAIT });
  });

  it('moves, the characters following, and lists the packs and rows it could not reach', async () => {
    const { tide } = await world();
    const doc = await sparks();
    const before = await sheetOf(doc);
    const pack = await homebrewRepo.importJson(
      {
        _meta: {
          sources: [{ json: 'GT', full: 'Gritty Table' }],
          castGuidance: {
            v: 1,
            patches: [{ target: 'Gift|HB', add: [{ kind: 'acBonus', amount: 1 }] }],
          },
        },
      },
      'gritty.json',
    );
    const newer = { ...sorcerer(), id: 'later', schemaVersion: 999 };
    await db.characters.put({ ...newer, revision: 'r0' });
    await visit();
    await selectMode();
    fireEvent.click(row('Gift'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Tidewater/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move here' }));

    const report = await screen.findByRole('dialog', { name: 'Moved' }, { timeout: WAIT });
    expect(
      within(report).getByText('Moved 1 entry to Tidewater. 1 character followed them.'),
    ).toBeTruthy();
    expect(within(report).getByText('Gritty Table')).toBeTruthy();
    expect(within(report).getByText('gritty.json. Names Gift|HB')).toBeTruthy();
    expect(within(report).getByText(/1 character could not be read/)).toBeTruthy();
    fireEvent.click(within(report).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(document.querySelector('[data-import-status]')?.textContent).toBe(
        'Moved 1 entry to Tidewater. 1 character followed them.',
      ),
    );
    expect((await content(tide)).feat).toEqual([gift('TW')]);
    const moved = (await characterRepo.get(doc.id)) as CharacterDoc;
    expect(moved.feats[0]?.ref).toEqual({ name: 'Gift', source: 'TW' });
    expect((await sheetOf(moved)).speedWalk.value).toBe(before.speedWalk.value);
    // The unreadable row and the imported pack are left as they were.
    expect(await db.characters.get('later')).toEqual({ ...newer, revision: 'r0' });
    expect(pack.id).toBeTruthy();
  });

  it('starts a collection only when the move is made, and a refused move moves nothing', async () => {
    const { lantern, tide } = await world();
    // Tidewater has a Gift of its own, so Lantern Coast's cannot go there.
    await homebrewRepo.saveEntry('feat', gift('TW'), { fileId: tide });
    const files = async () => (await homebrewRepo.ownedSafe()).files.length;
    const count = await files();
    await visit();
    await selectMode();
    fireEvent.click(row('Glimmer Bolt'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    let sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Start a new collection/ }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name of the new collection' }), {
      target: { value: 'Sea Shanties' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await files()).toBe(count);

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Start a new collection/ }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name of the new collection' }), {
      target: { value: 'Sea Shanties' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make and move' }));
    await waitFor(
      () =>
        expect(document.querySelector('[data-import-status]')?.textContent).toBe(
          'Made Sea Shanties and moved 1 entry.',
        ),
      { timeout: WAIT },
    );
    const made = (await homebrewRepo.ownedSafe()).files.find(
      (f) => f.sourceIds[0] === 'SeaShanties',
    );
    expect(made?.json.spell).toEqual([bolt('SeaShanties')]);

    const kept = await content(lantern);
    await selectMode();
    fireEvent.click(row('Gift', 'Lantern Coast'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Tidewater/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move here' }));
    expect((await within(sheet).findByRole('alert', {}, { timeout: WAIT })).textContent).toMatch(
      /^Gift from Lantern Coast did not move: .*already has one called Gift/,
    );
    expect(await content(lantern)).toEqual(kept);
  });

  it('exports a file anyone can import, without changes to the books or the collection’s id', async () => {
    const { lantern } = await world();
    await homebrewRepo.saveEntry('spell', bolt('PHB'), { role: 'changes' });
    await visit();
    await selectMode();
    fireEvent.click(row('Gift'));
    fireEvent.click(row('Glimmer Bolt', 'Changes to the books'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(document.querySelector('[data-import-status]')?.textContent).toBe(
        'Saved a file with 1 entry. Anyone can import it in their Workshop. A change to the books is not in it.',
      ),
    );
    const [name, json] = vi.mocked(downloadJson).mock.calls[0] as [string, Row];
    expect(name).toBe('Gift');
    expect(json.feat).toEqual([gift('HB')]);
    expect(json.spell).toBeUndefined();
    const meta = json._meta as { sources: Row[] };
    expect(meta.sources.map((s) => s.json)).toEqual(['HB']);
    expect(Object.hasOwn(meta, COLLECTION_ID_KEY)).toBe(false);
    expect(Object.hasOwn((await content(lantern))._meta as Row, COLLECTION_ID_KEY)).toBe(true);
    const prepared = await homebrewRepo.prepare(json, 'gift.json');
    expect(prepared.counts).toMatchObject({ feat: 1 });
    await act(async () => undefined);
  });
});
