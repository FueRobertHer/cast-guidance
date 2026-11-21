// @vitest-environment jsdom
// Rule packs in the Workshop (board 10, B): a pack brought in through the
// Rules page's Import sheet and its review before it goes on (H8), its Apply
// to, its row on the Rules page with who it reaches, the order sheet where
// two packs disagree and the order that settles it, the review from its row,
// and an export from its file's page that leaves who it applies to behind.
// Real repositories over fake-indexeddb, the real pages, sheet and preview;
// the registry is a stand-in.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { downloaded } = vi.hoisted(() => ({ downloaded: [] as unknown[] }));

vi.mock('@/data5e/sourceFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/sourceFilter')>()),
  ensureSourcesVisible: () => Promise.resolve(),
}));
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry } = await import('@/data5e/normalize');
  const registry = async () => new EntityRegistry();
  return {
    invalidateRegistry: () => undefined,
    getRegistry: registry,
    // What the registry hook (`hooks.ts`) reads besides, for the table rules.
    ensureRegistry: registry,
    holdRegistryRefreshing: () => () => undefined,
    isRegistryRefreshing: () => false,
    subscribeRegistryRefreshing: () => () => undefined,
    registrySignature: () => '',
  };
});
vi.mock('@/lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/download')>()),
  downloadJson: (_: string, data: unknown) => downloaded.push(data),
}));

import { PACK_LOCAL_KEY } from '@/data5e/rulePack';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { Component as CollectionPage } from '@/features/workshop/CollectionPage';
import { Component as RulesPage } from '@/features/workshop/RulesPage';
import { resetAnnouncer } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import grittyTable from '../../../tests-fixtures/packs/gritty-table.json';
import { clashLines, savePackLocal } from './PackReviewSheet';

beforeAll(async () => {
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
  // The Rules page loads its Import sheet when it opens: loaded once here, so
  // no case waits on the first load.
  await import('@/features/workshop/ImportSheet');
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  dataStatusStore.getState().setPhase('done');
  resetAnnouncer();
  downloaded.length = 0;
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

type Json = Record<string, unknown>;

const heroic = (): Json => ({
  _meta: {
    sources: [{ json: 'HeroicTable', full: 'Heroic Table' }],
    castGuidance: { v: 1, tableRules: { restLength: 'heroic', critDamage: 'maxPlusRoll' } },
  },
});

/** The Rules page, and the file pages a pack's review links to. */
function renderRules() {
  const router = createMemoryRouter(
    [
      { path: '/workshop/rules', element: <RulesPage /> },
      { path: '/workshop/collection/:id', element: <CollectionPage /> },
    ],
    { initialEntries: ['/workshop/rules'] },
  );
  render(<RouterProvider router={router} />);
}

const WAIT = 5000;
const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: WAIT });
/** A pack's row on the Rules page, by its name and who it reaches. */
const findRow = (name: string) => screen.findByRole('button', { name }, { timeout: WAIT });
/** The packs' rows on the Rules page, in the order shown. */
const rowsShown = () =>
  within(within(screen.getByRole('region', { name: 'Rule packs' })).getByRole('list'))
    .getAllByRole('button')
    .map((b) => b.textContent);

/** Bring `content` in as a file through the Rules page's Import sheet, and read it. */
async function bringIn(name: string, content: unknown) {
  fireEvent.click(await screen.findByRole('button', { name: 'Import a rule pack' }));
  const sheet = await findDialog('Import');
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([JSON.stringify(content)], name, { type: 'application/json' })] },
  });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Read it' }));
}

/** The stored pack named `full`, with who it applies to here, from its row. */
async function storedPack(full: string) {
  const { files } = await homebrewRepo.listSafe();
  const file = files.find(
    (f) => (f.json._meta as { sources: Array<{ full?: string }> }).sources[0]?.full === full,
  );
  return { file, local: file?.pack };
}

async function addThroughRules(name: string, json: unknown, title: string) {
  await bringIn(name, json);
  const dialog = await findDialog(title);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
}

