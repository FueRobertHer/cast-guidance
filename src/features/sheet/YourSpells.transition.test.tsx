// @vitest-environment jsdom
// The Spells tab's first view, read back off the next render: the character's
// own spells by level, each with the one thing a player does with it, and what
// that does to the slots, the concentration and the history.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  chooseSpells,
  classEntry,
  dialog,
  HARNESS_TIMEOUT,
  left,
  renderSheet,
  resetSheetHarness,
  sorcerer,
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

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const ref = (name: string) => ({ name, source: 'TST' });

const CONCENTRATION = [
  { type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true },
];
/** A dice-free level 1 spell that concentrates, so it casts from its Cast button. */
const gaze: DataEntity = {
  name: 'Steady Gaze',
  source: 'TST',
  level: 1,
  school: 'E',
  time: [{ number: 1, unit: 'action' }],
  duration: CONCENTRATION,
  entries: ['You hold your focus.'],
};
/** A concentration spell whose dice are rolled turn after turn, and scale with the slot. */
const shaft: DataEntity = {
  name: 'Moon Shaft',
  source: 'TST',
  level: 2,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  duration: CONCENTRATION,
  entries: ['A beam deals {@damage 2d10} radiant damage.'],
  entriesHigherLevel: [
    { entries: ['The damage increases by {@scaledamage 2d10|2-9|1d10} per slot above 2nd.'] },
  ],
};
/** A save for damage, with a range to read. */
const flare: DataEntity = {
  name: 'Sun Flare',
  source: 'TST',
  level: 0,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'point', distance: { type: 'feet', amount: 60 } },
  savingThrow: ['dexterity'],
  entries: ['A flare deals {@damage 1d8} radiant damage.'],
};

/** A level's heading, with the caption beside it and the names in its list. */
function level(title: string) {
  const heading = screen.getByRole('heading', { level: 3, name: title });
  const section = heading.closest('section');
  if (section === null) throw new Error(`no section for ${title}`);
  return {
    caption: heading.nextElementSibling?.textContent,
    names: within(section)
      .getAllByRole('button')
      .filter((b) => b.className.includes('decoration-dashed'))
      .map((b) => b.textContent),
  };
}

/** The row a spell's name sits in. */
function row(name: string): HTMLElement {
  const row = screen.getByRole('button', { name }).closest<HTMLElement>('.min-h-15');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe("the Spells tab's Your spells", () => {
  it('leads with the own spells by level, and what is left to cast them with', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Guidance'));
    await renderSheet(doc, { path: 'spells' });

    expect(screen.getByRole('heading', { level: 2, name: 'Sorcerer spells' })).toBeTruthy();
    expect(level('Cantrips')).toEqual({ caption: 'at will', names: ['Guidance'] });
    expect(level('Level 1')).toEqual({ caption: '4 slots left', names: ['Searing Bolt'] });
    // The class list, with its chips, is the other view.
    const classList = { name: 'Search Sorcerer spell list' };
    expect(screen.queryByRole('textbox', classList)).toBeNull();
    await chooseSpells();
    expect(screen.getByRole('textbox', classList)).toBeTruthy();
    press('Your spells');
    expect(screen.queryByRole('textbox', classList)).toBeNull();
  });

  it('keeps the count above a level in step with the pips over the list', async () => {
    await renderSheet(sorcerer(), { path: 'spells' });
    expect(left('Level 1 slot')).toBe(4);
    press('Level 1 slot 1');
    expect(left('Level 1 slot')).toBe(3);
    expect(level('Level 1').caption).toBe('3 slots left');
  });

  it('says so when there is nothing to list, and when a search finds nothing', async () => {
    const empty = sorcerer();
    empty.spellcasting = {};
    await renderSheet(empty, { path: 'spells' });
    expect(screen.getByText('No Sorcerer spells yet. Pick some under Choose.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Search your spells' })).toBeNull();
    await resetSheetHarness();

    await renderSheet(sorcerer(), { path: 'spells' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search your spells' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No Sorcerer spells match “zzz”.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Searing Bolt' })).toBeNull();
  });

  it('reads a save for damage off its row: its DC, its dice and its one line', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Sun Flare'));
    await renderSheet(doc, { path: 'spells', extra: { spell: [flare] } });
    const flareRow = within(row('Sun Flare'));
    expect(flareRow.getByText('Evocation · 60 ft · DEX save')).toBeTruthy();
    expect(flareRow.getByText(/^DC \d+$/)).toBeTruthy();
    expect(flareRow.getByRole('button', { name: '1d8' })).toBeTruthy();
    expect(flareRow.queryByRole('button', { name: 'Cast Sun Flare' })).toBeNull();
  });
});

