// @vitest-environment jsdom
// TEST-003: casting from the Play tab, read back off the next render. A cast
// is one `update` whose spend, turn and concentration have to agree with what
// the pips, the turn tracker and the concentration toggle then show, and with
// the history row it leaves.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  castHeld,
  castNote,
  castTiles,
  classEntry,
  concentratingOn,
  HARNESS_TIMEOUT,
  left,
  pips,
  renderSheet,
  resetSheetHarness,
  sorcerer,
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

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';

/** A dice-free level 1 spell that concentrates, so it casts from its Cast button. */
const focusSpell = (name: string): DataEntity => ({
  name,
  source: 'TST',
  level: 1,
  school: 'E',
  time: [{ number: 1, unit: 'action' }],
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['You hold your focus.'],
});
const focusSpells = { spell: [focusSpell('Steady Gaze'), focusSpell('Warding Hum')] };
/** A cantrip cast as an Action, so casting it leaves a mark on the turn. */
const flick: DataEntity = {
  name: 'Spark Flick',
  source: 'TST',
  level: 0,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  entries: ['A harmless spark.'],
};
const ref = (name: string) => ({ name, source: 'TST' });
/** A concentration spell whose dice are rolled turn after turn, and scale with the slot. */
const shaft: DataEntity = {
  name: 'Moon Shaft',
  source: 'TST',
  level: 2,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['A beam deals {@damage 2d10} radiant damage.'],
  entriesHigherLevel: [
    { entries: ['The damage increases by {@scaledamage 2d10|2-9|1d10} per slot above 2nd.'] },
  ],
};

describe('casting from the Play tab (TEST-003)', () => {
  it('spends the lowest slot from the roll chip and lights one fewer pip', async () => {
    const sheet = await renderSheet(sorcerer());
    expect(left('Level 1 slot')).toBe(4);

    // The chip opens the roll prompt on the lowest slot, and spends nothing yet.
    press('2d6');
    expect(castNote()).toBe('Spends a 1st-level slot.');
    expect(left('Level 1 slot')).toBe(4);
    // Tapped again, as Roll is pressed, it casts.
    press('2d6');

    expect(pips('Level 1 slot')).toEqual(['available', 'available', 'available', 'spent']);
    expect(left('Level 2 slot')).toBe(3);
    expect(left('Level 3 slot')).toBe(2);
    expect(pressed('Action')).toBe(true);
    expect((await sheet.saved()).play.slotsSpent.slice(0, 3)).toEqual([1, 0, 0]);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt');
  });

  it('spends the upcast slot the player chose, at the dice it scales to', async () => {
    const sheet = await renderSheet(sorcerer());
    press('2d6');
    expect(castTiles()).toContain('Level 3 slot, 2 left');
    castHeld('Level 3 slot');

    // The dice are the pick's.
    expect(rollLogStore.getState().rolls.map((r) => r.expr)).toEqual(['4d6']);
    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 1 slot')).toBe(4);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L3)');
    // A pick is for one cast: the next starts on the lowest slot again rather
    // than quietly upcasting.
    fireEvent.click(screen.getByTitle('Searing Bolt fire damage'));
    expect(castNote()).toBe('Spends a 1st-level slot.');
  });

  it('converts sorcery points instead of a slot when that is the pick', async () => {
    const sheet = await renderSheet(sorcerer());
    press('2d6');
    castHeld('Level 1 slot from Sorcery Points');

    expect(left('Level 1 slot')).toBe(4);
    expect(pips('Sorcery Points use')).toEqual([
      'available',
      'available',
      'available',
      'spent',
      'spent',
    ]);
    // Converting takes the Bonus Action on top of the spell's own Action.
    expect(pressed('Action')).toBe(true);
    expect(pressed('Bonus action')).toBe(true);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L1 from 2 Sorcery Points)');
  });

  it('spends a pact slot before a leveled one, at the pact slot level', async () => {
    // A level of sorcerer adds two level 1 slots, so the cast has both to pick from.
    const doc = testCharacter('Hex', [classEntry('Pactcaster', 3), classEntry('Sorcerer', 1)], {
      cha: 16,
    });
    doc.spellcasting = { 'pactcaster|tst': { known: [ref('Searing Bolt')], prepared: [] } };
    const sheet = await renderSheet(doc);
    expect(pips('Pact slot')).toEqual(['available', 'available']);
    expect(left('Level 1 slot')).toBe(2);

    // Pact slots are level 2 at Pactcaster 3, so the bolt is cast upcast, and
    // the chip shows the dice of the pact slot the prompt starts on.
    press('3d6');
    expect(castNote()).toBe('Spends a pact slot (2nd level).');
    expect(castTiles()).toEqual(['Level 1 slot, 2 left', 'Pact slot · level 2, 2 left']);
    press('3d6');

    expect(pips('Pact slot')).toEqual(['available', 'spent']);
    expect(left('Level 1 slot')).toBe(2);
    const saved = await sheet.saved();
    expect(saved.play.pactSlotsSpent).toBe(1);
    expect(saved.play.slotsSpent.every((n) => n === 0)).toBe(true);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (pact slot)');
  });

  it('casts a cantrip without touching a slot', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Spark Flick'));
    const sheet = await renderSheet(doc, { extra: { spell: [flick] } });

    press('Cast Spark Flick');

    expect(pressed('Action')).toBe(true);
    expect(left('Level 1 slot')).toBe(4);
    expect(left('Sorcery Points use')).toBe(5);
    expect((await sheet.history())[0]).toBe('Cast Spark Flick');
    expect((await sheet.saved()).play.slotsSpent.every((n) => n === 0)).toBe(true);
  });

  it('rolls a running concentration spell at its cast slot, spending nothing more', async () => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Moon Shaft')], prepared: [] } };
    await renderSheet(doc, { extra: { spell: [shaft] } });
    press('2d10');
    castHeld('Level 3 slot');
    expect(left('Level 3 slot')).toBe(1);
    expect(concentratingOn()).toBe('Moon Shaft');

    // Its next turn: the same dice, and every slot where it was. The chip is
    // still showing its total, so it is found by what it rolls.
    fireEvent.click(screen.getByTitle('Moon Shaft radiant damage'));
    expect(rollLogStore.getState().rolls.map((r) => r.expr)).toEqual(['3d10', '3d10']);
    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 2 slot')).toBe(3);
    // Nothing waits to be cast: the running spell's roll landed at once.
    expect(castTiles()).toEqual([]);
  });

  it('replaces one concentration spell with the next', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Steady Gaze'), ref('Warding Hum'));
    const sheet = await renderSheet(doc, { extra: focusSpells });
    expect(concentratingOn()).toBeUndefined();

    press('Cast Steady Gaze');
    castHeld();
    expect(concentratingOn()).toBe('Steady Gaze');
    press('New turn');
    press('Cast Warding Hum');
    castHeld();

    expect(concentratingOn()).toBe('Warding Hum');
    expect(left('Level 1 slot')).toBe(2);
    expect((await sheet.saved()).play.concentratingOn).toEqual({
      label: 'Warding Hum',
      level: 1,
    });
  });
});

