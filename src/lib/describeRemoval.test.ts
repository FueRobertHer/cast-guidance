import { describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { classRemovalParts } from './describeRemoval';

describe('classRemovalParts', () => {
  const warrior = { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] };
  const mage = { ref: { name: 'Mage', source: 'TST' }, levels: 4, hp: [] };
  const FIRST = 'feat:skilled|tst:asi4:skill';
  const SECOND = 'feat:skilled|tst:asi4@mage|tst:skill';

  it.each([
    ['Warrior', warrior],
    ['Mage', mage],
  ])('counts only the copy %s holds of a feat both classes took', (name, entry) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [warrior, mage];
    doc.choices = {
      'class:warrior|tst:asi:4:feat': ['skilled|tst'],
      'class:mage|tst:asi:4:feat': ['skilled|tst'],
      [FIRST]: ['stealth', 'history'],
      [SECOND]: ['arcana', 'nature'],
    };
    expect(classRemovalParts(doc, entry, new Set([FIRST, SECOND]))).toEqual([`2 ${name} picks`]);
  });
});
