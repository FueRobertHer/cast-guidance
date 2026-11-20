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
import { repointDoc } from '@/db/repoint';
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
import { whoUses } from './SelectBar';
import type { Mine } from './yours';

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
      prepared: own?.prepared ?? [],
      known: [...(own?.known ?? []), { name: 'Glimmer Bolt', source: 'HB' }],
    },
  };
  await characterRepo.put(doc);
  return doc;
}

const sheetOf = async (doc: CharacterDoc) => {
  invalidateRegistry();
  return sheetNow(doc);
};
/** The sheet from the registry as the app left it: its own writes must refresh it. */
const sheetNow = async (doc: CharacterDoc) =>
  deriveSheet(doc, engineContextFor(await getRegistry()));

/** A character row from a newer app: listed as unreadable, never written. */
async function newerRow(): Promise<CharacterDoc & { revision: string }> {
  const row = { ...sorcerer(), id: 'later', schemaVersion: 999, revision: 'r0' };
  await db.characters.put(row);
  return row;
}

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
    // Items only: the feat out of sight is not picked, so nothing hidden is acted on.
    fireEvent.click(screen.getByRole('button', { name: /^Items/ }));
    expect(screen.getByText('Select entries')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByText('Select entries')).toBeTruthy();
    // Select all and none reach the rows on show only: the hidden feat stays picked.
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect((row('Gift') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Items/ }));

    fireEvent.keyDown(row('Lamp'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: /selected/ })).toBeNull());
    expect(document.activeElement?.textContent).toBe('Select');
    expect(screen.getByRole('searchbox')).toBeTruthy();

    // Escape from the bar at the foot does the same.
    const again = await selectMode();
    fireEvent.keyDown(within(again).getByRole('button', { name: 'Move' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: /selected/ })).toBeNull());
    expect(document.activeElement?.textContent).toBe('Select');
  });

  it('deletes, naming who uses them, and Undo puts each back on every sheet that had it', async () => {
    const { lantern } = await world();
    const doc = await sparks();
    const newer = await newerRow();
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
    expect(
      within(sheet).getByText(/1 character could not be read, so it was not checked/),
    ).toBeTruthy();
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
    const without = await sheetNow(doc);
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
    expect(await db.characters.get('later')).toEqual(newer);
    expect(await sheetNow(doc)).toEqual(before.sheet);
    await screen.findByRole('link', { name: /^Gift\s*,/ }, { timeout: WAIT });

    // "Undone" stays until the next change to that collection.
    await homebrewRepo.saveEntry(
      'item',
      { name: 'Wick', source: 'HB', type: 'G' },
      {
        fileId: lantern,
      },
    );
    await waitFor(() => expect(screen.queryByText(/Undone: Deleted 2 entries/)).toBeNull(), {
      timeout: WAIT,
    });
  });

  it('drops the Undo offer once the collection changes again, and says when no check could be made', async () => {
    const { lantern } = await world();
    await visit();
    await selectMode();
    fireEvent.click(row('Lamp'));
    const list = vi.spyOn(characterRepo, 'listSafe').mockRejectedValue(new Error('locked'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete 1 entry?' }, { timeout: WAIT });
    expect(
      await within(sheet).findByText(
        'Your characters could not be checked for them.',
        {},
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    expect(within(sheet).queryByText('No character uses them.')).toBeNull();
    list.mockRestore();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete 1 entry' }));
    await screen.findByRole('button', { name: 'Undo: Deleted 1 entry' }, { timeout: WAIT });

    await homebrewRepo.saveEntry(
      'item',
      { name: 'Wick', source: 'HB', type: 'G' },
      {
        fileId: lantern,
      },
    );
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /^Undo: Deleted/ })).toBeNull(),
      { timeout: WAIT },
    );
    const items = (await content(lantern)).item as Row[];
    expect(items.map((i) => i.name)).toEqual(['Wick']);
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
    const packBefore = await content(pack.id);
    const newer = await newerRow();
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
    expect((await sheetNow(moved)).speedWalk.value).toBe(before.speedWalk.value);
    // The unreadable row and the imported pack are left as they were.
    expect(await db.characters.get('later')).toEqual(newer);
    expect(await content(pack.id)).toEqual(packBefore);
  });

  it('moves from three collections, two refused, and reports each that did not move', async () => {
    const { lantern, tide } = await world();
    // Harbor has a Gift and a Rope of its own, so those cannot go there; a Shell can.
    // Two refusals, so whichever comes first, one stopping the rest shows.
    await collection('Harbor', 'HR', {
      feat: [gift('HR')],
      item: [{ name: 'Rope', source: 'HR', type: 'G', entries: ['Short.'] }],
    });
    const reef = await collection('Reef', 'RF', {
      item: [{ name: 'Shell', source: 'RF', type: 'G', entries: ['Pink.'] }],
    });
    const kept = { lantern: await content(lantern), tide: await content(tide) };
    await visit();
    await selectMode();
    fireEvent.click(row('Gift', 'Lantern Coast'));
    fireEvent.click(row('Rope', 'Tidewater'));
    fireEvent.click(row('Shell'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const sheet = await screen.findByRole('dialog', { name: 'Move 3 entries' }, { timeout: WAIT });
    // The one collection none of them is in comes picked.
    const choice = within(sheet).getByRole('radio', { name: /^Harbor/ }) as HTMLInputElement;
    expect(choice.checked).toBe(true);
    expect(within(sheet).queryByText(/already/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Reef/ }));
    expect(within(sheet).getByText('1 of them is in Reef already and stays there.')).toBeTruthy();
    fireEvent.click(choice);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move here' }));
    const report = await screen.findByRole('dialog', { name: 'Moved' }, { timeout: WAIT });
    expect(within(report).getByText('Moved 1 entry to Harbor.')).toBeTruthy();
    expect(
      within(report).getByText(
        /^Gift from Lantern Coast did not move: .*already has one called Gift/,
      ),
    ).toBeTruthy();
    expect(
      within(report).getByText(/^Rope from Tidewater did not move: .*already has one called Rope/),
    ).toBeTruthy();
    fireEvent.click(within(report).getByRole('button', { name: 'Done' }));
    expect(await content(lantern)).toEqual(kept.lantern);
    expect(await content(tide)).toEqual(kept.tide);
    expect((await content(reef)).item).toEqual([]);
    const harbor = (await homebrewRepo.ownedSafe()).files.find((f) => f.sourceIds[0] === 'HR');
    expect((harbor?.json.item as Row[]).map((i) => `${i.name}|${i.source}`)).toEqual([
      'Rope|HR',
      'Shell|HR',
    ]);
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

    // A move refused into a collection started for it takes the collection away again.
    await selectMode();
    fireEvent.click(row('Lamp'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Start a new collection/ }));
    await homebrewRepo.removeEntry(lantern, 'item', { name: 'Lamp', source: 'HB' });
    const before = await files();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make and move' }));
    expect((await within(sheet).findByRole('alert', {}, { timeout: WAIT })).textContent).toMatch(
      /^Lamp from Lantern Coast did not move/,
    );
    expect(await files()).toBe(before);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Stop selecting' }));

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

    // Changes to the books alone save nothing and keep the selection to try again.
    await selectMode();
    fireEvent.click(row('Glimmer Bolt', 'Changes to the books'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(document.querySelector('[data-import-status]')?.textContent).toBe(
      'Changes to the books are shared as a rule pack, not as a file of entries.',
    );
    expect(screen.getByRole('group', { name: 'With what is selected' })).toBeTruthy();
    expect(vi.mocked(downloadJson)).toHaveBeenCalledTimes(1);

    // And Move has nothing to move: it says so and opens no sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(document.querySelector('[data-import-status]')?.textContent).toBe(
      'Changes to the books stay where they are: a change keeps the book’s name and source.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('group', { name: 'With what is selected' })).toBeTruthy();
    await act(async () => undefined);
  });

  it('moves to a collection none of them is in, else names those there already', async () => {
    await world();
    await visit();
    await selectMode();
    fireEvent.click(row('Lamp'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    let sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    const tide = within(sheet).getByRole('radio', { name: /^Tidewater/ }) as HTMLInputElement;
    expect(tide.checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // From both collections there are, one of them comes picked, and the sheet says what stays.
    fireEvent.click(row('Rope'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    sheet = await screen.findByRole('dialog', { name: 'Move 2 entries' }, { timeout: WAIT });
    const on = within(sheet)
      .getAllByRole('radio')
      .find((r) => (r as HTMLInputElement).checked);
    const place = on?.closest('label')?.textContent ?? '';
    const home = place.startsWith('Tidewater') ? 'Tidewater' : 'Lantern Coast';
    expect(place.startsWith(home)).toBe(true);
    expect(
      within(sheet).getByText(`1 of them is in ${home} already and stays there.`),
    ).toBeTruthy();
    const go = within(sheet).getByRole('button', { name: 'Move here' });
    expect(go.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await act(async () => undefined);
  });

  it('keeps an open sheet when another tab empties the list, then ends select mode', async () => {
    await seedWorld();
    const solo = await collection('Solo', 'SO', {
      item: [{ name: 'Lamp', source: 'SO', type: 'G', entries: ['Bright.'] }],
    });
    await visit();
    await selectMode();
    fireEvent.click(row('Lamp'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const sheet = await screen.findByRole('dialog', { name: 'Move 1 entry' }, { timeout: WAIT });
    // Their only collection is not offered as the place to go.
    const fresh = within(sheet).getByRole('radio', { name: /^Start a new collection/ });
    expect((fresh as HTMLInputElement).checked).toBe(true);
    await homebrewRepo.removeEntry(solo, 'item', { name: 'Lamp', source: 'SO' });
    await waitFor(
      () => expect(screen.queryAllByRole('checkbox', { name: /^Lamp/, hidden: true })).toEqual([]),
      { timeout: WAIT },
    );
    expect(screen.getByRole('dialog', { name: 'Move 1 entry' })).toBe(sheet);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make and move' }));
    expect((await within(sheet).findByRole('alert', {}, { timeout: WAIT })).textContent).toMatch(
      /^Lamp from Solo did not move/,
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'With what is selected' })).toBeNull(),
    );
    // A new entry later lists as a link, not a row to pick.
    await homebrewRepo.saveEntry(
      'item',
      { name: 'Wick', source: 'SO', type: 'G' },
      { fileId: solo },
    );
    await screen.findByRole('link', { name: /^Wick\s*,/ }, { timeout: WAIT });
    expect(screen.queryByRole('group', { name: 'With what is selected' })).toBeNull();
  });

  it('says Undone only once the entries are back, and nothing when the Undo fails', async () => {
    const { lantern } = await world();
    await visit();
    await selectMode();
    fireEvent.click(row('Lamp'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete 1 entry?' }, { timeout: WAIT });
    await within(sheet).findByText('No character uses them.', {}, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete 1 entry' }));
    const undo = await screen.findByRole(
      'button',
      { name: 'Undo: Deleted 1 entry' },
      { timeout: WAIT },
    );
    const restore = vi
      .spyOn(homebrewRepo, 'restoreEntries')
      .mockRejectedValue(new Error('changed meanwhile'));
    fireEvent.click(undo);
    expect(screen.queryByText(/Undone/)).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo: / })).toBeNull(), {
      timeout: WAIT,
    });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Undone/)).toBeNull();
    expect((await content(lantern)).item).toEqual([]);
    restore.mockRestore();
  });
});

describe('who uses an entry being deleted', () => {
  const names = new Map([
    ['lantern', 'Lantern Coast'],
    ['tide', 'Tidewater'],
  ]);
  const pick = (type: string, entry: Row, fileId = 'lantern', change = false) => ({
    type,
    entry,
    fileId,
    change,
  });
  const lines = (doc: CharacterDoc, picked: Array<Mine & { change: boolean }>) =>
    whoUses([doc], picked, names, repointDoc).flatMap((u) => u.lines.map((l) => l.text));

  it('counts an optional feature by its own picks, not a same-named feat’s', () => {
    const doc = sorcerer();
    doc.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'gift' }];
    doc.choices = { 'feat:gift|hb:skill:0': 'arcana' };
    const option = pick('optionalfeature', { name: 'Gift', source: 'HB' });
    expect(lines(doc, [option])).toEqual([]);
    expect(lines(doc, [pick('feat', gift('HB'))])).toEqual(['Gift leaves the sheet.']);
    doc.choices = { 'class:sorcerer|tst:optfeature:metamagic:0': 'gift|hb' };
    expect(lines(doc, [option])).toEqual(['Gift leaves the sheet.']);
  });

  it('counts a subrace or subclass under its own parent only', () => {
    const doc = sorcerer();
    doc.race = { name: 'Dwarf', source: 'HB' };
    doc.subrace = { name: 'Hill', source: 'HB' };
    const hill = (raceName: string) =>
      pick('subrace', { name: 'Hill', source: 'HB', raceName, raceSource: 'HB' }, 'lantern', true);
    expect(lines(doc, [hill('Gnome')])).toEqual([]);
    expect(lines(doc, [hill('Dwarf')])).toEqual(['Hill goes back to the book’s.']);

    const [level] = doc.classes;
    if (level === undefined) throw new Error('no class');
    level.subclass = { name: 'Storm', source: 'HB' };
    const storm = (className: string) =>
      pick('subclass', { name: 'Storm', source: 'HB', className, classSource: 'TST' });
    expect(lines(doc, [storm('Wizard')])).toEqual([]);
    expect(lines(doc, [storm('Sorcerer')])).toEqual(['Storm leaves the sheet.']);
  });

  it('tells two of one name apart by kind and collection', () => {
    const doc = sorcerer();
    doc.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'gift' }];
    doc.equipment = [
      { id: 'g', ref: { name: 'Gift', source: 'TW' }, qty: 1, equipped: false, attuned: false },
    ];
    const [user] = whoUses(
      [doc],
      [pick('feat', gift('HB')), pick('item', { name: 'Gift', source: 'TW' }, 'tide')],
      names,
      repointDoc,
    );
    expect(user?.lines.map((l) => l.text)).toEqual([
      'Gift (feat, Lantern Coast) leaves the sheet.',
      'Gift (item, Tidewater) leaves the sheet.',
    ]);
    expect(new Set(user?.lines.map((l) => l.key)).size).toBe(2);
  });
});