describe('a condition on casting from the Play tab', () => {
  const wearing = (control: Element) => control.querySelector('.cx')?.className ?? '';
  /** Knows a spell that casts from its chip, and one that casts from its button. */
  const caster = (conditions: CharacterDoc['play']['conditions']) => {
    const doc = sorcerer();
    doc.spellcasting = {
      'sorcerer|tst': {
        known: [ref('Searing Bolt'), ref('Daze Mote'), ref('Moon Shaft')],
        prepared: [],
      },
    };
    doc.play.conditions = conditions;
    return doc;
  };

  it('wears what stops casting on Cast and the chip that casts', async () => {
    await renderSheet(caster([{ id: 'Paralyzed' }]), { extra: { spell: [shaft] } });
    expect(wearing(screen.getByRole('button', { name: 'Cast Daze Mote' }))).toContain(
      'cx-paralyzed',
    );
    expect(wearing(screen.getByTitle('Searing Bolt fire damage'))).toContain('cx-paralyzed');
  });

  it('leaves them plain under a condition that only touches attacks', async () => {
    await renderSheet(caster([{ id: 'Poisoned' }]), { extra: { spell: [shaft] } });
    expect(wearing(screen.getByRole('button', { name: 'Cast Daze Mote' }))).not.toContain('cx-on');
    expect(wearing(screen.getByTitle('Searing Bolt fire damage'))).not.toContain('cx-on');
  });

  it('fades off a chip whose own roll starts its concentration, as it stops casting', async () => {
    await renderSheet(caster([{ id: 'Paralyzed' }]), { extra: { spell: [shaft] } });
    const chip = screen.getByTitle('Moon Shaft radiant damage');
    expect(wearing(chip)).toContain('cx-paralyzed');

    fireEvent.click(chip);
    castHeld();

    expect(wearing(screen.getByTitle('Moon Shaft radiant damage'))).toContain('cx-rm');
  });
});

