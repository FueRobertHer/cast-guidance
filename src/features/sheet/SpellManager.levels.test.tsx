// @vitest-environment jsdom
// The Spells tab lists the spell levels a class can learn at its own level, and
// holds the rest behind an offer rather than refusing them: a higher-level
// pick stays possible, and is flagged once made.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  chooseSpells,
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
  spellBlock,
  testCharacter,
} from '../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** Guidance (cantrip), Searing Bolt (1st), Aid (2nd) and Flame Strike (5th). */
const LISTS = Object.fromEntries(
  ['Guidance', 'Searing Bolt', 'Aid', 'Flame Strike'].map((n) => [`${n}|TST`, ['Sorcerer']]),
);

/** Each spell level the class's list shows, with its summary's caption. */
function levels(className: string): Record<string, string> {
  const heading = screen.getByRole('heading', { name: new RegExp(`^${className} spells`) });
  const section = heading.closest('section');
  if (section === null) throw new Error(`no spell block for ${className}`);
  return Object.fromEntries(
    [...section.querySelectorAll('summary')].map((s) => {
      const [label, caption] = [...s.querySelectorAll(':scope > span')];
      return [label?.textContent ?? '', caption?.textContent ?? ''];
    }),
  );
}

function freshSorcerer(level: number) {
  const doc = sorcerer(level);
  doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
  return doc;
}

describe('spell levels on the Spells tab', () => {
  it('holds back the levels a class cannot learn yet, behind one offer both ways', async () => {
    await renderSheet(freshSorcerer(1), { path: 'spells', lists: LISTS });
    await chooseSpells();
    expect(levels('Sorcerer')).toEqual({ Cantrips: '1 available', 'Level 1': '1 available' });
    expect(screen.queryByRole('button', { name: 'Learn Aid' })).toBeNull();

    const offer = screen.getByRole('button', {
      name: '2 spells at levels 2 to 5, above what Sorcerer 1 can learn yet. Show them anyway',
    });
    fireEvent.click(offer);
    expect(levels('Sorcerer')).toMatchObject({
      'Level 2': 'Unlocks at Sorcerer 3 · 1 available',
      'Level 5': 'Unlocks at Sorcerer 9 · 1 available',
    });
    // The same control, so focus stays put while the list grows above it.
    expect(offer.textContent).toBe('Hide spells above what Sorcerer 1 can learn');

    fireEvent.click(offer);
    expect(Object.keys(levels('Sorcerer'))).toEqual(['Cantrips', 'Level 1']);
  });

  it('shows a level once the class reaches it', async () => {
    await renderSheet(freshSorcerer(3), { path: 'spells', lists: LISTS });
    await chooseSpells();
    expect(levels('Sorcerer')['Level 2']).toBe('1 available');
    expect(
      screen.getByRole('button', {
        name: '1 spell at level 5, above what Sorcerer 3 can learn yet. Show them anyway',
      }),
    ).toBeTruthy();
  });

  it('keeps a higher-level pick in view and flags it, and still allows one', async () => {
    const doc = freshSorcerer(1);
    doc.spellcasting = {
      'sorcerer|tst': { known: [{ name: 'Aid', source: 'TST' }], prepared: [] },
    };
    await renderSheet(doc, { path: 'spells', lists: LISTS });
    await chooseSpells();

    // Only the pick shows at its level, so the caption counts no "available".
    expect(levels('Sorcerer')['Level 2']).toBe('Unlocks at Sorcerer 3 · 1 known');
    const row = screen.getByRole('button', { name: 'Learn Aid' }).parentElement;
    if (row === null) throw new Error('no row for Aid');
    expect(within(row).getByText('Above your level')).toBeTruthy();
    expect(within(row).queryByText('Above your level')?.closest('button')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: '1 spell at level 5, above what Sorcerer 1 can learn yet. Show them anyway',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Learn Flame Strike' }));
    expect(
      screen.getByRole('button', { name: 'Learn Flame Strike' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Learning it is the player's call; nothing about the limits changes.
    expect(spellBlock('Sorcerer').overLimit).toBeUndefined();
  });

  it('searches every level, since a typed name is already a choice', async () => {
    await renderSheet(freshSorcerer(1), { path: 'spells', lists: LISTS });
    await chooseSpells();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Sorcerer spell list' }), {
      target: { value: 'flame' },
    });
    expect(levels('Sorcerer')).toEqual({ 'Level 5': 'Unlocks at Sorcerer 9 · 1 available' });
    expect(screen.queryByRole('button', { name: /Show them anyway$/ })).toBeNull();
  });

  it('says when a class has no spells yet instead of an empty list', async () => {
    // 2014-paladin-shaped: no slots, and so no spells, until its second level.
    const vowkeeper: DataEntity = {
      name: 'Vowkeeper',
      source: 'TST',
      hd: { number: 1, faces: 10 },
      casterProgression: '1/2',
      spellcastingAbility: 'cha',
      preparedSpells: '<$level$> / 2 + <$cha_mod$>',
      classFeatures: [],
    };
    await renderSheet(testCharacter('Oath', [classEntry('Vowkeeper', 1)], { cha: 16 }), {
      path: 'spells',
      extra: { class: [vowkeeper] },
      lists: { 'Searing Bolt|TST': ['Vowkeeper'] },
    });
    await chooseSpells();
    expect(screen.getByText('Vowkeeper spells start at Vowkeeper 2.')).toBeTruthy();
    // No "prepared 0/3" for a class that cannot prepare anything yet.
    expect(spellBlock('Vowkeeper').counters).not.toMatch(/prepared/);
    expect(
      screen.getByRole('button', {
        name: '1 spell at level 1, above what Vowkeeper 1 can learn yet. Show them anyway',
      }),
    ).toBeTruthy();
  });

  it('gives a subclass caster its own spell list', async () => {
    const doc = testCharacter('Knight', [classEntry('Warrior', 7)], { int: 14 });
    const [entry] = doc.classes;
    if (entry !== undefined) entry.subclass = { name: 'Spell Knight', source: 'TST' };
    await renderSheet(doc, {
      path: 'spells',
      lists: {
        'Searing Bolt|TST': ['Warrior: SpellKnight'],
        'Quick Bolt|TST': ['Mage'],
        'Guidance|TST': ['Warrior'],
      },
    });
    await chooseSpells();
    expect(spellBlock('Spell Knight').mode).toBe('Known');
    // Its own list, not the Warrior's or another class's.
    expect(screen.getByRole('button', { name: 'Learn Searing Bolt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Learn Quick Bolt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Learn Guidance' })).toBeNull();
  });

  it('sends focus to the class heading when the offer goes with nothing left to hide', async () => {
    await renderSheet(freshSorcerer(1), { path: 'spells', lists: LISTS });
    await chooseSpells();
    const offer = screen.getByRole('button', { name: /Show them anyway$/ });
    fireEvent.click(offer);
    for (const name of ['Aid', 'Flame Strike']) {
      fireEvent.click(screen.getByRole('button', { name: `Learn ${name}` }));
    }
    offer.focus();
    fireEvent.click(offer);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: /^Sorcerer spells/ }),
      ),
    );
    expect(screen.queryByRole('button', { name: /^Hide spells above/ })).toBeNull();
  });
});
