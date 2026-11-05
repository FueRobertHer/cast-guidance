import { describe, expect, it } from 'vitest';
import { hpSheetCopy, typeDigit } from './HpSheet';

const hp = { currentHp: 19, tempHp: 5, maxHp: 27 };

describe('typeDigit', () => {
  it('adds on the end, three digits at most', () => {
    expect(typeDigit('', '7')).toBe('7');
    expect(typeDigit('7', '2')).toBe('72');
    expect(typeDigit('721', '9')).toBe('721');
  });

  it('keeps a lone zero, and drops it once a digit follows', () => {
    expect(typeDigit('', '0')).toBe('0');
    expect(typeDigit('0', '0')).toBe('0');
    expect(typeDigit('0', '5')).toBe('5');
    expect(typeDigit('10', '0')).toBe('100');
  });
});

describe('hpSheetCopy: damage', () => {
  it('says the damage on the confirm, whatever temp HP does with it', () => {
    expect(hpSheetCopy('damage', '7', hp).confirm).toBe('Take 7 damage');
    expect(hpSheetCopy('damage', '7', hp).ready).toBe(true);
  });

  it('asks for an amount until there is one', () => {
    for (const amount of ['', '0']) {
      const { confirm, ready } = hpSheetCopy('damage', amount, hp);
      expect(confirm).toBe('Enter an amount');
      expect(ready).toBe(false);
    }
  });

  it('explains temp HP going first, as the design words it', () => {
    const line = (amount: string, over = hp) => hpSheetCopy('damage', amount, over).line;
    expect(line('')).toBe('Temp HP absorbs damage first: you have 5.');
    expect(line('3')).toBe('Temp HP absorbs damage first: 3 of your 5, none from 19.');
    expect(line('5')).toBe('Temp HP absorbs damage first: 5 of your 5, none from 19.');
    expect(line('7')).toBe('Temp HP absorbs damage first: 5 temp, then 2 from 19.');
    // Never more than there is to take.
    expect(line('99')).toBe('Temp HP absorbs damage first: 5 temp, then 19 from 19.');
  });

  it('says so when there is no temp HP to absorb it', () => {
    const none = { ...hp, tempHp: 0 };
    expect(hpSheetCopy('damage', '', none).line).toBe(
      'Temp HP absorbs damage first. You have none.',
    );
    expect(hpSheetCopy('damage', '7', none).line).toBe('No temp HP to absorb it: 19 down to 12.');
    expect(hpSheetCopy('damage', '99', none).line).toBe('No temp HP to absorb it: 19 down to 0.');
  });
});

describe('hpSheetCopy: heal', () => {
  it('says what the amount will really heal', () => {
    expect(hpSheetCopy('heal', '5', hp)).toEqual({
      confirm: 'Heal 5 HP',
      ready: true,
      line: '19 up to 24 of 27.',
    });
    expect(hpSheetCopy('heal', '15', hp)).toEqual({
      confirm: 'Heal 8 HP',
      ready: true,
      line: 'Only 8 to reach your maximum of 27.',
    });
  });

  it('asks for an amount until there is one', () => {
    expect(hpSheetCopy('heal', '', hp)).toEqual({
      confirm: 'Enter an amount',
      ready: false,
      line: '8 to reach your maximum of 27.',
    });
  });

  it('has nothing to do at the maximum, or over it on a house rule', () => {
    for (const currentHp of [27, 30]) {
      expect(hpSheetCopy('heal', '5', { ...hp, currentHp })).toEqual({
        confirm: 'Already at full HP',
        ready: false,
        line: 'You are at your maximum of 27.',
      });
    }
  });
});

describe('hpSheetCopy: temp HP', () => {
  it('sets the amount, which replaces what is held', () => {
    expect(hpSheetCopy('temp', '8', hp)).toEqual({
      confirm: 'Set temp HP to 8',
      ready: true,
      line: "Temp HP doesn't stack: this replaces your 5. Enter 0 to clear it.",
    });
  });

  it('clears on a zero that was keyed, never on an empty amount', () => {
    expect(hpSheetCopy('temp', '0', hp).confirm).toBe('Clear 5 temp HP');
    expect(hpSheetCopy('temp', '0', hp).ready).toBe(true);
    expect(hpSheetCopy('temp', '', hp).ready).toBe(false);
  });

  it('has nothing to clear when none is held', () => {
    const none = { ...hp, tempHp: 0 };
    expect(hpSheetCopy('temp', '0', none).ready).toBe(false);
    expect(hpSheetCopy('temp', '', none).line).toMatch(/absorbs damage first/);
  });
});
