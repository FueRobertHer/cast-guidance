// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// The sheet layout gives everything it draws the character's own view of the
// registry (ADR-002, D3): with Changes to the books off, Hild's sheet, her
// Aid's info sheet and her + Effect read the book's Aid, and Maren's read the
// change. The registry is the real one's build of a small release; the
// character comes through the real session and database.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useOutletContext } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { writeChange } from '@/features/workshop/copyWriter';
import EffectFinder from './EffectFinder';
import { Component as SheetLayout } from './SheetLayout';
import { SpellInfoSheet } from './SpellInfoSheet';
import type { CharacterSheetState } from './useCharacterSheet';

// vaul reads this on close and jsdom does not provide it.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

const live = vi.hoisted(() => ({ registry: null as unknown }));

vi.mock('@/data5e/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/registry')>()),
  getRegistry: async () => live.registry,
  ensureRegistry: async () => live.registry,
}));
vi.mock('@/data5e/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/loader')>()),
  ensureTypePacks: async () => undefined,
  ensureCharacterPacks: async () => undefined,
}));
vi.mock('./useOpenElsewhere', () => ({ useOpenElsewhere: () => false }));
vi.mock('./HistoryDrawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));

const AID_TEXT = 'Each target’s Hit Point maximum and current Hit Points increase by 5.';

const RELEASE = new Map<string, unknown>([
  [
    'spells/spells-xphb.json',
    {
      spell: [
        {
          name: 'Aid',
          source: 'XPHB',
          level: 2,
          school: 'A',
          time: [{ number: 1, unit: 'action' }],
          range: { type: 'point', distance: { type: 'feet', amount: 30 } },
          duration: [{ type: 'timed', duration: { type: 'hour', amount: 8 } }],
          entries: ['Choose up to three creatures within range.', AID_TEXT],
        },
      ],
    },
  ],
  [
    'class/class-barbarian.json',
    {
      class: [
        {
          name: 'Barbarian',
          source: 'XPHB',
          edition: 'one',
          hd: { number: 1, faces: 12 },
          proficiency: ['str', 'con'],
          classFeatures: ['Rage|Barbarian|XPHB|1'],
        },
      ],
      classFeature: [
        {
          name: 'Rage',
          source: 'XPHB',
          className: 'Barbarian',
          classSource: 'XPHB',
          level: 1,
          entries: ['You can imbue yourself with a primal power called Rage.'],
        },
      ],
    },
  ],
]);

/** The shared registry: the release with Aid at +10 and Rage at 2 more HP a level. */
function registryWithChanges(): EntityRegistry {
  const reg = normalizeDataset(RELEASE);
  const aid = structuredClone(reg.get('spell', 'Aid', 'XPHB') as Entity);
  const rage = structuredClone(reg.byType('classFeature').find((f) => f.name === 'Rage') as Entity);
  const changes = {
    _meta: { sources: [{ json: 'MyChanges' }] },
    spell: [
      writeChange('spell', aid, {
        ...aid,
        entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
        castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount: 10 }] },
      }),
    ],
    classFeature: [
      writeChange('classFeature', rage, {
        ...rage,
        castGuidance: { v: 1, effects: [{ kind: 'hpPerLevel', amount: 2 }] },
      }),
    ],
  };
  mergeHomebrew(reg, new Map([['changes', changes]]), new Map(), new Set(['changes']));
  return reg;
}

function barbarian(id: string, edit: (d: CharacterDoc) => void = () => undefined): CharacterDoc {
  const doc = newCharacterDoc(id, id === 'hild' ? 'Hild' : 'Maren', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.classes = [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
  edit(doc);
  return doc;
}

const noop = () => undefined;

/** A tab drawing the spell's info sheet, + Effect searching for it, and the sheet's HP. */
function Probe() {
  const { doc, sheet } = useOutletContext<CharacterSheetState>();
  if (doc === null || sheet === null) return null;
  return (
    <>
      <p>Max HP {sheet.maxHp.value}</p>
      <SpellInfoSheet
        name="Aid"
        source="XPHB"
        version="2024"
        trigger={<button type="button">Open the spell</button>}
      />
      <EffectFinder
        doc={doc}
        sheet={sheet}
        query="Aid"
        picked={null}
        onPick={noop}
        onAdd={noop}
        describing={null}
        onDescribe={noop}
        onForget={noop}
      />
    </>
  );
}

async function open(id: string) {
  const router = createMemoryRouter(
    [{ path: '/c/:id', element: <SheetLayout />, children: [{ index: true, element: <Probe /> }] }],
    { initialEntries: [`/c/${id}`] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText(/^Max HP/);
  fireEvent.click(screen.getByRole('button', { name: 'Open the spell' }));
  await screen.findByText(/^Each target’s Hit Point maximum/);
}

/** How many of + Effect's results are an Aid: the catalog's, and the change's if it lands one. */
const aidResults = () => screen.getAllByText('Aid', { selector: 'button *, button' }).length;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  live.registry = registryWithChanges();
  await characterRepo.put(
    barbarian('hild', (d) => {
      d.sourceSwitches = { off: ['MyChanges'] };
    }),
  );
  await characterRepo.put(barbarian('maren'));
});

afterEach(() => {
  cleanup();
});

describe('the sheet layout’s view of the registry', () => {
  it('gives Hild, with Changes to the books off, the book’s Aid and Rage', async () => {
    await open('hild');
    expect(screen.getByText('Max HP 14')).toBeTruthy();
    expect(screen.getByText(AID_TEXT)).toBeTruthy();
    expect(screen.queryByText(/increase by 10/)).toBeNull();
    await waitFor(() => expect(aidResults()).toBe(1));
  });

  it('gives Maren the changes', async () => {
    await open('maren');
    expect(screen.getByText('Max HP 16')).toBeTruthy();
    expect(screen.getByText(/increase by 10/)).toBeTruthy();
    await waitFor(() => expect(aidResults()).toBe(2));
  });
});
