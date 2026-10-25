// @vitest-environment jsdom
// TEST-003: what a rest does to an open sheet. Each case taps the Play tab's
// own controls, lets the session save, and reads the next render: pips by
// their `data-state`, HP from the meter, hit dice from their button, the
// notice from the toast, and the history row the rest leaves behind.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classEntry,
  dialog,
  HARNESS_TIMEOUT,
  hitDiceLeft,
  hp,
  left,
  notice,
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

// Spending a hit die rolls it; a fixed roll keeps the HP numbers exact.
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** A level-3 pact caster with two levels of monk: pact slots and ki, both short rest. */
const pactMonk = () =>
  testCharacter('Hex', [classEntry('Pactcaster', 3), classEntry('Monk', 2)], { cha: 16 });

describe('short rest (TEST-003)', () => {
  it('refills pact slots and ki on screen, and says what it restored', async () => {
    const sheet = await renderSheet(pactMonk());
    expect(pips('Pact slot')).toEqual(['available', 'available']);
    expect(pips('Ki use')).toEqual(['available', 'available']);

    press('Pact slot 1');
    press('Ki use 2');
    expect(pips('Pact slot')).toEqual(['available', 'spent']);
    expect(pips('Ki use')).toEqual(['spent', 'spent']);
    // Saved before resting, as a player's pause would: edits inside one save
    // window fold into one snapshot, and spent-then-restored nets to nothing.
    expect((await sheet.saved()).play.pactSlotsSpent).toBe(1);

    press('Short rest');

    expect(pips('Pact slot')).toEqual(['available', 'available']);
    expect(pips('Ki use')).toEqual(['available', 'available']);
    expect(notice()).toBe('Short rest: Restored Ki, pact slots');
    const saved = await sheet.saved();
    expect(saved.play.pactSlotsSpent).toBe(0);
    expect(saved.play.resources).toEqual([]);
    expect((await sheet.history())[0]).toBe('Short rest');
  });

  it('leaves slots, long-rest pools, HP and hit dice alone', async () => {
    const sheet = await renderSheet(sorcerer());
    // At full HP a hit die heals nothing, so spend it before taking damage.
    press('Spend a d6 hit die, 5 left');
    press('Damage 5 hit points');
    press('Level 1 slot 1');
    press('Sorcery Points use 2');
    const before = { hp: hp().current, dice: hitDiceLeft('d6') };
    expect(before).toEqual({ hp: 22, dice: 4 });

    press('Short rest');

    expect(left('Level 1 slot')).toBe(3);
    expect(left('Sorcery Points use')).toBe(3);
    expect({ hp: hp().current, dice: hitDiceLeft('d6') }).toEqual(before);
    // Nothing short-rest was spent, and the notice does not pretend otherwise.
    expect(notice()).toBe('Short rest: Nothing to restore');
    const saved = await sheet.saved();
    expect(saved.play.slotsSpent[0]).toBe(1);
    expect(saved.play.resources).toEqual([{ key: 'sorcery-points', used: 2 }]);
  });
});

describe('long rest (TEST-003)', () => {
  it('asks first, and Cancel changes nothing', async () => {
    const sheet = await renderSheet(sorcerer());
    press('Damage 5 hit points');
    press('Level 1 slot 1');

    press('Long rest');
    const ask = await dialog('Long rest');
    expect(ask.text).toContain('regain half your hit dice');
    await ask.press('Cancel');

    expect(hp().current).toBe(22);
    expect(left('Level 1 slot')).toBe(3);
    expect(notice()).toBeUndefined();
    expect(await sheet.history()).not.toContain('Long rest');
    // The toast is findable: the next rest's notice does appear, so the
    // undefined above means no notice rather than a toast the helper missed.
    press('Short rest');
    expect(notice()).toBe('Short rest: Nothing to restore');
  });

  it('restores HP, slots and pools, takes an exhaustion level and regains half the hit dice', async () => {
    const sheet = await renderSheet(sorcerer());
    for (let i = 0; i < 3; i++) press(`Spend a d6 hit die, ${5 - i} left`);
    press('Damage 5 hit points');
    press('Damage 5 hit points');
    press('Level 1 slot 1');
    press('Level 3 slot 2');
    press('Sorcery Points use 2');
    press('Increase exhaustion');
    press('Increase exhaustion');
    expect(hp()).toEqual({ current: 17, max: 27, temp: 0 });
    expect(hitDiceLeft('d6')).toBe(2);
    expect(pips('Level 3 slot')).toEqual(['spent', 'spent']);
    await sheet.saved();

    press('Long rest');
    await (await dialog('Long rest')).press('Rest');

    expect(hp()).toEqual({ current: 27, max: 27, temp: 0 });
    expect(pips('Level 1 slot')).toEqual(['available', 'available', 'available', 'available']);
    expect(pips('Level 3 slot')).toEqual(['available', 'available']);
    expect(left('Sorcery Points use')).toBe(5);
    expect(screen.getByText('1 / 6')).toBeTruthy();
    // Half of five dice, rounded down: two of the three spent come back.
    expect(hitDiceLeft('d6')).toBe(4);
    expect(notice()).toBe(
      'Long rest complete: Restored +10 HP, spell slots, resources, 1 exhaustion level, 2 hit dice',
    );
    expect((await sheet.history())[0]).toBe('Long rest');
    const saved = await sheet.saved();
    expect(saved.play.hitDiceSpent).toEqual({ d6: 1 });
    expect(saved.play.slotsSpent.every((n) => n === 0)).toBe(true);
  });
});
