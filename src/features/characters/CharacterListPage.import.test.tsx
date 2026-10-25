// @vitest-environment jsdom
// IMP-002 and TEST-003: importing a character shows what it would do before
// anything is written: the class, whether it lands as a copy, the homebrew it
// carries and what is already here, and the sources nothing here provides.
// Real repositories over fake-indexeddb, the real roster and preview; the
// registry is a small stand-in holding one official class.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: null, status: 'loading' }),
}));
const { registry, preview } = vi.hoisted(() => ({
  /** `gates` holds back the next reads, in call order: a slow first download. */
  registry: { calls: 0, gates: [] as Promise<void>[] },
  /** Makes the preview builder throw, as a shape it cannot read would. */
  preview: { fail: false },
}));
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry } = await import('@/data5e/normalize');
  return {
    invalidateRegistry: vi.fn(),
    getRegistry: async () => {
      registry.calls += 1;
      const gate = registry.gates.shift();
      if (gate !== undefined) await gate;
      const reg = new EntityRegistry();
      reg.addAll('class', [{ name: 'Fighter', source: 'PHB' }]);
      return reg;
    },
  };
});
vi.mock('./importPreview', async (importOriginal) => {
  const real = await importOriginal<typeof import('./importPreview')>();
  return {
    ...real,
    previewCharacterImport: (input: Parameters<typeof real.previewCharacterImport>[0]) => {
      if (preview.fail) throw new TypeError('x is not iterable');
      return real.previewCharacterImport(input);
    },
  };
});

import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import { onboardingStore } from '@/stores/onboarding';
import { recordAnnouncer } from '../../../tests-fixtures/announcements';
import { Component as CharacterListPage } from './CharacterListPage';

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
  Object.assign(registry, { calls: 0, gates: [] });
  preview.fail = false;
  // Keep the getting-started card out of the way of the import row.
  onboardingStore.setState({ dismissed: true });
});

/** Everything the announcer says in a test; see `outcome`. */
let heard = recordAnnouncer();
beforeEach(() => {
  heard.stop();
  resetAnnouncer();
  heard = recordAnnouncer();
});

afterEach(() => {
  cleanup();
  heard.stop();
  resetAnnouncer();
});

type Json = Record<string, unknown>;

const BREW: Json = {
  _meta: { sources: [{ json: 'HB', full: 'Home Brews' }] },
  spell: [{ name: 'Zap', source: 'HB', level: 1 }],
};

function hero(over: (d: CharacterDoc) => void = () => undefined): CharacterDoc {
  const doc = newCharacterDoc('hero-1', 'Brin', 't');
  doc.classes = [{ ref: { name: 'Fighter', source: 'PHB' }, levels: 3, hp: ['avg'] }];
  doc.homebrewDeps = ['HB'];
  over(doc);
  return doc;
}

function exported(doc: CharacterDoc, homebrew: Json[] = [BREW]) {
  return {
    $format: CHARACTER_EXPORT_FORMAT,
    character: doc,
    homebrew: homebrew.map((json) => ({ fileName: 'brews.json', json })),
  };
}

function renderRoster() {
  render(
    <MemoryRouter>
      <CharacterListPage />
    </MemoryRouter>,
  );
}

function chooseFile(content: unknown) {
  const button = screen.getByRole('button', { name: 'Import from a file', hidden: true });
  button.focus();
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([text], 'brin.json', { type: 'application/json' })] },
  });
  return button;
}

/** The roster's import line: a plain visual, its words said by the announcer (A11Y-002). */
function importLine(): HTMLElement {
  const line = document.querySelector<HTMLElement>('[data-import-status]');
  if (line === null) throw new Error('no import line');
  return line;
}

/**
 * The outcome on the import line, which the announcer must have said too, as
 * the latest thing it said: the line is no longer a live region, so a shown
 * outcome nobody heard would otherwise pass.
 */
function outcome(): string {
  const shown = importLine().textContent ?? '';
  expect(heard.lines.at(-1)).toBe(shown);
  return shown;
}
/** The first preview also waits for its chunk to load, so it gets longer. */
const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: 5000 });

