import { describe, expect, it } from 'vitest';
import {
  entriesText,
  onlyRoll,
  setDiceOf,
  setsDice,
  slotLevelsLabel,
  slotLevelsOf,
  tagLevels,
  textUpcastTag,
} from './upcast';

describe('tagLevels', () => {
  it('reads ranges and lists, sorted', () => {
    expect(tagLevels('2-9')).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tagLevels('2,4,6,8')).toEqual([2, 4, 6, 8]);
    expect(tagLevels('8, 2-3')).toEqual([2, 3, 8]);
  });

  it('reads nothing from any other shape', () => {
    expect(tagLevels('')).toBeUndefined();
    expect(tagLevels('2-9|1d6')).toBeUndefined();
    expect(tagLevels('third')).toBeUndefined();
  });
});

describe('slotLevelsOf', () => {
  it.each([
    ['When you cast it using a spell slot of 7th level or higher', [7, 8, 9]],
    ['When you cast this spell using a spell slot of 5th or 6th level', [5, 6]],
    ['When you cast this spell using a 3rd- or 4th-level spell slot', [3, 4]],
    ['If you use a level 5-6 spell slot', [5, 6]],
    ['If you use a level 7+ spell slot', [7, 8, 9]],
  ])('reads "%s"', (sentence, levels) => {
    expect(slotLevelsOf(sentence)).toEqual(levels);
  });

  it('reads the slot phrase nearest the end', () => {
    expect(
      slotLevelsOf(
        'Using a 3rd- or 4th-level spell slot, it is 3d8, and using a 5th- or 6th-level spell slot, it is ',
      ),
    ).toEqual([5, 6]);
    expect(
      slotLevelsOf(
        'With a spell slot of 7th level or higher, it is 5d8, and with a spell slot of 5th or 6th level, ',
      ),
    ).toEqual([5, 6]);
  });

  it('reads nothing from a sentence that names no slots', () => {
    expect(
      slotLevelsOf('The damage increases by 1d6 for each slot level above 1st'),
    ).toBeUndefined();
  });
});

describe('slotLevelsLabel', () => {
  it.each([
    [[4, 6, 8], '4, 6 and 8'],
    [[6, 5], '5 and 6'],
    [[7, 8, 9], '7 to 9'],
    [[3], '3'],
    [[], ''],
  ])('labels %j as "%s"', (levels, label) => {
    expect(slotLevelsLabel(levels)).toBe(label);
  });
});

describe('setsDice', () => {
  it('reads "increases to" at the end of the words before a tag', () => {
    expect(setsDice('the extra damage increases to ')).toBe(true);
    expect(setsDice('the damage each increase to')).toBe(true);
    expect(setsDice('the damage increases by ')).toBe(false);
    expect(setsDice('increases to +2, and the damage ')).toBe(false);
  });

  it('reads a tag followed by "for each" or "for every" as a step', () => {
    expect(setsDice('the damage increases to ', ' for each slot level above 2nd.')).toBe(false);
    expect(setsDice('the damage increases to ', ' for every two slot levels.')).toBe(false);
    expect(setsDice('the damage increases to ', '.')).toBe(true);
  });
});

describe('entriesText', () => {
  it('flattens strings, names, entries, items and rows', () => {
    expect(
      entriesText([
        'One.',
        { type: 'entries', name: 'Two', entries: ['Three.'] },
        { type: 'list', items: ['Four.'] },
        { type: 'table', rows: [['Five', 'Six']] },
      ]),
    ).toBe('One.\nTwo\nThree.\nFour.\nFive\nSix');
  });
});

describe('onlyRoll', () => {
  it('finds the one roll of a kind and die', () => {
    expect(onlyRoll('takes {@damage 2d8} cold and {@dice 1d8} more', 'damage', '8')).toBe('2d8');
    expect(onlyRoll('takes {@damage 2d8+3} cold', 'damage', '8')).toBe('2d8+3');
  });

  it('finds nothing when there are two different rolls of the die, or none', () => {
    expect(onlyRoll('{@damage 2d8} then {@damage 1d8}', 'damage', '8')).toBeUndefined();
    expect(onlyRoll('{@damage 2d6}', 'damage', '8')).toBeUndefined();
  });

  it('counts the same roll twice as one', () => {
    expect(onlyRoll('{@damage 1d10} now and {@damage 1d10} later', 'damage', '10')).toBe('1d10');
  });
});

describe('textUpcastTag', () => {
  const entries = ['The target takes {@damage 3d6} fire damage.'];

  it('builds a damage tag from a step the text states', () => {
    expect(
      textUpcastTag(
        entries,
        ['The damage increases by {@damage 1d6} for each slot level above 2nd.'],
        2,
      ),
    ).toBe('{@scaledamage 3d6|2-9|1d6}');
  });

  it('builds a healing tag over the healing roll', () => {
    expect(
      textUpcastTag(
        ['The target regains {@dice 2d8} hit points.'],
        ['The healing increases by {@dice 1d8} for each spell slot level above 1.'],
        1,
      ),
    ).toBe('{@scaledice 2d8|1-9|1d8}');
  });

  it('builds nothing for a capped step, two steps, or no step', () => {
    expect(
      textUpcastTag(
        entries,
        [
          'The damage increases by {@damage 1d6} for each slot level above 2nd, to a maximum of 6d6.',
        ],
        2,
      ),
    ).toBeUndefined();
    expect(
      textUpcastTag(
        entries,
        [
          'The initial damage increases by {@damage 1d6} and the later damage by {@damage 1d6} for each slot level above 2nd.',
        ],
        2,
      ),
    ).toBeUndefined();
    expect(
      textUpcastTag(
        entries,
        ['You can target one more creature for each slot level above 2nd.'],
        2,
      ),
    ).toBeUndefined();
  });
});

describe('setDiceOf', () => {
  it('reads the dice each sentence sets, with the roll they replace', () => {
    expect(
      setDiceOf(
        ['It deals {@damage 2d8} psychic damage.'],
        [
          'When you cast this spell using a 3rd- or 4th-level spell slot, the damage increases to {@damage 3d8}. When you cast it using a spell slot of 7th level or higher, the damage increases to {@damage 5d8}.',
        ],
      ),
    ).toEqual([
      { base: '2d8', levels: [3, 4], expr: '3d8' },
      { base: '2d8', levels: [7, 8, 9], expr: '5d8' },
    ]);
  });

  it('reads a scale tag in that place as the roll it names and its new dice', () => {
    expect(
      setDiceOf(
        ['An extra {@damage 1d4} damage.'],
        [
          'When you cast this spell using a spell slot of 5th or 6th level, the extra damage increases to {@scaledamage 1d4|3-9|2d4}.',
        ],
      ),
    ).toEqual([{ base: '1d4', levels: [5, 6], expr: '2d4' }]);
  });

  it('sets nothing where the slots cannot be read, or the roll is not the only one of its die', () => {
    expect(
      setDiceOf(['{@damage 2d8}'], ['At higher levels, the damage increases to {@damage 3d8}.']),
    ).toEqual([]);
    expect(
      setDiceOf(
        ['{@damage 2d8} now and {@damage 1d8} later'],
        ['If you use a level 7+ spell slot, the damage increases to {@damage 5d8}.'],
      ),
    ).toEqual([]);
  });

  it('skips a step ("increases by"), which is not dice set outright', () => {
    expect(
      setDiceOf(
        ['{@damage 2d8}'],
        ['If you use a level 7+ spell slot, the damage increases by {@damage 1d8}.'],
      ),
    ).toEqual([]);
  });
});
