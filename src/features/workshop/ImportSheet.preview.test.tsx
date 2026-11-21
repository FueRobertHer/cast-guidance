// @vitest-environment jsdom
// IMP-002 and TEST-003, on the Workshop's Import sheet: importing homebrew
// shows what the file would do before anything is written, and Import or
// Cancel decide. Real repositories over fake-indexeddb, the real sheet and the
// real preview; only the registry is a small stand-in, built from the
// official entries below plus every enabled file merged by the real
// `mergeHomebrew`, so "who wins" is what the app would actually resolve.
//
// An outcome the sheet hands back (imported, kept, canceled) is its `onDone`
// message, which the home shows and says (see WorkshopHome.test.tsx). A read
// that ends with nothing to preview stays in the sheet's own line, which the
// announcer must have said.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureSourcesVisible, invalidateRegistry, registry } = vi.hoisted(() => ({
  ensureSourcesVisible: vi.fn(() => Promise.resolve()),
  invalidateRegistry: vi.fn(),
  /**
   * `gates` holds back the next reads, in call order (a slow read during a
   * first download); `fail` makes a read throw (no game data readable).
   */
  registry: { calls: 0, gates: [] as Promise<void>[], fail: false },
}));

vi.mock('@/data5e/sourceFilter', () => ({ ensureSourcesVisible }));
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry, mergeHomebrew } = await import('@/data5e/normalize');
  const { homebrewRepo } = await import('@/db/homebrewRepo');
  return {
    invalidateRegistry,
    /** Official Fire Bolt, then every enabled file in the real merge order. */
    getRegistry: async () => {
      registry.calls += 1;
      const gate = registry.gates.shift();
      if (gate !== undefined) await gate;
      if (registry.fail) throw new Error('no game data');
      const reg = new EntityRegistry();
      reg.addAll('spell', [{ name: 'Fire Bolt', source: 'PHB', level: 0 }]);
      const brews = new Map<string, Record<string, unknown>>();
      for (const f of (await homebrewRepo.enabledSafe()).files) brews.set(f.id, f.json);
      mergeHomebrew(reg, brews);
      return reg;
    },
  };
});

