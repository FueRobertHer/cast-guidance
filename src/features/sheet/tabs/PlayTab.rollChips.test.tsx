// @vitest-environment jsdom
// What an action's roll chip says it is. The chip's colour is all that tells a
// player whether the dice hurt, heal or do neither.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  testCharacter,
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(async () => {
  await resetSheetHarness();
});

it('draws damage, healing and plain dice each in its own colour', async () => {
  const doc = testCharacter('Hero', [classEntry('Monk', 2)]);
  const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
  doc.customEffects = [
    { origin, kind: 'action', economy: 'action', label: 'Burn', roll: '2d6' },
    { origin, kind: 'action', economy: 'action', label: 'Mend', roll: '3d6', heals: true },
    { origin, kind: 'action', economy: 'bonus', label: 'Boost', roll: '4d6', plainDice: true },
  ];
  await renderSheet(doc);

  const chip = (name: string) => screen.getByRole('button', { name }).className;
  expect(chip('2d6')).toContain('text-danger');
  expect(chip('3d6')).toContain('text-heal');
  expect(chip('4d6')).toContain('text-roll');
});

it('says the save an action forces, and its DC only when it has one', async () => {
  const doc = testCharacter('Hero', [classEntry('Monk', 2)]);
  const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
  doc.customEffects = [
    {
      origin,
      kind: 'action',
      economy: 'bonus',
      label: 'Glare',
      save: { targetAbility: 'wis', dcAbility: 'wis' },
    },
    { origin, kind: 'action', economy: 'reaction', label: 'Shove', save: { targetAbility: 'str' } },
  ];
  await renderSheet(doc);

  expect(screen.getByText(/^DC \d+ WIS save$/)).toBeTruthy();
  expect(screen.getByText('STR save')).toBeTruthy();
});
