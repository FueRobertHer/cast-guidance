// @vitest-environment jsdom
// GAME-005: a character's own source list narrows the spells it can learn from,
// in place of this device's settings, and a spell already on the sheet from a
// book outside that list stays, labelled in words.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DerivedSheet, newCharacterDoc, type SpellcastingBlock } from '@/engine/types';
import { SpellManager } from './SpellManager';

const onWizardList = { fromClassList: [{ name: 'Wizard', source: 'PHB' }] };
const SPELLS = [
  { name: 'Fire Bolt', source: 'PHB', level: 0, classes: onWizardList },
  { name: 'Toll the Dead', source: 'XGE', level: 0, classes: onWizardList },
  { name: 'Shield', source: 'PHB', level: 1, classes: onWizardList },
  { name: 'Absorb Elements', source: 'XGE', level: 1, classes: onWizardList },
];

vi.mock('@/data5e/hooks', () => ({
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
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));
vi.mock('@/data5e/spellLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: () => Promise.resolve({}),
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/sourceFilter')>();
  return { ...real, useSourcePolicy: () => real.ALLOW_ALL };
});

afterEach(cleanup);

const wizard = {
  classUid: 'wizard|phb',
  className: 'Wizard',
  ability: 'int',
  mode: 'spellbook',
  saveDc: { value: 13 },
  attackMod: { value: 5 },
  slots: [2],
} as SpellcastingBlock;

function renderSpells(allowedSources: string[]) {
  const doc = newCharacterDoc('c1', 'Caster', 't');
  doc.allowedSources = allowedSources;
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
