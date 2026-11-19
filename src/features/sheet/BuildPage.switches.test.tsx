// @vitest-environment jsdom
// ADR-002 E2: the Build page's pickers read the character's collection
// switches as well as its source list. A source switched off for this
// character leaves its class, subclass, species, subrace and background
// pickers; the same page without the switch offers it.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, type EngineContext, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { Component as BuildPage } from './BuildPage';
import type { CharacterSheetState } from './useCharacterSheet';

/** Entities layered over the shared test world for one test. */
const extra = vi.hoisted(() => ({ current: [] as Array<[string, Record<string, unknown>]> }));

vi.mock('@/data5e/hooks', () => ({
  useRegistryRefreshing: () => false,
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
  useRegistry: () => layeredWorld(),
}));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));
vi.mock('@/ui/dialogs', () => ({
  askConfirm: () => Promise.resolve(false),
  askText: () => Promise.resolve(null),
  askChoice: () => Promise.resolve(null),
}));

function layeredWorld() {
  const base = makeTestContext();
  return {
    get: (type: string, name: string, source?: string) =>
      extra.current.find(
        ([t, e]) =>
          t === type &&
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      )?.[1] ?? base.get(type as never, name, source),
    byType: (type: string) => [
      ...extra.current.filter(([t]) => t === type).map(([, e]) => e),
      ...base.byType(type as never),
    ],
  };
}

afterEach(() => {
  cleanup();
  extra.current = [];
});

function renderBuild(sourceSwitches?: CharacterDoc['sourceSwitches']) {
  const doc = newCharacterDoc('b1', 'Osk', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.background = { name: 'Scholar', source: 'TST' };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  if (sourceSwitches !== undefined) doc.sourceSwitches = sourceSwitches;
  const sheet = deriveSheet(doc, layeredWorld() as unknown as EngineContext);
  const ctx = {
    doc,
    sheet,
    update: () => undefined,
    restore: () => undefined,
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    retryLoad: () => undefined,
  } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={ctx} />,
      children: [{ index: true, element: <BuildPage /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
}

describe("BuildPage under a character's collection switches", () => {
  // One entity per picker from a source the switch turns off.
  const switchedOff: Array<[string, string, Record<string, unknown>]> = [
    ['class', 'Outrider', { name: 'Outrider', source: 'OUT' }],
    [
      'subclass',
      'Path of Elsewhere',
      {
        name: 'Path of Elsewhere',
        shortName: 'Elsewhere',
        source: 'OUT',
        className: 'Warrior',
        classSource: 'TST',
      },
    ],
    ['race', 'Outfolk', { name: 'Outfolk', source: 'OUT' }],
    ['subrace', 'Far Testfolk', { name: 'Far Testfolk', source: 'OUT', raceName: 'Testfolk' }],
    ['background', 'Outlander', { name: 'Outlander', source: 'OUT' }],
  ];

  it.each(switchedOff)('passes the switches to the %s picker', (type, name, entity) => {
    extra.current = [
      [type, entity],
      // A subrace no switch names, so the subrace picker has something to show.
      ['subrace', { name: 'Near Testfolk', source: 'TST', raceName: 'Testfolk' }],
    ];
    renderBuild({ off: ['OUT'] });
    expect(screen.queryByRole('button', { name, hidden: true })).toBeNull();
    // A source no switch names still shows: "everything except these".
    expect(screen.queryByRole('button', { name: 'Near Testfolk', hidden: true })).not.toBeNull();
    cleanup();

    // Another character on the same device, with no switches, is offered it.
    renderBuild();
    expect(screen.queryByRole('button', { name, hidden: true })).not.toBeNull();
  });
});