describe('Cast and End on a row', () => {
  it('spends the one slot that fits and starts concentrating, and End stops it', async () => {
    const doc = sorcerer(1);
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Steady Gaze')], prepared: [] } };
    const sheet = await renderSheet(doc, { path: 'spells', extra: { spell: [gaze] } });
    expect(row('Steady Gaze').className).not.toContain('bg-arcane-soft');
    expect(within(row('Steady Gaze')).getByText('Concentration')).toBeTruthy();
    expect(within(row('Steady Gaze')).getByText('Enchantment · up to 1 minute')).toBeTruthy();

    press('Cast Steady Gaze');

    expect(left('Level 1 slot')).toBe(1);
    expect(row('Steady Gaze').className).toContain('bg-arcane-soft');
    expect(within(row('Steady Gaze')).getByText('Enchantment · concentrating')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast Steady Gaze' })).toBeNull();
    expect((await sheet.saved()).play.concentratingOn).toEqual({ label: 'Steady Gaze', level: 1 });
    expect((await sheet.history())[0]).toBe('Cast Steady Gaze');

    press('End concentration on Steady Gaze');

    expect(row('Steady Gaze').className).not.toContain('bg-arcane-soft');
    expect(screen.getByRole('button', { name: 'Cast Steady Gaze' })).toBeTruthy();
    // Ending gives nothing back: the slot was spent on the cast.
    expect(left('Level 1 slot')).toBe(1);
    expect((await sheet.saved()).play.concentratingOn).toBeUndefined();
  });

  it('asks which level when more than one fits, and spends the answer', async () => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Steady Gaze')], prepared: [] } };
    const sheet = await renderSheet(doc, { path: 'spells', extra: { spell: [gaze] } });

    press('Cast Steady Gaze');
    await (await dialog('Cast Steady Gaze')).press(/^Level 3 slot \(upcast\)/);

    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 1 slot')).toBe(4);
    expect((await sheet.saved()).play.concentratingOn).toEqual({ label: 'Steady Gaze', level: 3 });
  });

  it('spends nothing when the player backs out of the choice', async () => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Steady Gaze')], prepared: [] } };
    await renderSheet(doc, { path: 'spells', extra: { spell: [gaze] } });

    press('Cast Steady Gaze');
    fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Cast Steady Gaze' }), {
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(left('Level 1 slot')).toBe(4);
    expect(screen.getByRole('button', { name: 'Cast Steady Gaze' })).toBeTruthy();
  });
});

describe('a spell that rolls', () => {
  it('casts from its chip, at the slot its picker settled', async () => {
    const sheet = await renderSheet(sorcerer(), { path: 'spells' });
    press('Searing Bolt: casting with Level 1 slot. Change');
    await (await dialog('Cast Searing Bolt')).press(/^Level 3 slot \(upcast\)/);

    press('4d6');

    expect(left('Level 3 slot')).toBe(1);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L3)');
  });

  it('rolls a running spell at the slot it was cast with, spending nothing more', async () => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Moon Shaft')], prepared: [] } };
    await renderSheet(doc, { path: 'spells', extra: { spell: [shaft] } });
    press('Moon Shaft: casting with Level 2 slot. Change');
    await (await dialog('Cast Moon Shaft')).press(/^Level 3 slot \(upcast\)/);

    press('3d10');
    expect(left('Level 3 slot')).toBe(1);

    // Its next turn: the same dice, the same slots, and End beside them.
    expect(screen.queryByRole('button', { name: /^Moon Shaft: casting with/ })).toBeNull();
    // The chip is still showing its total, so it is found by what it rolls.
    fireEvent.click(screen.getByTitle('Moon Shaft radiant damage'));
    expect(rollLogStore.getState().rolls.map((r) => r.expr)).toEqual(['3d10', '3d10']);
    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 2 slot')).toBe(3);

    press('End concentration on Moon Shaft');
    expect(screen.getByRole('button', { name: '2d10' })).toBeTruthy();
  });
});

