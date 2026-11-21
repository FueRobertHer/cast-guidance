// @vitest-environment jsdom
// A class that prepares its spells casts only those, and a wizard's
// unprepared spellbook rituals as rituals with no slot (the 2026-11-21 review,
// top 6 and 11). Play leaves the rest to Spells, where each is a tap from
// preparing, and Unprepare sits under a prepared spell's rules.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  castHeld,
  castNote,
  castTiles,
  classEntry,
  concentratingOn,
  HARNESS_TIMEOUT,
  left,
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

afterEach(resetSheetHarness);

const ref = (name: string) => ({ name, source: 'TST' });

/** A dice-free ritual that concentrates, so it casts from its Cast button. */
const senseMagic: DataEntity = {
  name: 'Sense Magic',
  source: 'TST',
  level: 1,
  school: 'D',
  time: [{ number: 1, unit: 'action' }],
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 10 }, concentration: true }],
  meta: { ritual: true },
  entries: ['You sense magic nearby.'],
};

/** The test world's Mage as a wizard: a spellbook, and Ritual Casting in its Spellcasting. */
const world = {
  spell: [senseMagic],
  class: [
    {
      name: 'Mage',
      source: 'TST',
      hd: { number: 1, faces: 6 },
      proficiency: ['int', 'wis'],
      casterProgression: 'full',
      spellcastingAbility: 'int',
      cantripProgression: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      preparedSpells: '<$level$> + <$int_mod$>',
      spellsKnownProgressionFixed: [6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      classFeatures: ['Spellcasting|Mage|TST|1'],
    },
  ],
  classFeature: [
    {
      name: 'Spellcasting',
      source: 'TST',
      className: 'Mage',
      classSource: 'TST',
      level: 1,
      entries: [
        'You cast spells.',
        { type: 'entries', name: 'Ritual Casting', entries: ['From your spellbook.'] },
      ],
    },
  ],
} satisfies Record<string, DataEntity[]>;

/** A level 3 wizard with Searing Bolt prepared, and Quick Bolt and Sense Magic only in the book. */
function wizard() {
  const doc = testCharacter('Lyra', [classEntry('Mage', 3)], { int: 16 });
  doc.spellcasting = {
    'mage|tst': {
      known: [ref('Searing Bolt'), ref('Quick Bolt'), ref('Sense Magic')],
      prepared: [ref('Searing Bolt')],
    },
  };
  return doc;
}

describe('a wizard’s spellbook on Play', () => {
  it('casts what is prepared and the unprepared ritual, and leaves the rest to Spells', async () => {
    await renderSheet(wizard(), { extra: world });

    expect(screen.getByRole('button', { name: /^Searing Bolt\s*prepared$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Sense Magic\s*ritual$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Quick Bolt/ })).toBeNull();
    expect(screen.getByText(/1 more not prepared\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Prepare on Spells' }).getAttribute('href')).toMatch(
      /\/spells$/,
    );
  });

  it('casts the unprepared ritual as a ritual alone: no slot and no slice of the turn', async () => {
    const sheet = await renderSheet(wizard(), { extra: world });
    const slots = left('Level 1 slot');

    fireEvent.click(screen.getByRole('button', { name: 'Cast Sense Magic' }));
    expect(castTiles()).toEqual(['Ritual · level 1, no slot']);
    expect(castNote()).toBe('As a ritual: no slot, and it takes 10 minutes longer to cast.');
    castHeld();

    expect(left('Level 1 slot')).toBe(slots);
    expect(concentratingOn()).toBe('Sense Magic');
    const saved = await sheet.saved();
    expect(saved.play.turn?.action ?? false).toBe(false);
    expect((await sheet.history())[0]).toBe('Cast Sense Magic (ritual)');
  });
});

describe('a wizard’s spellbook on Spells', () => {
  it('prepares a spell from the row, and unprepares it under its rules', async () => {
    const sheet = await renderSheet(wizard(), { path: 'spells', extra: world });
    const fold = screen.getByText('Not prepared').closest('details');
    if (fold === null) throw new Error('no fold');

    // Not prepared, and no ritual: nothing to cast, only Prepare.
    expect(within(fold).queryByRole('button', { name: /Quick Bolt fire damage/ })).toBeNull();
    expect(within(fold).getByRole('button', { name: 'Cast Sense Magic' })).toBeTruthy();
    expect(within(fold).getByText('Ritual')).toBeTruthy();

    fireEvent.click(within(fold).getByRole('button', { name: 'Prepare Quick Bolt' }));
    expect((await sheet.saved()).spellcasting['mage|tst']?.prepared).toEqual([
      ref('Searing Bolt'),
      ref('Quick Bolt'),
    ]);
    expect((await sheet.history())[0]).toBe('Prepared Quick Bolt');
    expect(within(fold).queryByRole('button', { name: 'Prepare Quick Bolt' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Quick Bolt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unprepare Quick Bolt' }));
    expect((await sheet.saved()).spellcasting['mage|tst']?.prepared).toEqual([ref('Searing Bolt')]);
    expect((await sheet.history())[0]).toBe('Unprepared Quick Bolt');
  });

  it('offers a prepared ritual its slots and the ritual', async () => {
    const doc = wizard();
    doc.spellcasting['mage|tst']?.prepared.push(ref('Sense Magic'));
    await renderSheet(doc, { path: 'spells', extra: world });

    fireEvent.click(screen.getByRole('button', { name: 'Cast Sense Magic' }));
    expect(castTiles().at(-1)).toBe('Ritual · level 1, no slot');
    expect(castTiles()[0]).toMatch(/^Level 1 slot/);
  });
});