describe('adding a rule pack', () => {
  it('reviews what it holds, applies it to every character, and lists it on the Rules page', async () => {
    renderRules();
    await bringIn('gritty-table.json', grittyTable);
    const dialog = await findDialog('Add Gritty Table?');
    expect(dialog.textContent).toContain('Rules and changes only. A pack cannot run code.');
    const text = dialog.textContent ?? '';
    expect(text).toContain('Rest lengthShort 8 hours, long 7 days');
    expect(text).toContain('HP on a long restHalf your maximum');
    expect(text).toContain('Critical hitsMax the dice, then roll them');
    expect(text).toContain('Alert (PHB)Works by 1 effect in place of its own');
    expect(text).toContain('Grit (Warrior)Gains 1 effect');
    expect(text).toContain('At 0 HPGain a level of Exhaustion');
    expect(text).toContain('After a long restSays "A long rest needs a safe haven."');
    expect(
      within(dialog).getByRole('button', { name: 'Every character', pressed: true }),
    ).toBeTruthy();
    expect(await db.homebrewFiles.count()).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({
        characters: [],
        appDefault: true,
      }),
    );
    // Its row says it is on, and for whom.
    expect(await findRow('Gritty Table, On for every character')).toBeTruthy();
  });

  it('applies it to the characters chosen, and to nobody until one is', async () => {
    const hild = newCharacterDoc('hild', 'Hild', 'tag');
    await characterRepo.put(hild);
    renderRules();
    await bringIn('gritty-table.json', grittyTable);
    const dialog = await findDialog('Add Gritty Table?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose' }));
    const add = within(dialog).getByRole('button', { name: 'Add and turn on' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Hild', pressed: false }));
    expect(add.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(add);
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] }),
    );
    expect(await findRow('Gritty Table, On for Hild')).toBeTruthy();
  });

  it('brings back the characters chosen after Every character was picked', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderRules();
    await bringIn('gritty-table.json', grittyTable);
    const dialog = await findDialog('Add Gritty Table?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Hild', pressed: false }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Every character' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(within(dialog).getByRole('button', { name: 'Hild', pressed: true })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] }),
    );
  });

  it('refuses a pack past a limit, says why, and offers only Cancel', async () => {
    renderRules();
    const tooBig = structuredClone(grittyTable) as Json;
    (tooBig._meta as { castGuidance: Json }).castGuidance.cues = Array(201).fill({
      at: 'zeroHp',
      text: 'Again',
    });
    await bringIn('too-big.json', tooBig);
    const dialog = await findDialog('Add Gritty Table?');
    expect(within(dialog).getByRole('heading', { name: 'Cannot be added' })).toBeTruthy();
    expect(dialog.textContent).toContain('it has 201 cues; a pack has at most 200.');
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancel']);
  });
});

describe('clash lines', () => {
  it('says a clash once where two packs share a name', () => {
    const rest = (restLength: string) => ({ v: 1, tableRules: { restLength } });
    const gritty = (id: string, character: string) => ({
      id,
      name: 'Gritty Table',
      guidance: rest('gritty'),
      appliesTo: { characters: [character] },
    });
    const everyone = {
      id: 'e',
      name: 'Everyone',
      guidance: rest('heroic'),
      appliesTo: { characters: [], appDefault: true as const },
    };
    expect(clashLines([gritty('g1', 'hild'), gritty('g2', 'bram'), everyone], 'e', false)).toEqual([
      'Gritty Table and Everyone both set rest length. Gritty Table wins: it is applied to those characters, over every character.',
    ]);
  });
});

