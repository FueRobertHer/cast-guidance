// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// ADR-002 U11, board 11: the Build page's Content row. It reads the stored
// collections and this device's choice, shows this character's switch for
// each, and writes the character's `sourceSwitches` through the doc updater
// (so history and undo come free). A rule pack gets no switch.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import { setHomebrewSourceNames } from '@/data5e/sourceNames';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
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

/** The section over a doc the updater really changes, as the session does. */
function Harness({ initial }: { initial: CharacterDoc }) {
  const [doc, setDoc] = useState(initial);
  const update: DocUpdater = (recipe) => {
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
  setHomebrewSourceNames(
    new Map([
      ['MyChanges', 'Changes to the books'],
      ['KIB', 'Kibbles’ Compendium'],
      ['GRIT', 'Gritty realism'],
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
});

afterEach(() => {
  cleanup();
  setHomebrewSourceNames(new Map());
});

describe('the Content row (ADR-002 U11)', () => {
  it("says what this character's switches change, closed and without reading anything", () => {
    expect(contentSummary(undefined)).toBe('As this device');
    expect(contentSummary({ off: ['MyChanges'] })).toBe('Changes to the books off');
    expect(contentSummary({ on: ['KIB', 'MyChanges'], off: ['MyChanges'] })).toBe(
      'Changes to the books off, Kibbles’ Compendium on',
    );
    expect(contentSummary({ off: ['A', 'B', 'C'] })).toBe('A off, B off +1 more');
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
    expect(
      screen.getByText(
        "Off: it leaves Maren's pickers. What is already on Maren's sheet keeps counting.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Every collection as this device' }));
    expect(latest !== undefined && 'sourceSwitches' in latest).toBe(false);
    expect(screen.queryByRole('button', { name: 'Every collection as this device' })).toBeNull();
  });
});
