// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// ADR-002 U11, board 11: the Build page's Content row. It reads the stored
// collections and this device's choice, shows this character's switch for
// each, and writes the character's `sourceSwitches` through the doc updater
// (so history and undo come free). A rule pack gets no switch.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import { writeSourcePolicy } from '@/data5e/sourceFilter';
import { setHomebrewSourceNames } from '@/data5e/sourceNames';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { diffDocs } from '@/lib/docDiff';
import type { DocUpdater } from '@/stores/characterSession';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { ContentSection, contentSummary } from './ContentSection';

/** The device's packs, as the registry lists them: Gritty realism applies to Hild alone. */
function registryWithPack(): EntityRegistry {
  const reg = new EntityRegistry();
  reg.setRulePacks([
    { name: 'Gritty realism', source: 'GRIT', appliesTo: { characters: ['hild'] } } as Entity,
  ]);
  return reg;
}

let latest: CharacterDoc | undefined;
let label: unknown;

/** The section over a doc the updater really changes, as the session does. */
function Harness({ initial }: { initial: CharacterDoc }) {
  const [doc, setDoc] = useState(initial);
  const update: DocUpdater = (recipe, named) => {
    label = named;
    const next = structuredClone(doc);
    recipe(next);
    latest = next;
    setDoc(next);
  };
  return (
    <MemoryRouter>
      <ContentSection doc={doc} update={update} registry={registryWithPack()} />
    </MemoryRouter>
  );
}

function character(id: 'hild' | 'maren', switches?: CharacterDoc['sourceSwitches']) {
  const doc = newCharacterDoc(id, id === 'hild' ? 'Hild' : 'Maren', 't');
  if (switches !== undefined) doc.sourceSwitches = switches;
  return doc;
}

function open() {
  const details = screen.getByText('Content').closest('details');
  if (details === null) throw new Error('no section');
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

const summary = () => screen.getByText('Content').nextElementSibling?.textContent;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  latest = undefined;
  label = undefined;
  setHomebrewSourceNames(
    new Map([
      ['MyChanges', 'Changes to the books'],
      ['KIB', 'Kibbles’ Compendium'],
      ['GRIT', 'Gritty realism'],
      ['LC', 'Lantern Coast'],
    ]),
  );
  await homebrewRepo.saveEntry(
    'spell',
    { name: 'Aid', source: 'XPHB', level: 2, entries: ['By 10.'] },
    { role: 'changes' },
  );
  const kib = await homebrewRepo.importJson(
    {
      _meta: { sources: [{ json: 'KIB', full: 'Kibbles’ Compendium' }] },
      spell: [{ name: 'Slow Burn', source: 'KIB', level: 3 }],
    },
    'kibbles.json',
  );
  await homebrewRepo.setEnabled(kib.id, false);
  await homebrewRepo.importJson(
    {
      _meta: { sources: [{ json: 'GRIT', full: 'Gritty realism' }] },
      feat: [{ name: 'Grit', source: 'GRIT' }],
    },
    'gritty.json',
  );
  await homebrewRepo.importJson(
    {
      _meta: { sources: [{ json: 'LC', full: 'Lantern Coast' }] },
      item: [{ name: 'Sea Rope', source: 'LC', type: 'G' }],
    },
    'lantern.json',
  );
});

/** The restore preview's lines from `from` to what the section last wrote. */
const preview = (from: CharacterDoc) =>
  latest === undefined ? [] : diffDocs(from, latest).map((c) => c.line);

afterEach(() => {
  cleanup();
  setHomebrewSourceNames(new Map());
});

