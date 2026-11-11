// @vitest-environment jsdom
// The build's advantage on concentration and death saves (War Caster, 2024
// Durable) reaches the Play tab's rolls through the sheet's riders.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import {
  type CharacterDoc,
  type DataEntity,
  type EngineContext,
  newCharacterDoc,
} from '@/engine/types';
import { heldRollStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => makeTestContext(),
  useRegistryRefreshing: () => false,
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
}));

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
  heldRollStore.setState({ held: null });
  vi.restoreAllMocks();
});

// Two feats the table names, with placeholder prose, beside the synthetic world.
const FEATS: DataEntity[] = [
  { name: 'War Caster', source: 'PHB', entries: ['Placeholder text.'] },
  { name: 'Durable', source: 'XPHB', entries: ['Placeholder text.'] },
];
const world = makeTestContext();
const ctx: EngineContext = {
  get: (type, name, source) =>
    type === 'feat'
      ? FEATS.find(
          (f) =>
            String(f.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(f.source).toLowerCase() === source.toLowerCase()),
        )
      : world.get(type, name, source),
  byType: (type) => (type === 'feat' ? FEATS : world.byType(type)),
};

/** The Play tab for a level 3 Warrior with `feat`, its play state set by `play`. */
function renderPlay(feat: string | undefined, play: (doc: CharacterDoc, maxHp: number) => void) {
  const doc = newCharacterDoc('p1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  const ref = FEATS.find((f) => f.name === feat);
  if (ref !== undefined) {
    doc.feats = [{ ref: { name: String(ref.name), source: String(ref.source) }, instanceId: 'f0' }];
  }
  const sheet = deriveSheet(doc, ctx);
  doc.play.hpInitialized = true;
  play(doc, sheet.maxHp.value);
  const value = {
    doc,
    sheet,
    // Damage rolls the concentration save inside the update, so it runs here.
    update: (recipe: (d: CharacterDoc) => void) => recipe(structuredClone(doc)),
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    retryLoad: () => undefined,
  } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={value} />,
      children: [{ index: true, element: <PlayTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
}

const lastRoll = (label: RegExp) =>
  rollLogStore
    .getState()
    .rolls.filter((r) => label.test(r.label ?? ''))
    .at(-1);

describe('the build’s advantage on concentration and death saves', () => {
  const concentrating = (feat?: string) => {
    renderPlay(feat, (doc, maxHp) => {
      doc.play.currentHp = maxHp;
      doc.play.concentratingOn = { label: 'Bless' };
    });
    fireEvent.click(screen.getByLabelText('Damage 5 hit points'));
    return lastRoll(/Concentration save/)?.meta?.advantage;
  };

  it('rolls a concentration save with advantage from War Caster', () => {
    expect(concentrating('War Caster')).toBe('adv');
  });

  it('gives no advantage without it, nor from Durable', () => {
    expect(concentrating()).toBeUndefined();
    cleanup();
    expect(concentrating('Durable')).toBeUndefined();
  });

  const deathSave = (feat?: string) => {
    renderPlay(feat, (doc) => {
      doc.play.currentHp = 0;
    });
    // The first tap asks; the second rolls.
    fireEvent.click(screen.getByRole('button', { name: 'Roll save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll save' }));
    return lastRoll(/Death save/)?.meta?.advantage;
  };

  it('rolls a death save with advantage from 2024 Durable', () => {
    expect(deathSave('Durable')).toBe('adv');
  });

  it('gives a death save no advantage from War Caster', () => {
    expect(deathSave('War Caster')).toBeUndefined();
  });
});