describe('who lands where', () => {
  it("folds a known spell away until it is prepared, and counts against the class's limit", async () => {
    const doc = testCharacter('Quill', [classEntry('Mage', 1)]);
    doc.spellcasting = {
      'mage|tst': {
        known: [ref('Searing Bolt'), ref('Quick Bolt')],
        prepared: [ref('Searing Bolt')],
      },
    };
    await renderSheet(doc, { path: 'spells' });

    expect(screen.getByText('1 of 1')?.parentElement?.textContent).toBe('1 of 1 prepared');
    expect(level('Level 1').names).toEqual(['Searing Bolt']);
    const fold = screen.getByText('Not prepared').closest('details');
    if (fold === null) throw new Error('no fold');
    expect(fold.open).toBe(false);
    // Folded rather than gone, and said with its level since it is not in a level's list.
    expect(within(fold).getByRole('button', { name: 'Quick Bolt' })).toBeTruthy();
    expect(within(fold).getByText(/^Level 1 · Evocation/)).toBeTruthy();
  });

  it('puts an always-prepared grant in its level with a badge, once', async () => {
    const doc = sorcerer();
    doc.classes = [
      {
        ref: { name: 'Warrior', source: 'TST' },
        subclass: { name: 'Path of Tests', source: 'TST' },
        levels: 3,
        hp: ['avg', 'avg', 'avg'],
      },
      ...doc.classes,
    ];
    // Also picked by hand: still the one row.
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Bless'));
    const bless: DataEntity = { name: 'Bless', source: 'TST', level: 1, school: 'E', entries: [] };
    await renderSheet(doc, { path: 'spells', extra: { spell: [bless] } });

    expect(level('Level 1').names).toEqual(['Bless', 'Searing Bolt']);
    expect(within(row('Bless')).getByText('Always')).toBeTruthy();
    expect(within(row('Searing Bolt')).queryByText('Always')).toBeNull();
  });

  it('gives an innate grant its own group, spending its own uses', async () => {
    // The world's species grants Aid with no pool, and its feat a pool of Searing Bolts.
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    doc.race = { name: 'Testfolk', source: 'TST' };
    doc.feats = [{ ref: { name: 'Spark Touched', source: 'TST' }, instanceId: 'f1' }];
    await renderSheet(doc, { path: 'spells' });

    const heading = screen.getByRole('heading', { level: 2, name: 'Innate & granted spells' });
    const group = heading.closest('section');
    if (group === null) throw new Error('no group');
    fireEvent.click(within(group).getByRole('button', { name: 'Cast Aid' }));
    expect(left('Level 2 slot')).toBe(3);

    expect(within(group).getByText('2/2 per day')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: '2d6' }));
    expect(within(group).getByText('1/2 per day')).toBeTruthy();
    expect(left('Level 1 slot')).toBe(4);
  });

  it('gives a warlock a row per Mystic Arcanum, cast without a slot', async () => {
    const arcane: DataEntity = {
      name: 'Far Step',
      source: 'TST',
      level: 6,
      school: 'C',
      time: [{ number: 1, unit: 'action' }],
      entries: ['You step away.'],
    };
    const doc = testCharacter('Hex', [classEntry('Pactcaster', 11)], { cha: 16 });
    doc.spellcasting = { 'pactcaster|tst': { known: [ref('Far Step')], prepared: [] } };
    const sheet = await renderSheet(doc, { path: 'spells', extra: { spell: [arcane] } });
    expect(level('Level 6').caption).toBe('Mystic Arcanum ready');

    press('Cast Far Step');

    expect(level('Level 6').caption).toBe('Mystic Arcanum used');
    expect((await sheet.saved()).play.arcanumUsed).toEqual([6]);
    expect((await sheet.history())[0]).toBe('Cast Far Step (Mystic Arcanum)');
  });

  it('counts pact slots for a level they can cast, and spends one', async () => {
    const doc = testCharacter('Hex', [classEntry('Pactcaster', 3)], { cha: 16 });
    doc.spellcasting = {
      'pactcaster|tst': { known: [ref('Steady Gaze'), ref('Aid')], prepared: [] },
    };
    await renderSheet(doc, { path: 'spells', extra: { spell: [gaze] } });
    expect(level('Level 1').caption).toBe('2 pact slots left');
    expect(level('Level 2').caption).toBe('2 pact slots left');

    press('Cast Steady Gaze');

    expect(level('Level 1').caption).toBe('1 pact slot left');
    expect(level('Level 2').caption).toBe('1 pact slot left');
  });

  it('flags a spell above the class level, and does not stop it', async () => {
    const doc = sorcerer(1);
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Aid')], prepared: [] } };
    await renderSheet(doc, { path: 'spells' });
    expect(within(row('Aid')).getByText('Above your level')).toBeTruthy();
    expect(level('Level 2').caption).toBe('no slots at this level');
    expect(screen.getByRole('button', { name: 'Cast Aid' })).toBeTruthy();
  });
});