import { FC5_CONVERTER_VERSION } from '@/convert/fc5/compendium';
import { getRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { buildHomebrewRow, homebrewRepo, putHomebrewRow } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import { noticeStore } from '@/stores/notices';
import { recordAnnouncer } from '../../../tests-fixtures/announcements';
import { InlineImportWorker } from '../../../tests-fixtures/importWorker';
import ImportSheet from './ImportSheet';

/** Everything the announcer says in a test; see `said`. */
let heard = recordAnnouncer();
beforeEach(() => {
  heard.stop();
  resetAnnouncer();
  heard = recordAnnouncer();
});
afterEach(() => {
  heard.stop();
  resetAnnouncer();
});

// jsdom has no matchMedia and the sheet asks for one on mount, and no Worker
// for the XML converter.
beforeAll(() => {
  vi.stubGlobal('Worker', InlineImportWorker);
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
  ensureSourcesVisible.mockClear();
  invalidateRegistry.mockClear();
  Object.assign(registry, { calls: 0, gates: [], fail: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Json = Record<string, unknown>;

function brew(source: string, spells: Json[], meta: Json = {}): Json {
  return { _meta: { sources: [{ json: source, full: `${source} Book` }], ...meta }, spell: spells };
}

const ZAP_1 = brew('HB', [{ name: 'Zap', source: 'HB', level: 1 }]);

/** What the sheet handed back when it closed with an outcome. */
let done: { message: string; landed: boolean }[] = [];

/** The sheet as the Workshop home opens it, at `?import`. */
function renderSheet() {
  done = [];
  const router = createMemoryRouter(
    [
      {
        path: '/workshop',
        element: (
          <ImportSheet
            onClose={() => undefined}
            onDone={(message, landed) => done.push({ message, landed })}
          />
        ),
      },
    ],
    { initialEntries: ['/workshop?import='] },
  );
  render(<RouterProvider router={router} />);
}

/** Reads hash the file and build a registry: slow when the machine is busy. */
const WAIT = 5000;
const sheet = () => screen.findByRole('dialog', { name: 'Import' }, { timeout: WAIT });
const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: WAIT });
const fileCount = () => db.homebrewFiles.count();

/** Choose a file in the sheet and press Read it (unless `press` is false), as a person would. Returns Read it. */
async function readFile(name: string, content: unknown, press = true): Promise<HTMLElement> {
  const s = await sheet();
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const input = s.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  });
  const readIt = within(s).getByRole('button', { name: 'Read it' });
  if (press) fireEvent.click(readIt);
  return readIt;
}

/** Every promise step queued now, and the ones they queue: what a let-go read does next. */
async function settle() {
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
}

/** Bring in a link, on A link, and press Read it. */
async function readLink(url: string) {
  const s = await sheet();
  fireEvent.click(within(s).getByRole('button', { name: 'A link' }));
  fireEvent.change(within(s).getByRole('textbox', { name: 'Link to a JSON homebrew file' }), {
    target: { value: url },
  });
  fireEvent.click(within(s).getByRole('button', { name: 'Read it' }));
}

/** The sheet's own messages, under Read it: a plain visual (A11Y-002). */
function importLine(): HTMLElement {
  const line = document.querySelector<HTMLElement>('[data-import-status]');
  if (line === null) throw new Error('no import line');
  return line;
}

/**
 * The message on the sheet's line, which the announcer must have said too, as
 * the latest thing it said: the line is no live region, so a message shown
 * and never heard would otherwise pass.
 */
function said(): string {
  const message = importLine().querySelector('p')?.textContent;
  if (message === undefined) throw new Error('no message on the line yet');
  expect(heard.lines.at(-1)).toBe(message);
  return message;
}

/** The outcome the sheet handed back, once it has. */
async function handedBack(): Promise<{ message: string; landed: boolean }> {
  await waitFor(() => expect(done).toHaveLength(1), { timeout: WAIT });
  const [out] = done;
  if (out === undefined) throw new Error('no outcome');
  return out;
}

/** No preview is up: the one dialog on screen is the sheet itself. */
function onlyTheSheet() {
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Import' })).toBeTruthy();
}

/** Hold the next registry read until `release` is called. */
function holdRegistry(): () => void {
  let release: () => void = () => undefined;
  registry.gates.push(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => release();
}

describe('the Import sheet preview', () => {
  it('shows what the file holds before writing anything, and Import stores it', async () => {
    renderSheet();
    await readFile(
      'brew.json',
      brew('HB', [
        { name: 'Zap', source: 'HB', level: 1 },
        { name: 'Fire Bolt', source: 'PHB', level: 3 },
      ]),
    );

    const dialog = await findDialog('Import "brew.json"?');
    // Focus moved into the preview.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(dialog.textContent).toContain('2 spell');
    expect(dialog.textContent).toMatch(/Size\d+ bytes \(the limit is \d+\.\d MB\)/);
    expect(dialog.textContent).toContain('HB Book (HB)');
    // An official clash names the side a character gets.
    expect(within(dialog).getByRole('heading', { name: 'Clashes' })).toBeTruthy();
    expect(dialog.textContent).toContain(
      'Fire Bolt (PHB) is also official content. Official wins, so a character that picks it gets the official version.',
    );
    expect(dialog.textContent).toContain('Official content wins over homebrew');
    expect(await fileCount()).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await handedBack()).toEqual({
      message: 'Imported "brew.json" (2 spell)',
      landed: true,
    });
    expect(await fileCount()).toBe(1);
    expect(ensureSourcesVisible).toHaveBeenCalledWith(['HB']);
    expect(invalidateRegistry).toHaveBeenCalled();
  });

  it('still uses a stored file when showing its sources fails', async () => {
    ensureSourcesVisible.mockImplementationOnce(() => Promise.reject(new Error('quota')));
    renderSheet();
    await readFile('brew.json', ZAP_1);
    const dialog = await findDialog('Import "brew.json"?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await handedBack()).toEqual({
      message: 'Imported "brew.json" (1 spell)',
      landed: true,
    });
    expect(await fileCount()).toBe(1);
    expect(invalidateRegistry).toHaveBeenCalled();
    expect(noticeStore.getState().notice?.title).toBe('Show sources failed');
  });

  it('writes nothing on Cancel, and shows no sources', async () => {
    renderSheet();
    await readFile('brew.json', ZAP_1);
    const dialog = await findDialog('Import "brew.json"?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await handedBack()).toEqual({
      message: 'Import canceled. Nothing was added.',
      landed: false,
    });
    expect(screen.queryByRole('dialog', { name: 'Import "brew.json"?' })).toBeNull();
    expect(await fileCount()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(ensureSourcesVisible).not.toHaveBeenCalled();
    expect(invalidateRegistry).not.toHaveBeenCalled();
  });

  it('offers to keep a file that is already here, and changes nothing', async () => {
    const existing = await homebrewRepo.importJson(ZAP_1, 'zap.json');
    await homebrewRepo.setEnabled(existing.id, false);
    renderSheet();
    await readFile('zap-again.json', ZAP_1);

    const dialog = await findDialog('"zap-again.json" is already here');
    expect(within(dialog).getByRole('heading', { name: 'Already on this device' })).toBeTruthy();
    expect(dialog.textContent).toContain(
      `Already imported on ${new Date(existing.addedAt).toLocaleDateString()}.`,
    );
    // The files here are under Collections in the Workshop.
    expect(dialog.textContent).toContain('Turned off. It is under Collections.');
    // One answer: there is nothing to import.
    expect(within(dialog).queryByRole('button', { name: 'Import' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the existing file' }));

    expect(await handedBack()).toEqual({
      message: 'Kept the existing "zap.json". Nothing was added.',
      landed: false,
    });
    expect((await homebrewRepo.listSafe()).files).toEqual([{ ...existing, enabled: false }]);
    // As the old flow did for a file imported twice.
    await waitFor(() => expect(ensureSourcesVisible).toHaveBeenCalledWith(['HB']));
  });

  it('names the file that wins a clash, and the registry agrees', async () => {
    await homebrewRepo.importJson(ZAP_1, 'older.json');
    renderSheet();
    await readFile('newer.json', brew('HB', [{ name: 'Zap', source: 'HB', level: 5 }]));

    const dialog = await findDialog('Import "newer.json"?');
    expect(dialog.textContent).toContain('"older.json" also declares the source HB.');
    const clash = within(dialog).getByText(/^Zap \(HB\) is also in/);
    expect(clash.textContent).toBe(
      'Zap (HB) is also in "older.json", which was imported first, so a character that picks it gets that version.',
    );
    // Same source, different content: the new file's matching entries wait.
    expect(dialog.textContent).toContain(
      'Entries in this file that match entries in "older.json" are not used: "older.json" was imported first, so it wins until it is disabled or deleted.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect((await handedBack()).message).toContain('Imported "newer.json"');

    // What a character would get: the version in the file the preview named.
    const winner = (await getRegistry()).get('spell', 'Zap', 'HB');
    const { files } = await homebrewRepo.listSafe();
    const winnerFile = files.find((f) =>
      (f.json as { spell: { level: number }[] }).spell.some((s) => s.level === winner?.level),
    );
    expect(files).toHaveLength(2);
    expect(winnerFile?.fileName).toBe('older.json');
  });

  it('says a clash with a turned-off file is used only while that file stays off', async () => {
    const off = await homebrewRepo.importJson(ZAP_1, 'off.json');
    await homebrewRepo.setEnabled(off.id, false);
    renderSheet();
    await readFile('zap5.json', brew('HB', [{ name: 'Zap', source: 'HB', level: 5 }]));

    const dialog = await findDialog('Import "zap5.json"?');
    const section = within(dialog).getByRole('region', { name: 'Clashes with turned-off files' });
    expect(section.textContent).toContain('Zap (HB) is also in "off.json", which is turned off.');
    expect(dialog.textContent).toContain(
      'This file\'s entries are used for now; "off.json" wins again if it is turned back on.',
    );
  });

  it('explains a missing dependency without blocking the import', async () => {
    renderSheet();
    await readFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

    const dialog = await findDialog('Import "needs.json"?');
    const deps = within(dialog).getByRole('region', { name: 'Depends on' });
    expect(deps.textContent).toBe(
      'Depends onXYZ is not on this device. Entries that need it may be incomplete until you import it.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect((await handedBack()).message).toContain('Imported "needs.json"');
    expect(await fileCount()).toBe(1);
  });

  // True whether the download is running, stopped on an error, or not begun.
  it.each([
    'working',
    'error',
    'idle',
  ] as const)('says only that not all game data is here when the download is %s', async (phase) => {
    dataStatusStore.getState().setPhase(phase);
    renderSheet();
    await readFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

    const dialog = await findDialog('Import "needs.json"?');
    expect(dialog.textContent).toContain(
      'XYZ is not found yet. Not all game data is on this device yet, so it may arrive with the rest.',
    );
    expect(dialog.textContent).toContain(
      'Not all game data is on this device yet, so clashes with official content may be incomplete.',
    );
    expect(dialog.textContent).not.toContain('is not on this device');
    expect(dialog.textContent).not.toContain('downloading');
  });

  it('agrees with its note when no game data could be read', async () => {
    registry.fail = true;
    renderSheet();
    await readFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

    const dialog = await findDialog('Import "needs.json"?');
    expect(within(dialog).getByRole('region', { name: 'Depends on' }).textContent).toContain(
      'XYZ could not be checked against official content, because game data could not be read.',
    );
    expect(dialog.textContent).toContain(
      'Game data could not be read, so clashes with official content were not checked.',
    );
  });

  it('says when a copy target is only in a turned-off file', async () => {
    const off = await homebrewRepo.importJson(
      brew('OFF', [{ name: 'Base', source: 'OFF', level: 2 }]),
      'off.json',
    );
    await homebrewRepo.setEnabled(off.id, false);
    renderSheet();
    await readFile(
      'child.json',
      brew('HB', [{ name: 'Child', source: 'HB', _copy: { name: 'Base', source: 'OFF' } }]),
    );

    const dialog = await findDialog('Import "child.json"?');
    expect(
      within(dialog).getByRole('region', { name: 'Copies that will not load in full' }).textContent,
    ).toContain(
      'Child copies Base|OFF, which is only in "off.json", a file that is turned off. Until that file is turned on, Child will be missing what it copies.',
    );
  });

  it('still previews when a roster character cannot be read', async () => {
    const good = newCharacterDoc('hero-1', 'Brin', 't');
    good.homebrewDeps = ['HB'];
    await characterRepo.put(good);
    // A stored doc whose spellcasting entry has no lists.
    await db.characters.put({
      ...newCharacterDoc('hero-2', 'Broken', 't'),
      spellcasting: { wizard: {} },
    } as never);
    renderSheet();
    await readFile('brew.json', ZAP_1);

    const dialog = await findDialog('Import "brew.json"?');
    const characters = within(dialog).getByRole('region', {
      name: 'Characters that use its sources',
    });
    expect(
      within(characters)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Brin']);
  });

  it('describes the dialog and lets a keyboard scroll its details', async () => {
    renderSheet();
    await readFile('brew.json', ZAP_1);

    const dialog = await findDialog('Import "brew.json"?');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'Nothing is added until you choose Import.',
    );
    expect(within(dialog).getByRole('region', { name: 'Import details' }).tabIndex).toBe(0);
  });

  // A second press while a file is checked starts nothing; picking another
  // file stops the check, since it was of a file no longer chosen. The
  // preview that comes is always for the file the sheet shows.
  it('stops a check when another file is picked, and previews the file now chosen', async () => {
    const releaseA = holdRegistry();
    renderSheet();
    const readIt = await readFile(
      'a.json',
      brew('AAA', [{ name: 'Slow', source: 'AAA', level: 1 }]),
    );
    await waitFor(() => expect(registry.calls).toBe(1), { timeout: WAIT });
    // While a file is checked, Read it says it is busy and starts nothing.
    expect(readIt.getAttribute('aria-disabled')).toBe('true');
    expect(readIt.getAttribute('aria-busy')).toBe('true');
    // The Checking line is announced, and no busy ancestor holds it back.
    expect(said()).toBe('Checking "a.json"…');
    expect(importLine().closest('[aria-busy="true"]')).toBeNull();
    fireEvent.click(readIt);
    expect(said()).toBe('Checking "a.json"…');
    expect(registry.calls).toBe(1);

    // b.json is picked: a.json's check stops, and Read it is free again.
    await readFile('b.json', brew('BBB', [{ name: 'Quick', source: 'BBB', level: 1 }]), false);
    const s = await sheet();
    expect(s.textContent).toContain('b.json');
    expect(said()).toBe('Stopped. Nothing was added.');
    expect(readIt.getAttribute('aria-disabled')).toBe('false');
    expect(readIt.getAttribute('aria-busy')).toBe('false');
    // a.json's read, let go now, swaps nothing in and says nothing, even
    // once the announcer's spacing would have let a second line through.
    releaseA();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS + 100));
    onlyTheSheet();
    expect(said()).toBe('Stopped. Nothing was added.');
    expect(heard.lines.filter((line) => line.startsWith('Stopped'))).toHaveLength(1);

    fireEvent.click(readIt);
    const dialog = await findDialog('Import "b.json"?');
    expect(screen.queryByRole('dialog', { name: 'Import "a.json"?' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await handedBack()).toEqual({ message: 'Imported "b.json" (1 spell)', landed: true });
    expect((await db.homebrewFiles.toArray()).map((f) => f.fileName)).toEqual(['b.json']);
  });

  it.each([
    ['A link', 'Link to a JSON homebrew file'],
    ['Text', /^Paste a homebrew file/],
  ] as const)('stops a check when %s is changed while it is read', async (way, field) => {
    const release = holdRegistry();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(ZAP_1)));
    renderSheet();
    const s = await sheet();
    fireEvent.click(within(s).getByRole('button', { name: way }));
    const box = within(s).getByRole('textbox', { name: field });
    fireEvent.change(box, {
      target: {
        value:
          way === 'A link'
            ? 'https://raw.githubusercontent.com/me/brews/main/brew.json'
            : JSON.stringify(ZAP_1),
      },
    });
    const readIt = within(s).getByRole('button', { name: 'Read it' });
    fireEvent.click(readIt);
    await waitFor(() => expect(registry.calls).toBe(1), { timeout: WAIT });
    expect(readIt.getAttribute('aria-busy')).toBe('true');

    fireEvent.change(box, { target: { value: `${(box as HTMLInputElement).value}x` } });
    await waitFor(() => expect(said()).toBe('Stopped. Nothing was added.'), { timeout: WAIT });
    expect(readIt.getAttribute('aria-busy')).toBe('false');
    // The read, let go now, swaps nothing in and says nothing, even once the
    // announcer's spacing would have let a second line through.
    release();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS + 100));
    onlyTheSheet();
    expect(said()).toBe('Stopped. Nothing was added.');
    expect(heard.lines.filter((line) => line.startsWith('Stopped'))).toHaveLength(1);
  });

  it('lists the copies a file completes and the characters that use its sources', async () => {
    await homebrewRepo.importJson(
      brew('AAA', [{ name: 'Child', source: 'AAA', _copy: { name: 'Base', source: 'BBB' } }]),
      'dependent.json',
    );
    const hero = newCharacterDoc('hero-1', 'Brin', 't');
    hero.homebrewDeps = ['BBB'];
    await characterRepo.put(hero);
    renderSheet();
    await readFile('provider.json', brew('BBB', [{ name: 'Base', source: 'BBB', level: 3 }]));

    const dialog = await findDialog('Import "provider.json"?');
    expect(
      within(dialog).getByRole('region', { name: 'Copies this file completes' }).textContent,
    ).toContain('In "dependent.json": Child copies from this file and will load in full');
    const characters = within(dialog).getByRole('region', {
      name: 'Characters that use its sources',
    });
    expect(within(characters).getByRole('listitem').textContent).toBe('Brin');
  });

  it('names the entries it leaves out, and stores the rest (finding 14)', async () => {
    renderSheet();
    await readFile(
      'brew.json',
      brew('HB', [
        { source: 'HB', level: 'two', entries: 'not an array' },
        { name: 'Zap', source: 'HB', level: 1 },
        { name: 'Odd', source: 7, level: 1 },
      ]),
    );

    const dialog = await findDialog('Import "brew.json"?');
    const left = within(dialog).getByRole('region', { name: 'Left out' });
    expect(left.textContent).toContain(
      '2 entries in this file cannot be read, so they are left out. The rest imports as usual.',
    );
    expect(
      within(left)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['The 1st spell: it has no name.', 'Odd (spell): its book is not text.']);
    expect(dialog.textContent).toContain('1 spell');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect((await handedBack()).landed).toBe(true);
    const [stored] = await db.homebrewJson.toArray();
    expect((stored?.json as { spell: unknown[] }).spell).toEqual([
      { name: 'Zap', source: 'HB', level: 1 },
    ]);
  });

  it('says when nothing in a file is left to import', async () => {
    renderSheet();
    await readFile('brew.json', brew('HB', [{ source: 'HB', level: 1 }]));
    const dialog = await findDialog('Import "brew.json"?');
    expect(within(dialog).getByRole('region', { name: 'Left out' }).textContent).toContain(
      'One entry in this file cannot be read, so it is left out. Nothing else in it can be read, so importing it adds an empty collection.',
    );
  });

  it('refuses a file that is not JSON without a preview', async () => {
    renderSheet();
    await readFile('broken.json', '{ not json');

    await waitFor(() => expect(said()).toMatch(/^Import failed: /), { timeout: WAIT });
    onlyTheSheet();
    expect(done).toEqual([]);
    expect(await fileCount()).toBe(0);
  });
});

describe('the Import sheet, from a link', () => {
  const URL_RAW = 'https://raw.githubusercontent.com/me/brews/main/brew.json';

  it('previews a fetched file from a GitHub page link, then stores it under the raw link', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(ZAP_1)));
    renderSheet();
    await readLink('https://github.com/me/brews/blob/main/brew.json');

    const dialog = await findDialog('Import "brew.json"?');
    expect(fetchSpy).toHaveBeenCalledWith(URL_RAW, expect.anything());
    expect(await fileCount()).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await handedBack()).toEqual({
      message: 'Imported "brew.json" (1 spell)',
      landed: true,
    });
    expect((await db.homebrewFiles.toArray()).map((f) => f.url)).toEqual([URL_RAW]);
  });

  it('gives the network advice when the host cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderSheet();
    await readLink(URL_RAW);

    await waitFor(
      () =>
        expect(said()).toBe(
          'That link could not be read (Failed to fetch). The site may be down or may not let the app read the file: download it and bring it in as a file.',
        ),
      { timeout: WAIT },
    );
    expect(importLine().querySelector('p')?.className).toContain('text-danger');
    onlyTheSheet();
    expect(await fileCount()).toBe(0);
  });

  it('reports an HTTP failure as itself, without network advice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    renderSheet();
    await readLink(URL_RAW);

    await waitFor(() => expect(said()).toBe('That link could not be read (HTTP 404).'), {
      timeout: WAIT,
    });
    onlyTheSheet();
  });

  it('refuses a host off the list without fetching, with a link to the file and the file route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderSheet();
    await readLink('https://example.com/x.json');

    await waitFor(() => expect(said()).toContain('only from GitHub'), { timeout: WAIT });
    const line = importLine();
    expect(line.textContent).toContain(
      'For other sites, open the file, save it to this device, and bring it in as a file.',
    );
    const open = within(line).getByRole('link', { name: 'Open the file' });
    expect(open.getAttribute('href')).toBe('https://example.com/x.json');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(within(line).getByRole('button', { name: 'Bring it in as a file' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    onlyTheSheet();
    expect(await fileCount()).toBe(0);
  });

  // The form leaves the check to the sheet: a browser that checked the URL
  // field itself would refuse the link with its own bubble, and this line
  // would never show.
  it('says a link that is no URL at all is not a complete URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderSheet();
    await readLink('raw.githubusercontent.com/me/brews/main/brew.json');
    await waitFor(() => expect(said()).toBe('That is not a complete URL.'), { timeout: WAIT });
    expect(fetchSpy).not.toHaveBeenCalled();
    onlyTheSheet();
  });

  it('gives an http link its own fix, not the other-sites advice', async () => {
    renderSheet();
    await readLink('http://raw.githubusercontent.com/me/brews/main/brew.json');
    await waitFor(() => expect(said()).toBe('Only https URLs are fetched.'), { timeout: WAIT });
    expect(importLine().textContent).not.toContain('For other sites');
  });

  it('sends a GitHub folder page to the Raw button', async () => {
    renderSheet();
    await readLink('https://github.com/me/brews/tree/main/dir');

    await waitFor(() => expect(said()).toContain('Raw button'), { timeout: WAIT });
    expect(importLine().textContent).not.toContain('For other sites');
  });

  it('links nothing for a refused link that is not http(s)', async () => {
    renderSheet();
    await readLink('javascript:alert(1)');

    await waitFor(() => expect(said()).toBe('Only https URLs are fetched.'), { timeout: WAIT });
    // The refusal is up, with its file route, and links nowhere.
    expect(
      within(importLine()).getByRole('button', { name: 'Bring it in as a file' }),
    ).toBeTruthy();
    expect(within(importLine()).queryByRole('link')).toBeNull();
  });

  it('says why a link was refused, with the advice the sheet shows, from no live region', async () => {
    renderSheet();
    await readLink('https://example.com/x.json');
    const guidance = await screen.findByText(/only from GitHub/, {}, { timeout: WAIT });
    // Said once, after the check that came before it.
    await waitFor(() =>
      expect(heard.lines).toEqual(['Checking the file at that link…', guidance.textContent]),
    );
    expect(guidance.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });

  it('says a refusal again when the same link is read again', async () => {
    renderSheet();
    await readLink('https://example.com/x.json');
    await screen.findByText(/only from GitHub/, {}, { timeout: WAIT });
    // A second press answers a second read; silence would sound like nothing happened.
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS + 100));
    await readLink('https://example.com/x.json');
    const refusals = () => heard.lines.filter((line) => !line.startsWith('Checking'));
    await waitFor(() => expect(refusals()).toHaveLength(2));
    expect(refusals()[0]).toBe(refusals()[1]);
  });
});