describe('casting with nothing left (TEST-003)', () => {
  it('keeps Cast on offer once every slot is spent, and says it spends nothing', async () => {
    const doc = testCharacter('Quill', [classEntry('Mage', 1)], { int: 14 });
    doc.spellcasting = {
      'mage|tst': { known: [ref('Steady Gaze')], prepared: [ref('Steady Gaze')] },
    };
    const sheet = await renderSheet(doc, { extra: focusSpells });
    press('Level 1 slot 2');
    expect(pips('Level 1 slot')).toEqual(['spent', 'spent']);

    press('Cast Steady Gaze');
    // The spent slot stays on show, and Roll says the cast spends nothing.
    expect(castTiles()).toEqual(['Level 1 slot, 0 left, cannot pay now']);
    expect(castNote()).toBe('Nothing left to spend: it marks only your turn.');
    castHeld();

    expect(concentratingOn()).toBe('Steady Gaze');
    expect(pressed('Action')).toBe(true);
    expect(pips('Level 1 slot')).toEqual(['spent', 'spent']);
    expect((await sheet.history())[0]).toBe('Cast Steady Gaze (no slot)');
  });

  it('falls back to a point conversion, said by Roll, when the slots are gone', async () => {
    const sheet = await renderSheet(sorcerer());
    press('Level 1 slot 4');
    press('Level 2 slot 3');
    press('Level 3 slot 2');

    // The prompt says so, or the chip would empty the pool unannounced.
    press('2d6');
    expect(castNote()).toBe('Spends 2 Sorcery Points and a Bonus Action to convert.');
    press('2d6');

    expect(left('Sorcery Points use')).toBe(3);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L1 from 2 Sorcery Points)');
  });
});

describe("casting from an item's charges", () => {
  /** Heals 1d8, a die more a slot level: the canvas's example with the staff. */
  const cure: DataEntity = {
    name: 'Cure Wounds',
    source: 'TST',
    level: 1,
    school: 'A',
    time: [{ number: 1, unit: 'action' }],
    entries: ['A creature you touch regains {@dice 1d8} hit points.'],
    entriesHigherLevel: [
      { entries: ['The healing increases by {@scaledice 1d8|1-9|1d8} per slot above 1st.'] },
    ],
  };
  const staff: DataEntity = {
    name: 'Staff of Healing',
    source: 'XDMG',
    type: 'ST|XDMG',
    rarity: 'rare',
    reqAttune: 'by a Bard, Cleric, or Druid',
    entries: ['This staff has 10 charges.'],
  };
  const healer = (attuned: boolean) => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Cure Wounds')], prepared: [] } };
    doc.equipment = [
      {
        id: 's1',
        ref: { name: 'Staff of Healing', source: 'XDMG' },
        qty: 1,
        equipped: true,
        attuned,
      },
    ];
    return doc;
  };
  const world = { extra: { spell: [cure], item: [staff] } };

  it('offers the staff beside the slots, and spends its charges at the level picked', async () => {
    const sheet = await renderSheet(healer(true), world);
    expect(left('Staff of Healing charges use')).toBe(10);

    press('1d8');
    expect(castTiles()).toEqual([
      'Level 1 slot, 4 left',
      'Level 2 slot, 3 left',
      'Level 3 slot, 2 left',
      'Level 1 slot from Sorcery Points, 2 points',
      'Level 2 slot from Sorcery Points, 3 points',
      'Level 3 slot from Sorcery Points, 5 points',
      'Level 4 slot from Sorcery Points, 6 points, cannot pay now',
      'Level 5 slot from Sorcery Points, 7 points, cannot pay now',
      'Level 1 from Staff of Healing, 1 charge',
      'Level 2 from Staff of Healing, 2 charges',
      'Level 3 from Staff of Healing, 3 charges',
      'Level 4 from Staff of Healing, 4 charges',
    ]);
    castHeld('Level 3 from Staff of Healing');

    expect(rollLogStore.getState().rolls.map((r) => [r.expr, r.kind])).toEqual([['3d8', 'heal']]);
    expect(left('Staff of Healing charges use')).toBe(7);
    expect(left('Level 1 slot')).toBe(4);
    expect(pressed('Action')).toBe(true);
    expect((await sheet.history())[0]).toBe(
      'Cast Cure Wounds (L3 from 3 Staff of Healing charges)',
    );
  });

  it('offers no charges until the staff is attuned', async () => {
    await renderSheet(healer(false), world);
    expect(screen.queryByRole('button', { name: /^Staff of Healing charges use/ })).toBeNull();
    press('1d8');
    expect(castTiles().some((t) => t.includes('Staff of Healing'))).toBe(false);
  });
});
