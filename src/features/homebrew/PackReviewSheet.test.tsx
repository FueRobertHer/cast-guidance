// @vitest-environment jsdom
// Rule packs on the Homebrew page (Packs board, A): the review before a pack
// goes on (H8), its Apply to, the Rule pack tag and what it holds, the banner
// where two packs disagree and the order that settles it, and a download that
// leaves who it applies to behind. Real repositories over fake-indexeddb, the
// real page and the real preview; the registry is a stand-in.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { downloaded } = vi.hoisted(() => ({ downloaded: [] as unknown[] }));

vi.mock('@/data5e/sourceFilter', () => ({ ensureSourcesVisible: () => Promise.resolve() }));
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry } = await import('@/data5e/normalize');
  return { invalidateRegistry: () => undefined, getRegistry: async () => new EntityRegistry() };
});
vi.mock('@/lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/download')>()),
  downloadJson: (_: string, data: unknown) => downloaded.push(data),
}));

import { PACK_LOCAL_KEY, packLocal } from '@/data5e/rulePack';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { resetAnnouncer } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import grittyTable from '../../../tests-fixtures/packs/gritty-table.json';
import { Component as ManageHomebrewPage } from './ManageHomebrewPage';
import { clashLines, savePackLocal } from './PackReviewSheet';

beforeAll(() => {
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

function renderPage() {
  render(
    <MemoryRouter>
      <ManageHomebrewPage />
    </MemoryRouter>,
  );
}

function chooseFile(name: string, content: unknown) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([JSON.stringify(content)], name, { type: 'application/json' })] },
  });
}

const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: 5000 });

/** The stored pack named `full`, with who it applies to here. */
async function storedPack(full: string) {
  const { files } = await homebrewRepo.listSafe();
  const file = files.find(
    (f) => (f.json._meta as { sources: Array<{ full?: string }> }).sources[0]?.full === full,
  );
  return { file, local: file === undefined ? undefined : packLocal(file.json, file.id) };
}

async function addThroughPage(name: string, json: unknown, title: string) {
  chooseFile(name, json);
  const dialog = await findDialog(title);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('adding a rule pack', () => {
  it('reviews what it holds, applies it to every character, and tags it on the page', async () => {
    renderPage();
    chooseFile('gritty-table.json', grittyTable);
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
    expect(await screen.findByText('Rule pack')).toBeTruthy();
    expect(screen.getByText('3 rules, 2 changed entries, 1 moment, 1 cue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable Gritty Table', pressed: true })).toBeTruthy();
  });

  it('applies it to the characters chosen, and to nobody until one is', async () => {
    const hild = newCharacterDoc('hild', 'Hild', 'tag');
    await characterRepo.put(hild);
    renderPage();
    chooseFile('gritty-table.json', grittyTable);
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
  });

  it('brings back the characters chosen after Every character was picked', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderPage();
    chooseFile('gritty-table.json', grittyTable);
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
    renderPage();
    const tooBig = structuredClone(grittyTable) as Json;
    (tooBig._meta as { castGuidance: Json }).castGuidance.cues = Array(201).fill({
      at: 'zeroHp',
      text: 'Again',
    });
    chooseFile('too-big.json', tooBig);
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

describe('packs on the Homebrew page', () => {
  it('says where two packs disagree, and the order settles which wins', async () => {
    renderPage();
    await addThroughPage('gritty-table.json', grittyTable, 'Add Gritty Table?');
    chooseFile('heroic.json', heroic());
    const dialog = await findDialog('Add Heroic Table?');
    expect(dialog.textContent).toContain(
      'Sets rest length, which Gritty Table also sets. Heroic Table would win, as it goes last in your pack order.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add and turn on' }));

    expect(
      await screen.findByText(
        'Gritty Table and Heroic Table both set rest length. Heroic Table wins: it comes later in your pack order.',
      ),
    ).toBeTruthy();
    // Both set critical hits the same way, so that is no clash.
    expect(document.body.textContent).not.toContain('both set critical hits');

    fireEvent.click(screen.getByRole('button', { name: 'Change the order' }));
    const order = await findDialog('Pack order');
    fireEvent.click(within(order).getByRole('button', { name: 'Move Heroic Table up' }));
    fireEvent.click(within(order).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Heroic Table and Gritty Table both set rest length. Gritty Table wins: it comes later in your pack order.',
      ),
    ).toBeTruthy();
    expect((await storedPack('Heroic Table')).local?.order).toBe(0);
    expect((await storedPack('Gritty Table')).local?.order).toBe(1);
  });

  it('reviews a pack from its card, saves a new Apply to on Done, and turns it off', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderPage();
    await addThroughPage('gritty-table.json', grittyTable, 'Add Gritty Table?');

    fireEvent.click(await screen.findByRole('button', { name: 'Review Gritty Table' }));
    let sheet = await findDialog('Gritty Table');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Hild' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(async () =>
      expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review Gritty Table' }));
    sheet = await findDialog('Gritty Table');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn off' }));
    await waitFor(async () => expect((await storedPack('Gritty Table')).file?.enabled).toBe(false));
    expect((await storedPack('Gritty Table')).local?.appliesTo).toEqual({ characters: ['hild'] });
  });

  it('leaves a newer Apply to alone when a sheet open before it closes unchanged', async () => {
    await characterRepo.put(newCharacterDoc('hild', 'Hild', 'tag'));
    renderPage();
    await addThroughPage('gritty-table.json', grittyTable, 'Add Gritty Table?');
    fireEvent.click(await screen.findByRole('button', { name: 'Review Gritty Table' }));
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
    renderPage();
    await addThroughPage('gritty-table.json', grittyTable, 'Add Gritty Table?');
    // Read once, as it lands.
    expect(await screen.findByText('Rule pack')).toBeTruthy();
    const reads = vi.spyOn(homebrewRepo, 'getSafe');
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Enable Gritty Table' }));
      await waitFor(async () =>
        expect((await storedPack('Gritty Table')).file?.enabled).toBe(false),
      );
      expect(
        await screen.findByRole('button', { name: 'Enable Gritty Table', pressed: false }),
      ).toBeTruthy();
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  });

  it('downloads a pack without who it applies to here', async () => {
    renderPage();
    await addThroughPage('gritty-table.json', grittyTable, 'Add Gritty Table?');
    fireEvent.click(await screen.findByRole('button', { name: 'Download Gritty Table' }));
    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect((downloaded[0] as { _meta: Json })._meta).not.toHaveProperty(PACK_LOCAL_KEY);
    expect(downloaded[0]).toEqual(grittyTable);
  });

  it('links your own brew to the Workshop', async () => {
    await homebrewRepo.createEditable('My Brew', 'MB');
    renderPage();
    expect(
      (await screen.findByRole('link', { name: 'Open in the Workshop' })).getAttribute('href'),
    ).toBe('/workshop');
  });
});
