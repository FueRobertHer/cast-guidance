import { describe, expect, it } from 'vitest';
import { makeProficiencyContext } from '../../../tests-fixtures/proficiencyWorld';
import { deriveSheet } from '../derive';
import { type CharacterDoc, newCharacterDoc } from '../types';

const ctx = makeProficiencyContext();

/** Tens across, so an attack's to-hit is its proficiency bonus and nothing else. */
function docOf(...classes: Array<[name: string, source: string]>): CharacterDoc {
  const doc = newCharacterDoc('c', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  doc.classes = classes.map(([name, source]) => ({
    ref: { name, source },
    levels: 1,
    hp: ['avg'],
  }));
  return doc;
}

function holding(doc: CharacterDoc, ...weapons: string[]): CharacterDoc {
  doc.equipment = weapons.map((name, i) => ({
    id: `e${i}`,
    ref: { name, source: 'TST' },
    qty: 1,
    equipped: true,
    attuned: false,
  }));
  return doc;
}

const toHit = (doc: CharacterDoc, weapon: string) =>
  deriveSheet(doc, ctx).attacks.find((a) => a.label === weapon)?.toHit.value;

describe('proficiency names on the sheet', () => {
  it('reads a tag by its display text', () => {
    const sheet = deriveSheet(docOf(['Bard', 'PHB']), ctx);
    expect(sheet.weaponProfs).toEqual([
      'simple',
      'hand crossbows',
      'longswords',
      'rapiers',
      'shortswords',
    ]);
    expect(sheet.toolProfs).toEqual(['three musical instruments of your choice']);
  });

  it('reads a filter tag, whose display text comes first, in the words around it', () => {
    const sheet = deriveSheet(docOf(['Monk', 'XPHB']), ctx);
    expect(sheet.weaponProfs).toEqual(['simple', 'Martial weapons that have the Light property']);
    expect(sheet.toolProfs).toEqual(["Choose one type of Artisan's Tools or Musical Instrument"]);
  });

  it('reads the reduced list a later class gives', () => {
    const sheet = deriveSheet(docOf(['Warrior', 'TST'], ['Bard', 'PHB']), ctx);
    expect(sheet.toolProfs).toEqual(['one musical instrument of your choice']);
  });

  it('leaves the source off a weapon a species names', () => {
    const doc = docOf(['Mage', 'TST']);
    doc.race = { name: 'Elf (High)', source: 'PHB' };
    expect(deriveSheet(doc, ctx).weaponProfs).toEqual([
      'Longsword',
      'Shortsword',
      'Shortbow',
      'Longbow',
    ]);
  });
});

describe('attacks with a weapon proficiency that names the weapon', () => {
  it('adds proficiency for a weapon its class names', () => {
    expect(toHit(holding(docOf(['Bard', 'PHB']), 'Longsword'), 'Longsword')).toBe(2);
    expect(toHit(holding(docOf(['Wizard', 'PHB']), 'Dagger'), 'Dagger')).toBe(2);
  });

  it('adds proficiency for a weapon its species names', () => {
    const doc = holding(docOf(['Mage', 'TST']), 'Longsword');
    doc.race = { name: 'Elf (High)', source: 'PHB' };
    expect(toHit(doc, 'Longsword')).toBe(2);
  });

  it('adds nothing for a weapon the list does not name', () => {
    expect(toHit(holding(docOf(['Wizard', 'PHB']), 'Longsword'), 'Longsword')).toBe(0);
    expect(toHit(holding(docOf(['Mage', 'TST']), 'Longsword'), 'Longsword')).toBe(0);
  });
});
