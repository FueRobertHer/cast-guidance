import { describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { pruneChoicesFor } from './pruneChoices';

describe('pruneChoicesFor', () => {
  it('drops only choices belonging to the given origin', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'race:elf|phb:skill:0': ['perception'],
      'race:elf|phb:language:0': ['elvish'],
      'background:sage|phb:skill:0': ['arcana'],
      'class:wizard|phb:asi:4': ['int'],
    };
    pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' });
    expect(Object.keys(doc.choices).sort()).toEqual([
      'background:sage|phb:skill:0',
      'class:wizard|phb:asi:4',
    ]);
  });

  it('matches the ref case-insensitively and leaves unrelated picks', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = { 'background:sage|phb:skill:0': ['arcana'] };
    pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' });
    expect(Object.keys(doc.choices)).toEqual(['background:sage|phb:skill:0']);
  });
});
