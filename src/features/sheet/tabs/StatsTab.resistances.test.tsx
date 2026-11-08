// @vitest-environment jsdom
// The Resistances line names each damage type once, however many sources give it.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import type { EngineContext } from '@/engine/types';
import { newCharacterDoc } from '@/engine/types';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as StatsTab } from './StatsTab';

afterEach(cleanup);

it('names fire once when a species and a ring both resist it', () => {
  const species = { name: 'Emberkin', source: 'TST', resist: ['fire'] };
  const ring = { name: 'Ring of Embers', source: 'TST', type: 'RG', resist: ['fire', 'cold'] };
  const ctx: EngineContext = {
    get: (type) => (type === 'race' ? species : type === 'item' ? ring : undefined),
    byType: () => [],
  };
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.race = { name: 'Emberkin', source: 'TST' };
  doc.equipment = [
    { id: 'e1', ref: { name: 'Ring of Embers', source: 'TST' }, qty: 1, equipped: true, attuned: false },
  ];
  const sheet = deriveSheet(doc, ctx);
  expect(sheet.resists).toHaveLength(3);
  const context = { doc, sheet, update: () => undefined } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={context} />,
      children: [{ index: true, element: <StatsTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  expect(screen.getByText('Resistances:').parentElement?.textContent).toBe(
    'Resistances: fire, cold',
  );
});
