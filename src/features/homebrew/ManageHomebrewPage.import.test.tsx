// @vitest-environment jsdom
// IMP-002 and TEST-003: importing homebrew shows what the file would do before
// anything is written, and Import or Cancel decide. Real repositories over
// fake-indexeddb, the real page and the real preview; only the registry is a
// small stand-in, built from the official entries below plus every enabled
// file merged by the real `mergeHomebrew`, so "who wins" is what the app
// would actually resolve.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

import { getRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { dataStatusStore } from '@/stores/dataStatus';
import { Component as ManageHomebrewPage } from './ManageHomebrewPage';

// jsdom has no matchMedia and the sheet asks for one on mount.
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

function renderPage() {
  render(
    <MemoryRouter>
      <ManageHomebrewPage />
    </MemoryRouter>,
  );
}

/** Choose a file through the page's Import file button, as a person would. */
function chooseFile(name: string, content: unknown) {
  const button = screen.getByRole('button', { name: 'Import file', hidden: true });
  button.focus();
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  });
  return button;
}

const status = () => screen.getByRole('status');
/** The first preview also waits for its chunk to load, so it gets longer. */
const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: 5000 });
const fileCount = () => db.homebrewFiles.count();

describe('homebrew import preview', () => {
  it('shows what the file holds before writing anything, and Import stores it', async () => {
    renderPage();
    const opener = chooseFile(
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

    await waitFor(() => expect(status().textContent).toBe('Imported "brew.json" (2 spell)'));
    expect(await fileCount()).toBe(1);
    expect(ensureSourcesVisible).toHaveBeenCalledWith(['HB']);
    expect(invalidateRegistry).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Focus is back on the button the import started from.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('writes nothing on Cancel', async () => {
    renderPage();
    const opener = chooseFile('brew.json', ZAP_1);
    const dialog = await findDialog('Import "brew.json"?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(status().textContent).toBe('Import canceled. Nothing was added.');
    expect(await fileCount()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(ensureSourcesVisible).not.toHaveBeenCalled();
    expect(invalidateRegistry).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('offers to keep a file that is already here, and changes nothing', async () => {
    const existing = await homebrewRepo.importJson(ZAP_1, 'zap.json');
    await homebrewRepo.setEnabled(existing.id, false);
    renderPage();
    chooseFile('zap-again.json', ZAP_1);

    const dialog = await findDialog('"zap-again.json" is already here');
    expect(within(dialog).getByRole('heading', { name: 'Already on this device' })).toBeTruthy();
    expect(dialog.textContent).toContain(
      `Already imported on ${new Date(existing.addedAt).toLocaleDateString()}.`,
    );
    expect(dialog.textContent).toContain('Turned off. It is in your list below.');
    // One answer: there is nothing to import.
    expect(within(dialog).queryByRole('button', { name: 'Import' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the existing file' }));

    await waitFor(() =>
      expect(status().textContent).toBe('Kept the existing "zap.json". Nothing was added.'),
    );
    expect(await db.homebrewFiles.toArray()).toEqual([{ ...existing, enabled: false }]);
    // As the old flow did for a file imported twice.
    await waitFor(() => expect(ensureSourcesVisible).toHaveBeenCalledWith(['HB']));
  });

  it('names the file that wins a clash, and the registry agrees', async () => {
    await homebrewRepo.importJson(ZAP_1, 'older.json');
    renderPage();
    chooseFile('newer.json', brew('HB', [{ name: 'Zap', source: 'HB', level: 5 }]));

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
    await waitFor(() => expect(status().textContent).toContain('Imported "newer.json"'));

    // What a character would get: the version in the file the preview named.
    const winner = (await getRegistry()).get('spell', 'Zap', 'HB');
    const files = await db.homebrewFiles.toArray();
    const winnerFile = files.find((f) =>
      (f.json as { spell: { level: number }[] }).spell.some((s) => s.level === winner?.level),
    );
    expect(files).toHaveLength(2);
    expect(winnerFile?.fileName).toBe('older.json');
  });

  it('says a clash with a turned-off file is used only while that file stays off', async () => {
    const off = await homebrewRepo.importJson(ZAP_1, 'off.json');
    await homebrewRepo.setEnabled(off.id, false);
    renderPage();
    chooseFile('zap5.json', brew('HB', [{ name: 'Zap', source: 'HB', level: 5 }]));

    const dialog = await findDialog('Import "zap5.json"?');
    const section = within(dialog).getByRole('region', { name: 'Clashes with turned-off files' });
    expect(section.textContent).toContain('Zap (HB) is also in "off.json", which is turned off.');
    expect(dialog.textContent).toContain(
      'This file\'s entries are used for now; "off.json" wins again if it is turned back on.',
    );
  });

  it('explains a missing dependency without blocking the import', async () => {
    renderPage();
    chooseFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

    const dialog = await findDialog('Import "needs.json"?');
    const deps = within(dialog).getByRole('region', { name: 'Depends on' });
    expect(deps.textContent).toBe(
      'Depends onXYZ is not on this device. Entries that need it may be incomplete until you import it.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(status().textContent).toContain('Imported "needs.json"'));
    expect(await fileCount()).toBe(1);
  });

  // True whether the download is running, stopped on an error, or not begun.
  it.each([
    'working',
    'error',
    'idle',
  ] as const)('says only that not all game data is here when the download is %s', async (phase) => {
    dataStatusStore.getState().setPhase(phase);
    renderPage();
    chooseFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

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
    renderPage();
    chooseFile('needs.json', brew('HB', [], { dependencies: { spell: ['XYZ'] } }));

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
    renderPage();
    chooseFile(
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
    renderPage();
    chooseFile('brew.json', ZAP_1);

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
    renderPage();
    chooseFile('brew.json', ZAP_1);

    const dialog = await findDialog('Import "brew.json"?');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'Nothing is added until you choose Import.',
    );
    expect(within(dialog).getByRole('region', { name: 'Import details' }).tabIndex).toBe(0);
  });

  it('keeps the newest preview when an earlier check finishes late', async () => {
    let release: () => void = () => undefined;
    registry.gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    renderPage();
    const opener = chooseFile('a.json', brew('AAA', [{ name: 'Slow', source: 'AAA', level: 1 }]));
    await waitFor(() => expect(registry.calls).toBe(1));
    // While a file is checked, the button says it is busy and starts nothing.
    expect(opener.getAttribute('aria-disabled')).toBe('true');
    // The Checking line is announced: no busy ancestor holds it back.
    expect(status().textContent).toBe('Checking "a.json"…');
    expect(status().closest('[aria-busy="true"]')).toBeNull();

    chooseFile('b.json', brew('BBB', [{ name: 'Quick', source: 'BBB', level: 1 }]));
    const dialog = await findDialog('Import "b.json"?');
    release();
    // The late answer for a.json does not take b.json's place.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Import "a.json"?' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(status().textContent).toBe('Imported "b.json" (1 spell)'));
    expect((await db.homebrewFiles.toArray()).map((f) => f.fileName)).toEqual(['b.json']);
    expect(opener.getAttribute('aria-disabled')).toBe('false');
  });

  it('lists the copies a file completes and the characters that use its sources', async () => {
    await homebrewRepo.importJson(
      brew('AAA', [{ name: 'Child', source: 'AAA', _copy: { name: 'Base', source: 'BBB' } }]),
      'dependent.json',
    );
    const hero = newCharacterDoc('hero-1', 'Brin', 't');
    hero.homebrewDeps = ['BBB'];
    await characterRepo.put(hero);
    renderPage();
    chooseFile('provider.json', brew('BBB', [{ name: 'Base', source: 'BBB', level: 3 }]));

    const dialog = await findDialog('Import "provider.json"?');
    expect(
      within(dialog).getByRole('region', { name: 'Copies this file completes' }).textContent,
    ).toContain('In "dependent.json": Child copies from this file and will load in full');
    const characters = within(dialog).getByRole('region', {
      name: 'Characters that use its sources',
    });
    expect(within(characters).getByRole('listitem').textContent).toBe('Brin');
  });

  it('refuses a file that is not JSON without a preview', async () => {
    renderPage();
    chooseFile('broken.json', '{ not json');

    await waitFor(() => expect(status().textContent).toMatch(/^Import failed: /));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await fileCount()).toBe(0);
  });
});

describe('homebrew import from a URL', () => {
  const URL_RAW = 'https://raw.githubusercontent.com/me/brews/main/brew.json';

  function submitUrl(url: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'Homebrew JSON URL' }), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import from URL' }));
  }

  it('previews a fetched file, keeps the URL until Import, then stores it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(ZAP_1)));
    renderPage();
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Homebrew JSON URL' });
    submitUrl('https://github.com/me/brews/blob/main/brew.json');

    const dialog = await findDialog('Import "brew.json"?');
    expect(fetchSpy).toHaveBeenCalledWith(URL_RAW, expect.anything());
    expect(await fileCount()).toBe(0);
    expect(field.value).not.toBe('');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(status().textContent).toBe('Imported "brew.json" (1 spell)'));
    expect((await db.homebrewFiles.toArray()).map((f) => f.url)).toEqual([URL_RAW]);
    expect(field.value).toBe('');
  });

  it('keeps the URL and writes nothing when the preview is canceled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(ZAP_1)));
    renderPage();
    submitUrl(URL_RAW);

    const dialog = await findDialog('Import "brew.json"?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(status().textContent).toBe('Import canceled. Nothing was added.'));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Homebrew JSON URL' }).value).toBe(
      URL_RAW,
    );
    expect(await fileCount()).toBe(0);
  });

  it('still gives the network advice when the host cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    submitUrl(URL_RAW);

    await waitFor(() =>
      expect(status().textContent).toBe(
        'URL import failed (Failed to fetch). The host may be down or may not allow the app to read the file; download it and use Import file instead.',
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await fileCount()).toBe(0);
  });

  it('still refuses a host off the list before any request, with the file route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage();
    submitUrl('https://example.com/x.json');

    await waitFor(() => expect(status().textContent).toContain('only from GitHub'));
    expect(within(status()).getByRole('button', { name: 'Import file' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
