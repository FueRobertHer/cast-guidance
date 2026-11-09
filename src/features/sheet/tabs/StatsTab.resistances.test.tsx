// @vitest-environment jsdom
// The Stats tab's Defenses section names each damage type once, however many
// sources give it, and a save an effect in play raised is ringed.
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
    {
      id: 'e1',
      ref: { name: 'Ring of Embers', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
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
  expect(screen.getByText('Resists').parentElement?.textContent).toBe('Resists fire, cold');
});

it('rings every save an effect in play raised, naming it, and says when there are no defenses', () => {
  const ctx: EngineContext = { get: () => undefined, byType: () => [] };
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.play.activeEffects = [
    { id: 'aura', name: 'Aura of Protection', parts: [{ kind: 'saveBonus', amount: 3 }] },
  ];
  const sheet = deriveSheet(doc, ctx);
  const built = deriveSheet(doc, ctx, { active: false });
  const context = { doc, sheet, built, update: () => undefined } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={context} />,
      children: [{ index: true, element: <StatsTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  const saves = screen.getAllByRole('button', { name: /raised by Aura of Protection/ });
  // The six saves, and no ability check, which the aura does not reach.
  expect(saves.map((b) => b.textContent?.slice(0, 3))).toEqual([
    'STR',
    'DEX',
    'CON',
    'INT',
    'WIS',
    'CHA',
  ]);
  for (const save of saves) expect(save.querySelector('.cx-lifted')).not.toBeNull();
  expect(screen.getByText('None yet.')).toBeTruthy();
});