describe('the Content row (ADR-002 U11)', () => {
  it("says what this character's switches change, closed and without calling homebrewRepo.listMetaSafe", async () => {
    expect(contentSummary(undefined)).toBe('As this device');
    expect(contentSummary({ off: ['MyChanges'] })).toBe('Changes to the books off');
    expect(contentSummary({ on: ['KIB', 'MyChanges'], off: ['MyChanges'] })).toBe(
      'Changes to the books off, Kibbles’ Compendium on',
    );
    expect(contentSummary({ off: ['A', 'B', 'C'] })).toBe('A off, B off +1 more');
    const listMeta = vi.spyOn(homebrewRepo, 'listMetaSafe');
    try {
      render(
        <MemoryRouter>
          <ContentSection
            doc={character('hild', { off: ['MyChanges'] })}
            update={() => undefined}
            registry={registryWithPack()}
          />
        </MemoryRouter>,
      );
      expect(summary()).toBe('Changes to the books off');
      // Wait a macrotask so an accidentally mounted body's liveQuery timer runs too.
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });
      expect(listMeta).not.toHaveBeenCalled();
    } finally {
      listMeta.mockRestore();
    }
  });

  it('lists each collection with its switch for this character, and no switch for a pack', async () => {
    render(<Harness initial={character('maren')} />);
    open();
    const changes = await screen.findByRole('button', { name: 'Changes to the books for Maren' });
    expect(changes.getAttribute('aria-pressed')).toBe('true');
    const kib = screen.getByRole('button', { name: 'Kibbles’ Compendium for Maren' });
    expect(kib.getAttribute('aria-pressed')).toBe('false');
    expect(kib.closest('li')?.textContent).toContain('Off on this device');
    // The pack's file has no switch here: its review's Apply to is its reach.
    expect(screen.queryByRole('button', { name: /Gritty realism/ })).toBeNull();
    const packs = screen.getByRole('list', {
      name: (_, el) => el.previousElementSibling?.textContent === 'Rule packs',
    });
    expect(within(packs).getByText('Not for Maren')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rules shelf' }).getAttribute('href')).toBe(
      '/workshop/rules',
    );
    expect(screen.getByRole('link', { name: 'The books' }).getAttribute('href')).toBe(
      '/workshop/collection/books',
    );
    expect(namelessControls()).toEqual([]);
  });

  it('turns Changes to the books off for Hild, says what that does, and back', async () => {
    render(<Harness initial={character('hild')} />);
    open();
    expect(await screen.findByText('On for Hild')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Changes to the books for Hild' }));
    expect(latest?.sourceSwitches).toEqual({ off: ['MyChanges'] });
    // History's entry says it as the restore preview does.
    expect(label).toBe('Collections: Changes to the books off');
    expect(summary()).toBe('Changes to the books off');
    // D3's wording: the book's version, not "it leaves her sheet".
    expect(
      screen.getByText("Off: Hild's sheet uses the book's version of each entry it changes."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Changes to the books for Hild' }));
    // No switch left is no field, so the character keys as it did before.
    expect(latest !== undefined && 'sourceSwitches' in latest).toBe(false);
    expect(summary()).toBe('As this device');
  });

  it('turns a collection off on this device on for one character, and every one back', async () => {
    render(<Harness initial={character('maren', { off: ['MyChanges'] })} />);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Kibbles’ Compendium for Maren' }));
    expect(latest?.sourceSwitches).toEqual({ on: ['KIB'], off: ['MyChanges'] });
    fireEvent.click(screen.getByRole('button', { name: 'Kibbles’ Compendium for Maren' }));
    expect(latest?.sourceSwitches).toEqual({ off: ['MyChanges'] });
    // Off on the device as well, its entries leave her view of the data (E4).
    expect(
      screen.getByText(
        "Off: it is off on this device too, so it leaves Maren's pickers and Maren's sheet.",
      ),
    ).toBeTruthy();
    // On on the device, off for her leaves her pickers alone (D3).
    fireEvent.click(screen.getByRole('button', { name: 'Lantern Coast for Maren' }));
    expect(latest?.sourceSwitches).toEqual({ off: ['MyChanges', 'LC'] });
    expect(
      screen.getByText(
        "Off: it leaves Maren's pickers. What is already on Maren's sheet keeps counting.",
      ),
    ).toBeTruthy();
    const before = structuredClone(latest) as CharacterDoc;
    fireEvent.click(screen.getByRole('button', { name: 'Every collection as this device' }));
    expect(latest !== undefined && 'sourceSwitches' in latest).toBe(false);
    expect(label).toBe(
      'Collections: Changes to the books as this device, Lantern Coast as this device',
    );
    expect(preview(before)).toContain(label);
    expect(screen.queryByRole('button', { name: 'Every collection as this device' })).toBeNull();
  });

  it('says an enabled collection hidden by the device policy keeps counting', async () => {
    await writeSourcePolicy({ mode: 'all', except: ['LC'] });
    render(<Harness initial={character('maren')} />);
    open();
    const lc = await screen.findByRole('button', { name: 'Lantern Coast for Maren' });
    expect(lc.getAttribute('aria-pressed')).toBe('false');
    const row = lc.closest('li');
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.textContent).toContain('Hidden in The books');
    expect(
      within(row).getByText(
        "Off: it leaves Maren's pickers. What is already on Maren's sheet keeps counting.",
      ),
    ).toBeTruthy();
    expect(
      within(row).queryByText(
        "Off: it is off on this device too, so it leaves Maren's pickers and Maren's sheet.",
      ),
    ).toBeNull();
  });

  it('clears a switch for a collection no longer on this device', async () => {
    render(<Harness initial={character('maren', { off: ['GONE'] })} />);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Every collection as this device' }));
    expect(latest !== undefined && 'sourceSwitches' in latest).toBe(false);
  });

  it('names a switch in history as the restore preview does', async () => {
    const initial = character('maren', { off: ['MyChanges'] });
    render(<Harness initial={initial} />);
    open();
    // On on the device, so On for her is no switch: as this device.
    fireEvent.click(await screen.findByRole('button', { name: 'Changes to the books for Maren' }));
    expect(latest !== undefined && 'sourceSwitches' in latest).toBe(false);
    expect(label).toBe('Collections: Changes to the books as this device');
    expect(preview(initial)).toContain(label);
  });
});
