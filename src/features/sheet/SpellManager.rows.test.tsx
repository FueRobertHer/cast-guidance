// @vitest-environment jsdom
// Review item 3: the spell list says what each spell is (school, casting
// time, range) without opening it, marks a spell the character already has
// from elsewhere (a species' cantrip), and counts a spellbook against its size.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
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
import { spellbookSize, spellRowFacts } from './SpellManager';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

describe('spellRowFacts', () => {
  it('says school, casting time, range and concentration, as far as the data goes', () => {
    expect(
      spellRowFacts({
        name: 'Bolt',
        source: 'TST',
        school: 'V',
        time: [{ number: 1, unit: 'bonus' }],
        range: { type: 'point', distance: { type: 'feet', amount: 120 } },
        duration: [{ type: 'timed', concentration: true }],
      }),
    ).toBe('Evocation · 1 bonus action · 120 feet · concentration');
    expect(spellRowFacts({ name: 'Bare', source: 'TST', school: 'D' })).toBe('Divination');
    // Units read as a phrase, and a range's word is capitalized like Self.
    expect(
      spellRowFacts({
        name: 'Long',
        source: 'TST',
        time: [{ number: 10, unit: 'minute' }],
        range: { type: 'special' },
      }),
    ).toBe('10 minutes · Special');
    expect(
      spellRowFacts({
        name: 'Far',
        source: 'TST',
        time: [{ number: 1, unit: 'hour' }],
        range: { type: 'point', distance: { type: 'miles', amount: 1 } },
      }),
    ).toBe('1 hour · 1 mile');
    expect(spellRowFacts({ name: 'Nothing', source: 'TST' })).toBe('');
  });
});

describe('spellbookSize', () => {
  it('adds up the spells each level writes in (6, then 2 a level)', () => {
    const wizard = [6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    expect(spellbookSize(wizard, 1)).toBe(6);
    expect(spellbookSize(wizard, 3)).toBe(10);
    expect(spellbookSize(wizard, 20)).toBe(44);
    expect(spellbookSize(undefined, 3)).toBeUndefined();
    expect(spellbookSize(wizard, undefined)).toBeUndefined();
  });
});

/** A wizard-shaped class as the data has it: 6 spells at level 1, then 2 a level. */
const scribe: DataEntity = {
  name: 'Scribe',
  source: 'TST',
  hd: { number: 1, faces: 6 },
  casterProgression: 'full',
  spellcastingAbility: 'int',
  preparedSpells: '<$level$> + <$int_mod$>',
  spellsKnownProgressionFixed: [6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  classFeatures: [],
};

describe('the spell list rows', () => {
  it('give each spell its facts, and mark one the species already gives', async () => {
    const doc = sorcerer(1);
    doc.race = { name: 'Testfolk', source: 'TST' };
    // Testfolk's grant written with no book, as real data often has it.
    const testfolk = {
      name: 'Testfolk',
      source: 'TST',
      additionalSpells: [{ ability: 'wis', known: { _: ['guidance'] } }],
    };
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    await renderSheet(doc, {
      path: 'spells',
      extra: { race: [testfolk] },
      lists: { 'Guidance|TST': ['Sorcerer'], 'Searing Bolt|TST': ['Sorcerer'] },
    });
    await chooseSpells();

    expect(screen.getByText('Evocation · 1 action')).toBeTruthy();
    // Testfolk know Guidance already; Learn is still there, as a choice.
    const badge = screen.getByText('From Testfolk');
    expect(badge.getAttribute('title')).toMatch(/^Already yours from Testfolk\./);
    expect(screen.getByRole('button', { name: 'Learn Guidance' })).toBeTruthy();
    expect(screen.queryAllByText('From Testfolk')).toHaveLength(1);
  });

  it('counts a spellbook against what it holds at the class level', async () => {
    const doc = testCharacter('Quill', [classEntry('Scribe', 3)], { int: 14 });
    doc.spellcasting = {
      'scribe|tst': { known: [{ name: 'Searing Bolt', source: 'TST' }], prepared: [] },
    };
    await renderSheet(doc, {
      extra: { class: [scribe] },
      path: 'spells',
      lists: { 'Searing Bolt|TST': ['Scribe'] },
    });
    await chooseSpells();
    expect(spellBlock('Scribe').counters).toContain('spellbook 1/10');
  });
});