describe('character import preview', () => {
  it('shows the character before writing anything, and Import stores it', async () => {
    renderRoster();
    const opener = chooseFile(exported(hero()));

    const dialog = await findDialog('Import Brin?');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(dialog.textContent).toContain('ClassFighter 3');
    expect(within(dialog).queryByRole('region', { name: 'Imports as a copy' })).toBeNull();
    const files = within(dialog).getByRole('region', { name: 'Homebrew in this file' });
    expect(within(files).getByRole('listitem').textContent).toBe(
      'New. brews.json (1 spell). Importing adds it to your homebrew.',
    );
    expect(await db.characters.count()).toBe(0);
    expect(await db.homebrewFiles.count()).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(outcome()).toBe('Imported Brin. Added 1 homebrew file'));
    expect((await db.characters.toArray()).map((c) => c.id)).toEqual(['hero-1']);
    expect(await db.homebrewFiles.count()).toBe(1);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('writes nothing on Cancel', async () => {
    renderRoster();
    chooseFile(exported(hero()));
    const dialog = await findDialog('Import Brin?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(outcome()).toBe('Import canceled. Nothing was added.');
    expect(await db.characters.count()).toBe(0);
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('says a character already here imports as a copy and its homebrew is skipped', async () => {
    await characterRepo.importFromText(JSON.stringify(exported(hero())));
    renderRoster();
    chooseFile(exported(hero()));

    const dialog = await findDialog('Import Brin?');
    expect(within(dialog).getByRole('region', { name: 'Imports as a copy' }).textContent).toContain(
      'so this one is added as a copy with its own id. The character already here does not change.',
    );
    expect(
      within(dialog).getByRole('region', { name: 'Homebrew in this file' }).textContent,
    ).toContain(
      'Already here. brews.json (1 spell). The same file is on this device, so it is skipped.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() =>
      expect(outcome()).toBe(
        'Imported Brin as a copy, since a character with the same id was already here. 1 homebrew file already here',
      ),
    );
    expect(await db.characters.count()).toBe(2);
    expect(await db.homebrewFiles.count()).toBe(1);
  });

  it('says which local file keeps winning when another version of a source is here', async () => {
    await homebrewRepo.importJson(
      { ...BREW, spell: [{ name: 'Zap', source: 'HB', level: 4 }] },
      'mine.json',
    );
    renderRoster();
    chooseFile(exported(hero()));

    const dialog = await findDialog('Import Brin?');
    expect(
      within(dialog).getByRole('region', { name: 'Homebrew in this file' }).textContent,
    ).toContain(
      'Another version is here. brews.json (1 spell). "mine.json" declares the same source and was imported first, so its entries win where they match. The matching entries in this file are not used until that file is turned off or deleted.',
    );
  });

  it('gives guidance for sources that are missing, turned off or still downloading', async () => {
    const off = await homebrewRepo.importJson(
      { _meta: { sources: [{ json: 'OFF', full: 'Off' }] } },
      'off.json',
    );
    await homebrewRepo.setEnabled(off.id, false);
    renderRoster();
    chooseFile(
      exported(
        hero((d) => {
          d.homebrewDeps = ['GoneBrew', 'OFF'];
        }),
        [],
      ),
    );

    const dialog = await findDialog('Import Brin?');
    const sources = within(dialog).getByRole('region', { name: 'Sources not available' });
    const items = within(sources)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      // The character's own spelling, not the lowercased comparison key.
      'GoneBrew is not on this device. What the character uses from it will show as missing until you import it.',
      'OFF is in a homebrew file that is turned off. Turn it on in Homebrew to use it here.',
    ]);
    // Guidance, not gatekeeping: Import is still there.
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('says only that not all game data is here while the download is not done', async () => {
    dataStatusStore.getState().setPhase('error');
    renderRoster();
    chooseFile(
      exported(
        hero((d) => {
          d.homebrewDeps = ['Later'];
        }),
        [],
      ),
    );

    const dialog = await findDialog('Import Brin?');
    expect(dialog.textContent).toContain(
      'Later is not found yet. Not all game data is on this device yet, so it may arrive with the rest.',
    );
    expect(dialog.textContent).toContain(
      'Not all game data is on this device yet, so some sources may only be missing for now.',
    );
    expect(dialog.textContent).not.toContain('is not on this device');
    expect(dialog.textContent).not.toContain('downloading');
  });

  it('warns when a file it carries is already here but turned off', async () => {
    await characterRepo.importFromText(JSON.stringify(exported(hero())));
    const [file] = await db.homebrewFiles.toArray();
    await homebrewRepo.setEnabled(file?.id ?? '', false);
    renderRoster();
    chooseFile(exported(hero()));

    const dialog = await findDialog('Import Brin?');
    expect(
      within(dialog).getByRole('region', { name: 'Homebrew in this file' }).textContent,
    ).toContain(
      'Already here, turned off. brews.json (1 spell). The same file is on this device, so it is skipped, but it is turned off, so its entries are not used. Turn it on in Homebrew to use them.',
    );
  });

  // Shapes the old flow imported: the preview must read them, not throw.
  it.each([
    ['no class list', (d: Json) => delete d.classes, 'ClassNo class yet'],
    [
      'a class entry with no reference',
      (d: Json) => {
        d.classes = [{ levels: 2, hp: [] }];
      },
      'ClassUnknown class 2',
    ],
    [
      'a stray value among its homebrew dependencies',
      (d: Json) => {
        d.homebrewDeps = [5, 'HB'];
      },
      'ClassFighter 3',
    ],
  ])('previews and imports a character with %s', async (_, edit, classLine) => {
    const doc = hero() as unknown as Json;
    edit(doc);
    renderRoster();
    chooseFile(exported(doc as unknown as CharacterDoc));

    const dialog = await findDialog('Import Brin?');
    expect(dialog.textContent).toContain(classLine);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(outcome()).toMatch(/^Imported Brin/));
    expect(await db.characters.count()).toBe(1);
    // The roster still renders the imported character.
    expect(await screen.findByRole('button', { name: 'Actions for Brin' })).toBeTruthy();
  });

  it('falls back to a short preview when the details cannot be read', async () => {
    preview.fail = true;
    renderRoster();
    chooseFile(exported(hero()));

    const dialog = await findDialog('Import Brin?');
    expect(dialog.textContent).toContain(
      'Some details of this file could not be read for the preview, so it shows less than usual. Import still adds the character from the file.',
    );
    expect(dialog.textContent).toMatch(/Size\d+ bytes/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(outcome()).toBe('Imported Brin. Added 1 homebrew file'));
  });

  it('keeps the newest preview when an earlier check finishes late', async () => {
    let release: () => void = () => undefined;
    registry.gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    renderRoster();
    const opener = chooseFile(
      exported(
        hero((d) => {
          d.name = 'Slow';
        }),
        [],
      ),
    );
    await waitFor(() => expect(registry.calls).toBe(1));
    expect(opener.getAttribute('aria-disabled')).toBe('true');

    chooseFile(
      exported(
        hero((d) => {
          d.id = 'hero-2';
          d.name = 'Quick';
        }),
        [],
      ),
    );
    const dialog = await findDialog('Import Quick?');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Import Slow?' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(outcome()).toBe('Imported Quick'));
    expect((await db.characters.toArray()).map((c) => c.name)).toEqual(['Quick']);
    expect(opener.getAttribute('aria-disabled')).toBe('false');
  });

  it('refuses a file that is not JSON without a preview', async () => {
    renderRoster();
    chooseFile('{ not json');

    await waitFor(() => expect(outcome()).toBe('Import failed: file is not valid JSON'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await db.characters.count()).toBe(0);
  });
});

// A11Y-002: each message on the import line is said once through the
// announcer, the check in progress and then its outcome.
describe('character import announcements', () => {
  it('says the check and each outcome once', async () => {
    // Each line on this key waits out the announcer's throttle after the one
    // before (THROTTLE_MS), and an import that is slow under load adds its
    // own time to that, so every wait for a line allows well past both: the
    // default second could run out first, with the line still to come.
    const said = { timeout: THROTTLE_MS + 2000 };
    renderRoster();
    chooseFile(exported(hero()));
    expect(outcome()).toBe('Checking "brin.json"…');
    let dialog = await findDialog('Import Brin?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(outcome()).toBe('Import canceled. Nothing was added.'), said);

    chooseFile(exported(hero()));
    dialog = await findDialog('Import Brin?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(outcome()).toBe('Imported Brin. Added 1 homebrew file'), said);

    // Right after the last one, so this one waits out the key's throttle.
    chooseFile('{ not json');
    await waitFor(() => expect(outcome()).toBe('Import failed: file is not valid JSON'), said);

    // A check that is answered inside the key's throttle can be replaced by
    // its answer before it is said, so only the outcomes are counted exactly.
    const outcomes = heard.lines.filter((line) => !line.startsWith('Checking'));
    expect(outcomes).toEqual([
      'Import canceled. Nothing was added.',
      'Imported Brin. Added 1 homebrew file',
      'Import failed: file is not valid JSON',
    ]);
    expect(heard.lines[0]).toBe('Checking "brin.json"…');
    expect(importLine().closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });
});
