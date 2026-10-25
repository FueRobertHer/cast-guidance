// @vitest-environment jsdom
// TEST-003: casting from the Play tab, read back off the next render. A cast
// is one `update` whose spend, turn and concentration have to agree with what
// the pips, the turn tracker and the concentration toggle then show, and with
// the history row it leaves.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  classEntry,
  concentratingOn,
  dialog,
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

describe('casting from the Play tab (TEST-003)', () => {
  it('spends the lowest slot from the roll chip and lights one fewer pip', async () => {
    const sheet = await renderSheet(sorcerer());
    expect(left('Level 1 slot')).toBe(4);

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
    press('Searing Bolt: casting with Level 1 slot. Change');
    const chooser = await dialog('Cast Searing Bolt');
    expect(chooser.options()).toContain('Level 3 slot (upcast)4d6 · 2 left');
    await chooser.press(/^Level 3 slot \(upcast\)/);

    // The dice follow the pick before anything is rolled.
    expect(screen.queryByRole('button', { name: '2d6' })).toBeNull();
    press('4d6');

    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 1 slot')).toBe(4);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L3)');
    // A pick is for one cast: once the spend lands, the next cast is back on
    // the automatic slot rather than quietly upcasting again.
    expect(
      screen.getByRole('button', { name: 'Searing Bolt: casting with Level 1 slot. Change' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '2d6' })).toBeTruthy();
  });

  it('converts sorcery points instead of a slot when that is the pick', async () => {
    const sheet = await renderSheet(sorcerer());
    press('Searing Bolt: casting with Level 1 slot. Change');
    await (await dialog('Cast Searing Bolt')).press(/^Level 1 slot from Sorcery Points/);
    press('2d6');

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
    expect(pressed('Bonus')).toBe(true);
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
    expect(
      screen.getByRole('button', {
        name: 'Searing Bolt: casting with Pact slot · level 2. Change',
      }),
    ).toBeTruthy();

    // Pact slots are level 2 at Pactcaster 3, so the bolt is cast upcast.
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

  it('replaces one concentration spell with the next', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Steady Gaze'), ref('Warding Hum'));
    const sheet = await renderSheet(doc, { extra: focusSpells });
    expect(concentratingOn()).toBeUndefined();

    press('Cast Steady Gaze');
    expect(concentratingOn()).toBe('Steady Gaze');
    press('End turn');
    press('Cast Warding Hum');

    expect(concentratingOn()).toBe('Warding Hum');
    expect(left('Level 1 slot')).toBe(2);
    expect((await sheet.saved()).play.concentratingOn).toEqual({ label: 'Warding Hum' });
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

    const cast = screen.getByRole('button', { name: 'Cast Steady Gaze' });
    expect(cast.getAttribute('title')).toBe(
      'Cast with nothing left to spend (marks action economy)',
    );
    fireEvent.click(cast);

    expect(concentratingOn()).toBe('Steady Gaze');
    expect(pressed('Action')).toBe(true);
    expect(pips('Level 1 slot')).toEqual(['spent', 'spent']);
    expect((await sheet.history())[0]).toBe('Cast Steady Gaze (no slot)');
  });

  it('falls back to a point conversion, named on the chip, when the slots are gone', async () => {
    const sheet = await renderSheet(sorcerer());
    press('Level 1 slot 4');
    press('Level 2 slot 3');
    press('Level 3 slot 2');

    // The roll chip would otherwise empty the pool unannounced.
    const chip = screen.getByRole('button', {
      name: 'Searing Bolt: casting with Level 1 slot from Sorcery Points. Change',
    });
    expect(chip.textContent).toBe('L1 SP');
    press('2d6');

    expect(left('Sorcery Points use')).toBe(3);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L1 from 2 Sorcery Points)');
  });
});
