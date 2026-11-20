// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// ADR-002 U11's done-when, board 11: with Changes to the books off for Hild,
// her Content row says so and her Aid shows the book's; Maren's Aid shows
// Changed, and one tap shows the book's. The feature and item sheets carry
// the same badge. The registry is the real one's build of a small release
// with Changes to the books stored over it; the characters come through the
// real session, database and sheet layout, which gives each its own view.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useOutletContext } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { setHomebrewSourceNames } from '@/data5e/sourceNames';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { writeChange } from '@/features/workshop/copyWriter';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
import { FeatureInfoSheet, findFeatureInfo } from '@/ui/FeatureInfoSheet';
import { Component as BuildPage } from './BuildPage';
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

const BOOK_AID = 'Each target’s Hit Point maximum and current Hit Points increase by 5.';
const TABLE_AID = BOOK_AID.replace('5', '10');
const BOOK_ROPE = 'A rope of 60 feet.';

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
          entries: ['Choose up to three creatures within range.', BOOK_AID],
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
  ['items.json', { item: [{ name: 'Rope', source: 'XPHB', type: 'G', entries: [BOOK_ROPE] }] }],
]);

/** The shared registry: the release with Aid at +10, Rage with 2 more HP a level, and a longer Rope. */
function registryWithChanges(): EntityRegistry {
  const reg = normalizeDataset(RELEASE);
  const book = (type: string, name: string) =>
    structuredClone(reg.byType(type as never).find((e) => e.name === name) as Entity);
  const aid = book('spell', 'Aid');
  const rage = book('classFeature', 'Rage');
  const rope = book('item', 'Rope');
  const changes = {
    _meta: { sources: [{ json: 'MyChanges', full: 'Changes to the books' }] },
    spell: [
      writeChange('spell', aid, {
        ...aid,
        entries: [(aid.entries as string[])[0], TABLE_AID],
        castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount: 10 }] },
      }),
    ],
    classFeature: [
      writeChange('classFeature', rage, {
        ...rage,
        castGuidance: { v: 1, effects: [{ kind: 'hpPerLevel', amount: 2 }] },
      }),
    ],
    item: [writeChange('item', rope, { ...rope, entries: ['A rope of 90 feet.'] })],
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

