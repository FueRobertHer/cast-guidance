import { describe, expect, it } from 'vitest';
import { readableName, readableNote } from './readableNames';

describe('names as a person reads them', () => {
  it('capitalises a lowercase key name, keeping small words small', () => {
    expect(readableName('sunblade aegis')).toBe('Sunblade Aegis');
    expect(readableName('potion of healing')).toBe('Potion of Healing');
    expect(readableName('the staff of the magi')).toBe('The Staff of the Magi');
    expect(readableName('half-elf')).toBe('Half-Elf');
  });

  it("keeps an author's own spelling", () => {
    expect(readableName('Bag of Holding')).toBe('Bag of Holding');
    expect(readableName('iPhone of Speaking')).toBe('iPhone of Speaking');
  });
});

describe('the Build notes, read', () => {
  it('reads the keys the engine writes as their names', () => {
    expect(readableNote('Item not found: sunblade aegis|myhomebrew')).toBe(
      'Item not found: Sunblade Aegis',
    );
    expect(readableNote('Race not found: human|xphb (data pack missing or renamed)')).toBe(
      'Race not found: Human (data pack missing or renamed)',
    );
    expect(
      readableNote(
        'Cleric: saved level 4: choose a feat choice “solar tactician|myhomebrew” is no longer available; choose again.',
      ),
    ).toBe(
      'Cleric: saved level 4: choose a feat choice “Solar Tactician” is no longer available; choose again.',
    );
    expect(readableNote('Class feature not found: fighting style|fighter|xphb|1|xphb')).toBe(
      'Class feature not found: Fighting Style',
    );
  });

  it('leaves a note with no key as it is', () => {
    const note = 'Magic Initiate: spellcasting ability is your choice. See the trait text.';
    expect(readableNote(note)).toBe(note);
  });
});
