// @vitest-environment jsdom
// An expanded spell list (a Warlock patron's, Divine Soul's, a dragonmark's)
// adds spells to a class's list on the Spells tab, named or by a filter, and
// each such row says what added it.
import 'fake-indexeddb/auto';
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import { characterSessionStore } from '@/stores/characterSession';
import {
  chooseSpells,
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  testCharacter,
} from '../../../tests-fixtures/sheetHarness';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** Searing Bolt is the Sorcerer's; Quick Bolt the Wizard's; Daze Mote the Cleric's. */
const LISTS = {
  'Searing Bolt|TST': ['Sorcerer'],
  'Quick Bolt|TST': ['Wizard'],
  'Daze Mote|TST': ['Cleric'],
};

/**
 * A dragonmark-style race: spells by name (one the Sorcerer has already), and a
 * Cleric filter.
 */
const markfolk: DataEntity = {
  name: 'Markfolk',
  source: 'TST',
  additionalSpells: [
    {
      expanded: {
        s1: ['quick bolt', 'searing bolt|tst'],
        '1': [{ all: 'level=1|class=Cleric' }],
      },
    },
  ],
  entries: [],
};

function sorcerer(race: boolean) {
  const doc = testCharacter('Sigil', [classEntry('Sorcerer', 1)], { cha: 16 });
  if (race) doc.race = { name: 'Markfolk', source: 'TST' };
  doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
  return doc;
}

/** The row holding a spell's Learn button. */
function row(name: string): HTMLElement {
  const learn = screen.getByRole('button', { name: `Learn ${name}` });
  const at = learn.closest('div');
  if (at === null) throw new Error(`no row for ${name}`);
  return at;
}

describe('an expanded spell list on the Spells tab', () => {
  it('adds its spells to the class list and says where each came from', async () => {
    await renderSheet(sorcerer(true), {
      path: 'spells',
      extra: { race: [markfolk] },
      lists: LISTS,
    });
    await chooseSpells();
    expect(within(row('Quick Bolt')).getByText('Markfolk').getAttribute('title')).toBe(
      'On your Sorcerer list from Markfolk',
    );
    expect(within(row('Daze Mote')).getByText('Markfolk')).toBeTruthy();
    // The class's own spell carries no such mark, though the race names it too.
    expect(within(row('Searing Bolt')).queryByText('Markfolk')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Learn Searing Bolt' })).toHaveLength(1);
  });

  it("calls a class's own expanded list that, rather than naming the class on its own list", async () => {
    // The 2024 Bard's Magical Secrets, on the test Sorcerer.
    const own: DataEntity = {
      ...(makeTestContext().get('class', 'Sorcerer', 'TST') as DataEntity),
      additionalSpells: [{ expanded: { '1': [{ all: 'level=1|class=Cleric' }] } }],
    };
    await renderSheet(sorcerer(false), { path: 'spells', extra: { class: [own] }, lists: LISTS });
    await chooseSpells();
    expect(within(row('Daze Mote')).getByText('Expanded list')).toBeTruthy();
    expect(within(row('Daze Mote')).queryByText('Sorcerer')).toBeNull();
  });

  it('marks no homebrew spell already on the class list, though the list names it', async () => {
    const brew: DataEntity = {
      name: 'Brew Bolt',
      source: 'TST',
      level: 1,
      school: 'V',
      classes: { fromClassList: [{ name: 'Sorcerer', source: 'TST' }] },
      entries: ['A homebrew bolt.'],
    };
    const named: DataEntity = {
      ...markfolk,
      additionalSpells: [{ expanded: { s1: ['quick bolt', 'brew bolt|tst'] } }],
    };
    await renderSheet(sorcerer(true), {
      path: 'spells',
      extra: { race: [named], spell: [brew] },
      lists: LISTS,
    });
    await chooseSpells();
    expect(within(row('Quick Bolt')).getByText('Markfolk')).toBeTruthy();
    expect(within(row('Brew Bolt')).queryByText('Markfolk')).toBeNull();
  });

  it('follows the list as the build changes', async () => {
    await renderSheet(sorcerer(false), {
      path: 'spells',
      extra: { race: [markfolk] },
      lists: LISTS,
    });
    await chooseSpells();
    expect(screen.queryByRole('button', { name: 'Learn Quick Bolt' })).toBeNull();
    act(() =>
      characterSessionStore.getState().update((d) => {
        d.race = { name: 'Markfolk', source: 'TST' };
      }),
    );
    expect(await screen.findByRole('button', { name: 'Learn Quick Bolt' })).toBeTruthy();
  });

  it('leaves them off without it', async () => {
    await renderSheet(sorcerer(false), {
      path: 'spells',
      extra: { race: [markfolk] },
      lists: LISTS,
    });
    await chooseSpells();
    expect(screen.getByRole('button', { name: 'Learn Searing Bolt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Learn Quick Bolt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Learn Daze Mote' })).toBeNull();
  });
});
