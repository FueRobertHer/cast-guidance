import { describe, expect, it } from 'vitest';
import { hasMissingData, missingCharacterData } from './dataNeeds';
import { type CharacterDoc, type EngineContext, newCharacterDoc } from './types';

/** A context holding exactly these `type:name` entries. */
function holding(...entries: string[]): EngineContext {
  return {
    get: (type, name) => (entries.includes(`${type}:${name}`) ? { name, source: 'T' } : undefined),
    byType: () => [],
  };
}

function character(edit: (doc: CharacterDoc) => void = () => undefined): CharacterDoc {
  const doc = newCharacterDoc('c', 'Hero', 't');
  edit(doc);
  return doc;
}

const fighter = (doc: CharacterDoc) => {
  doc.classes = [{ ref: { name: 'Fighter', source: 'T' }, levels: 1, hp: ['avg'] }];
};

const gear = (doc: CharacterDoc, name: string, equipped: boolean) => {
  doc.equipment.push({
    id: name,
    ref: { name, source: 'T' },
    qty: 1,
    equipped,
    attuned: false,
  });
};

describe('missingCharacterData', () => {
  it('needs nothing for a character with no class or gear yet', () => {
    const needs = missingCharacterData(character(), holding());
    expect(needs).toEqual({ classes: [], items: false });
    expect(hasMissingData(needs)).toBe(false);
  });

  it('names each class with no entry, and only those', () => {
    const doc = character((d) => {
      fighter(d);
      d.classes.push({ ref: { name: 'Wizard', source: 'T' }, levels: 1, hp: ['avg'] });
    });
    const needs = missingCharacterData(doc, holding('class:Fighter'));
    expect(needs.classes).toEqual(['Wizard']);
    expect(hasMissingData(needs)).toBe(true);
  });

  it('asks for an equipped item found in none of the item types', () => {
    const doc = character((d) => gear(d, 'Ring', true));
    const needs = missingCharacterData(doc, holding());
    expect(needs.items).toBe(true);
    expect(hasMissingData(needs)).toBe(true);
  });

  it.each(['item', 'baseitem', 'itemGroup'])('finds an equipped item among %s', (type) => {
    const doc = character((d) => gear(d, 'Ring', true));
    expect(missingCharacterData(doc, holding(`${type}:Ring`)).items).toBe(false);
  });

  it('does not wait on gear that changes no number', () => {
    const doc = character((d) => {
      gear(d, 'Backpack', false);
      d.equipment.push({
        id: 'custom',
        qty: 1,
        equipped: true,
        attuned: false,
        custom: { name: 'Lucky Coin' },
      });
    });
    expect(missingCharacterData(doc, holding()).items).toBe(false);
  });
});