describe('the Import sheet, with a Fight Club 5e compendium', () => {
  /** Made-up entries in the shape Fight Club writes, one of them official here. */
  const COMPENDIUM = `<?xml version="1.0" encoding="UTF-8"?>
<compendium version="5">
  <spell>
    <name>Ember Lance</name><level>1</level><school>EV</school><time>1 action</time>
    <range>60 feet</range><components>V, S</components><duration>Instantaneous</duration>
    <classes>School: Evocation, Wizard</classes>
    <text>Make a ranged spell attack. On a hit, the target takes 2d8 fire damage.</text>
  </spell>
  <spell>
    <name>Ashen Veil</name><level>2</level><school>C</school><time>1 action</time>
    <range>Self</range><components>V</components><classes>Sorcerer</classes>
    <text>Grey ash swirls around you.</text>
  </spell>
  <spell>
    <name>Fire Bolt</name><level>0</level><school>EV</school><time>1 action</time>
    <range>120 feet</range><components>V, S</components><duration>Instantaneous</duration>
    <classes>Wizard</classes><text>A mote of fire.</text>
  </spell>
  <class><name>Ember Knight</name></class>
</compendium>`;

  const AURORA = '<elements><element name="Ember Knight" type="Class"/></elements>';

  it('previews what carried over, and Import stores the converted file', async () => {
    renderSheet();
    await readFile('embers.xml', COMPENDIUM);

    const dialog = await findDialog('Import "embers.xml"?');
    expect(
      within(dialog).getByRole('heading', { name: 'Converted from Fight Club 5e' }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain('2 spell');
    expect(dialog.textContent).toContain('Converted: 2 entries, each with its full text.');
    // The official Fire Bolt is the one used, so the file's copy is left out.
    expect(dialog.textContent).toContain('Left out: 1 entry: your game data already has it.');
    expect(dialog.textContent).toContain(
      'Ember Knight: it adds to a class of that name, and only its subclasses convert: it has none.',
    );
    expect(dialog.textContent).toContain('Ashen Veil: the file gives no duration.');
    expect(dialog.textContent).toContain('embers (Fight Club 5e) (FCEmbers)');
    expect(await fileCount()).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await handedBack()).toEqual({
      message: 'Imported "embers.xml" (2 spell)',
      landed: true,
    });
    const [stored] = (await homebrewRepo.listSafe()).files;
    expect(stored?.fileName).toBe('embers.xml');
    const json = stored?.json as { _meta: Json; spell: Json[] };
    expect(json._meta.convertedFrom).toEqual({
      format: 'fc5-compendium',
      converterVersion: FC5_CONVERTER_VERSION,
      fileName: 'embers.xml',
    });
    expect(json.spell.map((s) => s.name)).toEqual(['Ember Lance', 'Ashen Veil']);
    expect(ensureSourcesVisible).toHaveBeenCalledWith(['FCEmbers']);
  });

  /** Made-up spells from two made-up books, as their Source lines say. */
  const LIBRARY = (ashen: string[]) => `<compendium version="5">
  <spell>
    <name>Ember Lance</name><level>1</level><school>EV</school><time>1 action</time>
    <range>60 feet</range><components>V</components><duration>Instantaneous</duration>
    <classes>Wizard</classes><text>A lance of fire.\nSource: Ember Codex p. 3</text>
  </spell>${ashen
    .map(
      (name, i) => `
  <spell>
    <name>${name}</name><level>2</level><school>C</school><time>1 action</time>
    <range>Self</range><components>V</components><duration>1 minute</duration>
    <classes>Sorcerer</classes><text>Grey ash.\nSource: Ashen Tome p. ${i + 4}</text>
  </spell>`,
    )
    .join('')}
</compendium>`;

  /** Bring `content` in as a file in a fresh sheet and press `answer` on its preview. */
  async function landBooks(content: string, answer: string) {
    cleanup();
    renderSheet();
    await readFile('library.xml', content);
    const dialog = await findDialog('Import "library.xml"?');
    fireEvent.click(within(dialog).getByRole('button', { name: answer }));
    return handedBack();
  }

  it('stores a compendium a book at a time, the books the player picks', async () => {
    renderSheet();
    await readFile('library.xml', LIBRARY(['Ash Bolt', 'Ash Veil']));

    let dialog = await findDialog('Import "library.xml"?');
    const books = within(dialog).getByRole('region', { name: 'Books' });
    const ember = within(books).getByRole('checkbox', { name: /Ember Codex/ }) as HTMLInputElement;
    const ashen = within(books).getByRole('checkbox', { name: /Ashen Tome/ }) as HTMLInputElement;
    expect([ember.checked, ashen.checked]).toEqual([true, true]);
    expect(within(dialog).getByRole('button', { name: 'Import 2 books' })).toBeTruthy();

    fireEvent.click(ember);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 book' }));
    expect(await handedBack()).toEqual({
      message: 'Imported 1 book from "library.xml" (2 spell)',
      landed: true,
    });
    expect((await homebrewRepo.listMetaSafe()).files.map((f) => f.book)).toEqual(['Ashen Tome']);

    // Again, with the Ashen Tome grown: the stored copy is replaced, and the
    // Ember Codex comes in now that it is ticked.
    cleanup();
    renderSheet();
    await readFile('library.xml', LIBRARY(['Ash Bolt', 'Ash Veil', 'Ash Storm']));
    dialog = await findDialog('Import "library.xml"?');
    expect(dialog.textContent).toContain('Replaces the copy from "library.xml".');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 2 books' }));
    expect(await handedBack()).toEqual({
      message: 'Imported 2 books from "library.xml" (4 spell), replacing 1 book imported before',
      landed: true,
    });
    const stored = (await homebrewRepo.listMetaSafe()).files;
    expect(stored.map((f) => [f.book, f.counts]).sort()).toEqual([
      ['Ashen Tome', { spell: 3 }],
      ['Ember Codex', { spell: 1 }],
    ]);
  });

  it('refuses books the browser clearly has no room for, before writing any', async () => {
    let room = 100;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 1000, quota: 1000 + room }) },
    });
    try {
      renderSheet();
      await readFile('library.xml', LIBRARY(['Ash Bolt']));
      let dialog = await findDialog('Import "library.xml"?');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Import 2 books' }));
      // The sheet comes back with the reason, and nothing has landed.
      await waitFor(
        () =>
          expect(said()).toMatch(
            /^Import failed: It needs about \d+ KB, and the browser has 100 bytes left for the app\. This device is out of storage space/,
          ),
        { timeout: WAIT },
      );
      onlyTheSheet();
      expect(done).toEqual([]);
      expect(await fileCount()).toBe(0);

      // With room, they come in: the file is still chosen, so Read it again.
      room = 10_000_000;
      fireEvent.click(within(await sheet()).getByRole('button', { name: 'Read it' }));
      dialog = await findDialog('Import "library.xml"?');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Import 2 books' }));
      expect((await handedBack()).message).toMatch(/^Imported 2 books/);

      // A book that takes the place of its own older copy then needs no more
      // room than it had.
      room = 100;
      expect((await landBooks(LIBRARY(['Ash Bolt', 'Ash Veil']), 'Import 1 book')).message).toMatch(
        /^Imported 1 book .*replacing 1 book/,
      );
    } finally {
      Reflect.deleteProperty(navigator, 'storage');
    }
  });

  it('replaces the same file imported whole before, with a source per book', async () => {
    const { book: _, ...whole } = await buildHomebrewRow(
      {
        _meta: {
          sources: [
            { json: 'FCEmberCodex', full: 'Ember Codex' },
            { json: 'FCAshenTome', full: 'Ashen Tome' },
          ],
          convertedFrom: { format: 'fc5-compendium', fileName: 'library.xml' },
        },
        spell: [{ name: 'Ash Bolt', source: 'FCAshenTome', level: 2 }],
      },
      'library.xml',
    );
    await putHomebrewRow(whole);
    renderSheet();
    await readFile('library.xml', LIBRARY(['Ash Bolt']));
    const dialog = await findDialog('Import "library.xml"?');
    expect(dialog.textContent).toContain(
      'Imported before as one file of 2 books. Importing replaces it, so each entry shows once',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 2 books' }));
    expect((await handedBack()).message).toMatch(/^Imported 2 books .*replacing 1 book/);
    const stored = (await homebrewRepo.listMetaSafe()).files;
    expect(stored.map((f) => f.book).sort()).toEqual(['Ashen Tome', 'Ember Codex']);
  });

  it('says how many books are off when every book of the file is already here', async () => {
    expect((await landBooks(LIBRARY(['Ash Bolt']), 'Import 2 books')).message).toMatch(
      /^Imported 2 books/,
    );
    const ashen = (await homebrewRepo.listMetaSafe()).files.find((f) => f.book === 'Ashen Tome');
    await homebrewRepo.setEnabled(ashen?.id ?? '', false);

    cleanup();
    renderSheet();
    await readFile('library.xml', LIBRARY(['Ash Bolt']));
    const dialog = await findDialog('"library.xml" is already here');
    expect(dialog.textContent).toContain('1 of 2 books turned off.');
    expect(dialog.textContent).toContain('They are under Collections. Turn them on there');
    expect(dialog.textContent).not.toContain('Turned off. It is under Collections.');
  });

  it('turns Import off while no book that is new is ticked', async () => {
    renderSheet();
    await readFile('library.xml', LIBRARY(['Ash Bolt']));
    const dialog = await findDialog('Import "library.xml"?');
    const books = within(dialog).getByRole('region', { name: 'Books' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select none' }));
    const importButton = within(dialog).getByRole('button', { name: 'Import' });
    expect(importButton.getAttribute('aria-disabled')).toBe('true');
    expect(dialog.textContent).toContain('Tick a book that is not already on this device');
    fireEvent.click(importButton);
    expect(screen.queryByRole('dialog', { name: 'Import "library.xml"?' })).toBeTruthy();
    // The press did nothing, even later: a book ticked now is the only import.
    fireEvent.click(within(books).getByRole('checkbox', { name: /Ember Codex/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 book' }));
    expect(await handedBack()).toEqual({
      message: 'Imported 1 book from "library.xml" (1 spell)',
      landed: true,
    });
    expect((await homebrewRepo.listMetaSafe()).files.map((f) => f.book)).toEqual(['Ember Codex']);
  });

  it('says when every entry is already in the game data, without a preview', async () => {
    renderSheet();
    await readFile(
      'bolts.xml',
      `<compendium><spell><name>Fire Bolt</name><level>0</level><school>EV</school>
        <time>1 action</time><range>120 feet</range><components>V, S</components>
        <duration>Instantaneous</duration><text>A mote of fire.</text></spell></compendium>`,
    );

    await waitFor(
      () =>
        expect(said()).toBe(
          'Every entry in this Fight Club 5e file is already in your game data, so there is nothing to add. Nothing was added.',
        ),
      { timeout: WAIT },
    );
    // Not a failure: the line is in the muted colour, not `danger`.
    expect(importLine().querySelector('p')?.className).toContain('text-ink-muted');
    onlyTheSheet();
    expect(await fileCount()).toBe(0);
  });

  it('converts entries the game data already has while it cannot be read, and says so', async () => {
    registry.fail = true;
    renderSheet();
    await readFile('embers.xml', COMPENDIUM);

    const dialog = await findDialog('Import "embers.xml"?');
    expect(dialog.textContent).toContain('3 spell');
    expect(dialog.textContent).toContain(
      'Game data could not be read, so entries it already has were converted as well.',
    );
  });

  it('stops a compendium while it is read, before the converter starts, and adds nothing', async () => {
    const release = holdRegistry();
    const started = InlineImportWorker.started.length;
    renderSheet();
    const readIt = await readFile('embers.xml', COMPENDIUM);
    await waitFor(() => expect(registry.calls).toBe(1), { timeout: WAIT });

    const stop = within(importLine()).getByRole('button', { name: 'Stop reading' });
    stop.focus();
    fireEvent.click(stop);
    release();
    await waitFor(() => expect(said()).toBe('Stopped. Nothing was added.'), { timeout: WAIT });
    // Stop went with the read, so focus is on Read it, which is ready again.
    expect(document.activeElement).toBe(readIt);
    expect(readIt.getAttribute('aria-disabled')).toBe('false');
    expect(InlineImportWorker.started.length).toBe(started);
    onlyTheSheet();
    expect(done).toEqual([]);
    expect(await fileCount()).toBe(0);
  });

  it('puts focus on Read it when a read ends while Stop has it', async () => {
    const release = holdRegistry();
    renderSheet();
    const readIt = await readFile('aurora.xml', AURORA);
    await waitFor(() => expect(registry.calls).toBe(1), { timeout: WAIT });
    within(importLine()).getByRole('button', { name: 'Stop reading' }).focus();

    release();
    await waitFor(() => expect(said()).toMatch(/^Import failed/), { timeout: WAIT });
    expect(within(importLine()).queryByRole('button', { name: 'Stop reading' })).toBeNull();
    expect(document.activeElement).toBe(readIt);
  });

  it('names a file it recognizes but cannot import', async () => {
    renderSheet();
    await readFile('aurora.xml', AURORA);

    await waitFor(
      () =>
        expect(said()).toBe(
          'Import failed: This looks like Aurora Builder content, which cannot be imported yet. Fight Club 5e compendiums (XML) and 5etools homebrew (JSON) can be imported.',
        ),
      { timeout: WAIT },
    );
    expect(importLine().querySelector('p')?.className).toContain('text-danger');
    onlyTheSheet();
  });

  it('refuses XML that declares entities', async () => {
    renderSheet();
    await readFile(
      'entities.xml',
      '<!DOCTYPE compendium [<!ENTITY x "y">]><compendium><spell><name>&x;</name></spell></compendium>',
    );

    await waitFor(() => expect(said()).toMatch(/^Import failed: The file declares a DOCTYPE/), {
      timeout: WAIT,
    });
    onlyTheSheet();
    expect(await fileCount()).toBe(0);
  });

  it('converts a compendium fetched from a link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(COMPENDIUM));
    renderSheet();
    await readLink('https://raw.githubusercontent.com/me/brews/main/embers.xml');

    const dialog = await findDialog('Import "embers.xml"?');
    expect(
      within(dialog).getByRole('heading', { name: 'Converted from Fight Club 5e' }),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await handedBack()).toEqual({
      message: 'Imported "embers.xml" (2 spell)',
      landed: true,
    });
  });
});
