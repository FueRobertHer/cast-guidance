// @vitest-environment jsdom
// A11Y-002: the sheet's small controls (pips, HP and exhaustion steppers, pool
// steppers, death saves, Build's level and ability steppers) get a thumb-sized
// target. jsdom has no layout, so this only checks that each one carries the
// sizing class: a regression guard for someone shrinking one back. The E2E
// check (e2e/a11y/target-size.spec.ts) measures the real boxes.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import { Component as BuildPage } from '../BuildPage';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';
import { Component as StatsTab } from './StatsTab';

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => makeTestContext(),
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
}));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));
vi.mock('@/ui/dialogs', () => ({
  askChoice: () => Promise.resolve(null),
  askConfirm: () => Promise.resolve(false),
  askNumber: () => Promise.resolve(null),
  askText: () => Promise.resolve(null),
}));

afterEach(cleanup);

const PAGES = { play: <PlayTab />, build: <BuildPage />, stats: <StatsTab /> };

/**
 * A level 13 sorcerer: slots draw pips, and 13 sorcery points is past the
 * twelve pips can show, so the pool gets its stepper.
 */
function render13(page: 'play' | 'build' | 'stats', hp?: number) {
  const doc = newCharacterDoc('t1', 'Sparks', 't');
  doc.abilities.method = 'manual';
  doc.classes = [
    { ref: { name: 'Sorcerer', source: 'TST' }, levels: 13, hp: Array(13).fill('avg') },
  ];
  const sheet = deriveSheet(doc, makeTestContext());
  doc.play.currentHp = hp ?? sheet.maxHp.value;
  doc.play.hpInitialized = true;
  doc.play.conditions = [{ id: 'exhaustion', level: 1 }];
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
      children: [{ index: true, element: PAGES[page] }],
    },
  ]);
  render(<RouterProvider router={router} />);
}

/** Buttons named like `pattern`, with whether each one is at least 44px tall. */
function sized(pattern: RegExp) {
  return screen.getAllByRole('button', { name: pattern }).map((b) => {
    const classes = b.className.split(' ');
    return {
      name: b.getAttribute('aria-label') ?? '',
      // h-12 is the 48px ±1 HP pair, which was already big enough.
      big: ['tap', 'h-11', 'h-12'].some((c) => classes.includes(c)),
    };
  });
}

describe('touch targets (A11Y-002)', () => {
  it('sizes every Play stepper, pip and slot for a thumb', () => {
    render13('play');
    const rows = sized(/^(Damage|Heal) \d|slot \d|exhaustion$|^(Spend|Restore) \d/);
    // Every kind is present, so a renamed control cannot drop out unnoticed.
    const names = rows.map((r) => r.name).join('\n');
    for (const kind of [
      /Damage 5/,
      /Heal 5/,
      /Decrease exhaustion/,
      /Restore 5/,
      /Spend 1/,
      /Level 1 slot 1/,
    ]) {
      expect(names).toMatch(kind);
    }
    expect(rows.filter((r) => !r.big)).toEqual([]);
  });

  it('sizes the death saves for a thumb, at 0 HP', () => {
    render13('play', 0);
    const rows = sized(/^Death save (success|fail) \d$/);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => !r.big)).toEqual([]);
  });

  it('sizes the Build level and ability steppers for a thumb', () => {
    render13('build');
    const rows = sized(/^Remove a .* level$|^(Decrease|Increase) [A-Z]{3}$/);
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Remove a Sorcerer level', 'Decrease STR', 'Increase CHA']),
    );
    expect(rows.filter((r) => !r.big)).toEqual([]);
  });

  it('sizes the Stats ability score buttons for a thumb (A11Y-003)', () => {
    render13('stats');
    const rows = sized(/^[A-Z]{3} score \d+.*: breakdown$/);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => !r.big)).toEqual([]);
  });
});