/** A tab drawing Aid's, Rage's and the Rope's info sheets, as the Play tab and inventory do. */
function Probe() {
  const { doc, sheet } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry();
  if (doc === null || sheet === null || registry === null) return null;
  const rage = findFeatureInfo(sheet.features, 'Rage');
  const rope = registry.get('item', 'Rope', 'XPHB');
  return (
    <>
      <p>Max HP {sheet.maxHp.value}</p>
      <SpellInfoSheet
        name="Aid"
        source="XPHB"
        version="2024"
        trigger={<button type="button">Open the spell</button>}
      />
      {rage !== undefined && (
        <FeatureInfoSheet
          title={rage.title}
          entries={rage.entries}
          trigger={<button type="button">Open the feature</button>}
        />
      )}
      {rope !== undefined && (
        <EntityInfoSheet
          type="item"
          entity={rope}
          trigger={<button type="button">Open the item</button>}
        />
      )}
      {/* As a subclass's sheet shows its features' text in its own place. */}
      {rope !== undefined && (
        <EntityInfoSheet
          type="item"
          entity={rope}
          entriesOverride={['Text the caller wrote.']}
          trigger={<button type="button">Open the item's own text</button>}
        />
      )}
    </>
  );
}

async function visit(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/c/:id',
        element: <SheetLayout />,
        children: [
          { index: true, element: <Probe /> },
          { path: 'build', element: <BuildPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

async function openSheet(trigger: string) {
  await screen.findByText(/^Max HP/);
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  return screen.findByRole('dialog');
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  live.registry = registryWithChanges();
  setHomebrewSourceNames(new Map([['MyChanges', 'Changes to the books']]));
  await characterRepo.put(
    barbarian('hild', (d) => {
      d.sourceSwitches = { off: ['MyChanges'] };
    }),
  );
  await characterRepo.put(barbarian('maren'));
});

afterEach(() => {
  cleanup();
  setHomebrewSourceNames(new Map());
});

describe('the Changed badge and the Content row (ADR-002 U11)', () => {
  it('says on Hild’s Content row that Changes to the books are off', async () => {
    await visit('/c/hild/build');
    const row = await screen.findByText('Content');
    expect(row.nextElementSibling?.textContent).toBe('Changes to the books off');
    cleanup();
    await visit('/c/maren/build');
    expect((await screen.findByText('Content')).nextElementSibling?.textContent).toBe(
      'As this device',
    );
  });

  it('shows Hild the book’s Aid, with no Changed badge', async () => {
    await visit('/c/hild');
    const sheet = await openSheet('Open the spell');
    expect(await within(sheet).findByText(BOOK_AID)).toBeTruthy();
    expect(within(sheet).queryByText('Changed')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /version/ })).toBeNull();
  });

  it('shows Maren’s Aid as Changed, and the book’s one tap away', async () => {
    await visit('/c/maren');
    const sheet = await openSheet('Open the spell');
    expect(await within(sheet).findByText(TABLE_AID)).toBeTruthy();
    expect(within(sheet).getByText('Changed')).toBeTruthy();
    expect(
      within(sheet).getByText(/from Changes to the books\. The sheet counts this one\./),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show the book’s version' }));
    expect(within(sheet).getByText(BOOK_AID)).toBeTruthy();
    expect(within(sheet).queryByText(TABLE_AID)).toBeNull();
    expect(within(sheet).getByText(/Your table plays the changed one\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show your table’s version' }));
    expect(within(sheet).getByText(TABLE_AID)).toBeTruthy();
  });

  it.each([
    'Open the spell',
    'Open the feature',
    'Open the item',
  ])('opens again on the table’s version after the book’s was shown (%s)', async (trigger) => {
    await visit('/c/maren');
    let sheet = await openSheet(trigger);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show the book’s version' }));
    expect(within(sheet).getByRole('button', { name: 'Show your table’s version' })).toBeTruthy();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    sheet = await openSheet(trigger);
    expect(within(sheet).getByText(/Your table's version/)).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Show the book’s version' })).toBeTruthy();
    if (trigger === 'Open the spell') expect(within(sheet).getByText(TABLE_AID)).toBeTruthy();
  });

  it('offers no book’s version where the sheet shows text its caller wrote', async () => {
    await visit('/c/maren');
    const sheet = await openSheet("Open the item's own text");
    expect(within(sheet).getByText('Changed')).toBeTruthy();
    expect(within(sheet).getByText(/from Changes to the books/)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /version/ })).toBeNull();
  });

  it('marks Maren’s Rage Changed, its words the book’s, and Hild’s not', async () => {
    await visit('/c/maren');
    const sheet = await openSheet('Open the feature');
    expect(within(sheet).getByText('Changed')).toBeTruthy();
    expect(within(sheet).getByText(/The words are the same/)).toBeTruthy();
    cleanup();
    await visit('/c/hild');
    const hilds = await openSheet('Open the feature');
    expect(within(hilds).getByText(/primal power called Rage/)).toBeTruthy();
    expect(within(hilds).queryByText('Changed')).toBeNull();
  });

  it('marks Maren’s Rope Changed, with the book’s one tap away, and Hild’s not', async () => {
    await visit('/c/maren');
    const sheet = await openSheet('Open the item');
    expect(within(sheet).getByText('Changed')).toBeTruthy();
    expect(within(sheet).getByText('A rope of 90 feet.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show the book’s version' }));
    await waitFor(() => expect(within(sheet).getByText(BOOK_ROPE)).toBeTruthy());
    cleanup();
    await visit('/c/hild');
    const hilds = await openSheet('Open the item');
    expect(within(hilds).getByText(BOOK_ROPE)).toBeTruthy();
    expect(within(hilds).queryByText('Changed')).toBeNull();
  });
});
