// @vitest-environment jsdom
// GAME-005: a character's own source list narrows the spells it can learn from,
// in place of this device's settings, and a spell already on the sheet from a
// book outside that list stays, labelled in words.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CharacterDoc,
  type DerivedSheet,
  newCharacterDoc,
  type SpellcastingBlock,
} from '@/engine/types';
import { SpellManager } from './SpellManager';

const onWizardList = { fromClassList: [{ name: 'Wizard', source: 'PHB' }] };
const SPELLS = [
  { name: 'Fire Bolt', source: 'PHB', level: 0, classes: onWizardList },
  { name: 'Toll the Dead', source: 'XGE', level: 0, classes: onWizardList },
  { name: 'Shield', source: 'PHB', level: 1, classes: onWizardList },
  { name: 'Absorb Elements', source: 'XGE', level: 1, classes: onWizardList },
];

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
  useRegistry: () => ({
    get: (_type: string, name: string, source?: string) =>
      SPELLS.find(
        (s) =>
          s.name.toLowerCase() === name.toLowerCase() &&
          (source === undefined || s.source.toLowerCase() === source.toLowerCase()),
      ),
    byType: () => SPELLS,
  }),
}));
vi.mock('@/data5e/spellLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: () => Promise.resolve({}),
}));
const device = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/sourceFilter')>();
  return { ...real, useSourcePolicy: () => device.current ?? real.ALLOW_ALL };
});

afterEach(() => {
  cleanup();
  device.current = undefined;
});

const wizard = {
  classUid: 'wizard|phb',
  className: 'Wizard',
  ability: 'int',
  mode: 'spellbook',
  saveDc: { value: 13 },
  attackMod: { value: 5 },
  slots: [2],
} as SpellcastingBlock;

function renderSpells(allowedSources: string[], sourceSwitches?: CharacterDoc['sourceSwitches']) {
  const doc = newCharacterDoc('c1', 'Caster', 't');
  doc.allowedSources = allowedSources;
  if (sourceSwitches !== undefined) doc.sourceSwitches = sourceSwitches;
  doc.spellcasting = {
    'wizard|phb': { known: [{ name: 'Absorb Elements', source: 'XGE' }], prepared: [] },
  };
  const sheet = {
    spellcasting: [wizard],
    grantedSpells: [],
    totalLevel: 1,
    resources: [],
  } as unknown as DerivedSheet;
  render(
    <MemoryRouter>
      <SpellManager doc={doc} sheet={sheet} update={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("SpellManager under a character's own sources (GAME-005)", () => {
  it("offers only the character's books to learn from, and keeps what it knows", async () => {
    renderSpells(['PHB']);
    await waitFor(() => expect(screen.queryByText('Fire Bolt')).not.toBeNull());
    expect(screen.queryByText('Toll the Dead')).toBeNull();
    expect(screen.queryByText(/1 spell outside this character's sources/)).not.toBeNull();
    // Already known from a book outside the list: still there, and labelled.
    expect(screen.queryByText('Absorb Elements')).not.toBeNull();
    expect(screen.getAllByText("Not in this character's sources")).toHaveLength(1);
  });
});

describe("SpellManager under a character's collection switches (ADR-002 E2)", () => {
  it('drops a source switched off, keeping what the character already knows from it', async () => {
    renderSpells([], { off: ['XGE'] });
    await waitFor(() => expect(screen.queryByText('Fire Bolt')).not.toBeNull());
    expect(screen.queryByText('Toll the Dead')).toBeNull();
    expect(screen.queryByText(/1 spell outside this character's sources/)).not.toBeNull();
    expect(screen.queryByText('Absorb Elements')).not.toBeNull();
  });

  it('names both when the device hides a book and a switch another (ADR-002 U11)', async () => {
    device.current = { mode: 'all', except: ['PHB'] };
    renderSpells([], { off: ['XGE'] });
    await waitFor(() => expect(screen.queryByText('Absorb Elements')).not.toBeNull());
    expect(
      screen.queryByText(
        /^\d+ spells? hidden by your source settings and this character's switches\. Show them anyway$/,
      ),
    ).not.toBeNull();
    // Known from a book her switch hides, it says so as under her own list.
    expect(screen.getAllByText("Not in this character's sources")).toHaveLength(1);
  });

  it('lets a source switched on in over its own list', async () => {
    renderSpells(['PHB'], { on: ['XGE'] });
    await waitFor(() => expect(screen.queryByText('Fire Bolt')).not.toBeNull());
    expect(screen.queryByText('Toll the Dead')).not.toBeNull();
    expect(screen.queryByText(/outside this character's sources/)).toBeNull();
  });
});