describe('packs in the Workshop', () => {
  it('says where two packs disagree, and the order settles which wins', async () => {
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    await bringIn('heroic.json', heroic());
    const dialog = await findDialog('Add Heroic Table?');
    expect(dialog.textContent).toContain(
      'Sets rest length, which Gritty Table also sets. Heroic Table would win, as it goes last in your pack order.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });

    fireEvent.click(await screen.findByRole('button', { name: 'Order' }, { timeout: WAIT }));
    let order = await findDialog('Pack order');
    // Each pack that is on says what it holds.
    expect(within(order).getByText('3 rules, 2 changed entries, 1 moment, 1 cue')).toBeTruthy();
    expect(
      within(order).getByText(
        'Gritty Table and Heroic Table both set rest length. Heroic Table wins: it comes later in your pack order.',
      ),
    ).toBeTruthy();
    // Both set critical hits the same way, so that is no clash.
    expect(order.textContent).not.toContain('both set critical hits');

    fireEvent.click(within(order).getByRole('button', { name: 'Move Heroic Table up' }));
    // The line answers the move before it is saved.
    expect(
      within(order).getByText(
        'Heroic Table and Gritty Table both set rest length. Gritty Table wins: it comes later in your pack order.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(order).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      expect((await storedPack('Heroic Table')).local?.order).toBe(0);
      expect((await storedPack('Gritty Table')).local?.order).toBe(1);
    });

    // The page lists them in the order saved, and the sheet opens on it.
    await waitFor(() =>
      expect(rowsShown()).toEqual([
        'Heroic Table, On for every character',
        'Gritty Table, On for every character',
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Order' }));
    order = await findDialog('Pack order');
    expect(
      within(order).getByText(
        'Heroic Table and Gritty Table both set rest length. Gritty Table wins: it comes later in your pack order.',
      ),
    ).toBeTruthy();
  });

  it('reviews a pack from its row, saves a new Apply to on Done, and turns it off', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');

    fireEvent.click(await findRow('Gritty Table, On for every character'));
    let sheet = await findDialog('Gritty Table');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Hild' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] }),
    );

    fireEvent.click(await findRow('Gritty Table, On for Hild'));
    sheet = await findDialog('Gritty Table');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn off' }));
    await waitFor(async () => expect((await storedPack('Gritty Table')).file?.enabled).toBe(false));
    expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] });
    expect(await findRow('Gritty Table, Off')).toBeTruthy();
  });

  it('updates a pack imported again, keeping who it applies to without asking', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    const { file: first } = await storedPack('Gritty Table');
    if (first === undefined) throw new Error('not stored');
    await savePackLocal(first.id, (local) => ({ ...local, appliesTo: { characters: ['hild'] } }));

    const changed = structuredClone(grittyTable) as { _meta: { castGuidance: Json } };
    changed._meta.castGuidance.tableRules = { restLength: 'heroic' };
    await bringIn('gritty-table.json', changed);
    const dialog = await findDialog('Update Gritty Table?');
    expect(dialog.textContent).toContain('Updates a collection here');
    expect(dialog.textContent).toContain('and who it applies to');
    expect(within(dialog).queryByRole('button', { name: 'Every character' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });

    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.json, f.addedAt, f.pack])).toEqual([
      [changed, first.addedAt, { appliesTo: { characters: ['hild'] } }],
    ]);
  });

  it('says an update wins a clash by the place it keeps, not by going last', async () => {
    renderRules();
    await addThroughRules('heroic.json', heroic(), 'Add Heroic Table?');
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    const changed = structuredClone(grittyTable) as { _meta: { castGuidance: Json } };
    changed._meta.castGuidance.cues = [{ at: 'longRest', text: 'Rest somewhere safe.' }];
    await bringIn('gritty-table.json', changed);
    const dialog = await findDialog('Update Gritty Table?');
    expect(dialog.textContent).toContain(
      'Sets rest length, which Heroic Table also sets. Gritty Table would win, as it comes later in your pack order.',
    );
  });

  it('applies an update to nobody when the pack it kept the Apply to of is gone first', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    const { file: first } = await storedPack('Gritty Table');
    if (first === undefined) throw new Error('not stored');
    await savePackLocal(first.id, (local) => ({ ...local, appliesTo: { characters: ['hild'] } }));

    const changed = structuredClone(grittyTable) as { _meta: { castGuidance: Json } };
    changed._meta.castGuidance.tableRules = { restLength: 'heroic' };
    await bringIn('gritty-table.json', changed);
    const dialog = await findDialog('Update Gritty Table?');
    // Deleted from another tab while the dialog asks nothing of its own.
    await homebrewRepo.delete(first.id);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });

    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.pack)).toEqual([{ appliesTo: { characters: [] } }]);
  });

  it('leaves a newer Apply to alone when a sheet open before it closes unchanged', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    fireEvent.click(await findRow('Gritty Table, On for every character'));
    const sheet = await findDialog('Gritty Table');
    const { file } = await storedPack('Gritty Table');
    if (file === undefined) throw new Error('not stored');
    // Saved elsewhere (another tab) while the sheet is open.
    await savePackLocal(file.id, (local) => ({ ...local, appliesTo: { characters: ['hild'] } }));
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).file?.rev).toBeGreaterThan(file.rev ?? 0),
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] });
  });

  it('reads a pack again only when it is saved, not when it is switched', async () => {
    renderRules();
    await addThroughRules('gritty-table.json', grittyTable, 'Add Gritty Table?');
    // Read once, as it lands.
    const row = await findRow('Gritty Table, On for every character');
    const reads = vi.spyOn(homebrewRepo, 'getSafe');
    try {
      fireEvent.click(row);
      const sheet = await findDialog('Gritty Table');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Turn off' }));
      await waitFor(async () =>
        expect((await storedPack('Gritty Table')).file?.enabled).toBe(false),
      );
      expect(await findRow('Gritty Table, Off')).toBeTruthy();
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  });

  it("exports a pack from its file's page without who it applies to", async () => {
    renderRules();
    // A file that came with an Apply to in it, kept there as packs once were.
    const carried = structuredClone(grittyTable) as { _meta: Json };
    carried._meta[PACK_LOCAL_KEY] = { file: 'elsewhere', appliesTo: { characters: ['bram'] } };
    await addThroughRules('gritty-table.json', carried, 'Add Gritty Table?');
    // Stored as it came, with who it applies to here on its row.
    const { file, local } = await storedPack('Gritty Table');
    expect(file?.json).toEqual(carried);
    expect(local?.appliesTo).toEqual({ characters: [], appDefault: true });

    fireEvent.click(await findRow('Gritty Table, On for every character'));
    const review = await findDialog('Gritty Table');
    fireEvent.click(within(review).getByRole('link', { name: 'Export, update or delete it' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Export a file' }, { timeout: WAIT }),
    );
    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect((downloaded[0] as { _meta: Json })._meta).not.toHaveProperty(PACK_LOCAL_KEY);
    expect(downloaded[0]).toEqual(grittyTable);
  });
});
