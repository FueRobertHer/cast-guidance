// @vitest-environment jsdom
// A homebrew class lists the installed spells it can learn itself
// (`classSpells`, `subclassSpells`), as a converted Fight Club class does: the
// spells carry no class list naming it, and the generated lookup has none.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DerivedSheet, newCharacterDoc, type SpellcastingBlock } from '@/engine/types';
import { SpellManager } from './SpellManager';

const ENTITIES: Record<string, Record<string, unknown>[]> = {
  spell: [
    { name: 'Fire Bolt', source: 'PHB', level: 0 },
    { name: 'Shield', source: 'PHB', level: 1 },
    { name: 'Alarm', source: 'PHB', level: 1 },
  ],
  class: [{ name: 'Witch', source: 'HB', classSpells: ['fire bolt|phb'] }],
  subclass: [
    {
      name: 'Coven of Wards',
      shortName: 'Wards',
      className: 'Witch',
      classSource: 'HB',
      subclassSpells: ['alarm|phb'],
    },
  ],
};

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
  useRegistry: () => ({
    get: (type: string, name: string, source?: string) =>
      (ENTITIES[type] ?? []).find(
        (s) =>
          String(s.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(s.source).toLowerCase() === source.toLowerCase()),
      ),
    byType: (type: string) => ENTITIES[type] ?? [],
  }),
}));
vi.mock('@/data5e/spellLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: () => Promise.resolve({}),
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/sourceFilter')>();
  return { ...real, useSourcePolicy: () => real.ALLOW_ALL };
});

afterEach(cleanup);

function renderWitch(block: Partial<SpellcastingBlock>) {
  const doc = newCharacterDoc('c1', 'Hex', 't');
  doc.spellcasting = { 'witch|hb': { known: [], prepared: [] } };
  const witch = {
    classUid: 'witch|hb',
    className: 'Witch',
    ability: 'cha',
    mode: 'known',
    saveDc: { value: 13 },
    attackMod: { value: 5 },
    slots: [2],
    ...block,
  } as SpellcastingBlock;
  const sheet = {
    spellcasting: [witch],
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

describe('SpellManager with a class that lists its own spells', () => {
  it('offers the installed spells a homebrew class lists, and only those', async () => {
    renderWitch({});
    await waitFor(() => expect(screen.queryByText('Fire Bolt')).not.toBeNull());
    expect(screen.queryByText('Shield')).toBeNull();
    expect(screen.queryByText('Alarm')).toBeNull();
  });

  it('offers a subclass caster the spells its homebrew subclass lists', async () => {
    renderWitch({
      fromSubclass: { className: 'Witch', shortName: 'Wards' },
    } as Partial<SpellcastingBlock>);
    await waitFor(() => expect(screen.queryByText('Alarm')).not.toBeNull());
    expect(screen.queryByText('Shield')).toBeNull();
  });
});
