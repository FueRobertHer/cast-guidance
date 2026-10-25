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
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry } = await import('@/data5e/normalize');
  return {
    invalidateRegistry: vi.fn(),
    getRegistry: () => {
      const reg = new EntityRegistry();
      reg.addAll('class', [{ name: 'Fighter', source: 'PHB' }]);
      return Promise.resolve(reg);
    },
  };
});

import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { dataStatusStore } from '@/stores/dataStatus';
import { onboardingStore } from '@/stores/onboarding';
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
  // Keep the getting-started card out of the way of the import row.
  onboardingStore.setState({ dismissed: true });
});

afterEach(cleanup);

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
  const button = screen.getByRole('button', { name: 'Import from a file' });
  button.focus();
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File([text], 'brin.json', { type: 'application/json' })] },
  });
  return button;
}

/** The roster's import line: the only status region with no draft to undo. */
const importStatus = () => screen.getByRole('status');
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

    await waitFor(() =>
      expect(importStatus().textContent).toBe('Imported Brin. Added 1 homebrew file'),
    );
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
    expect(importStatus().textContent).toBe('Import canceled. Nothing was added.');
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
      expect(importStatus().textContent).toBe(
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

  it('calls an unfound source "not here yet" while game data is downloading', async () => {
    dataStatusStore.getState().setPhase('working');
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
      'Later is not here yet. Game data is still downloading, so it may arrive.',
    );
    expect(dialog.textContent).not.toContain('is not on this device');
  });

  it('refuses a file that is not JSON without a preview', async () => {
    renderRoster();
    chooseFile('{ not json');

    await waitFor(() =>
      expect(importStatus().textContent).toBe('Import failed: file is not valid JSON'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await db.characters.count()).toBe(0);
  });
});
