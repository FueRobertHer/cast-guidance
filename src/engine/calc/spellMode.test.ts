import { describe, expect, it } from 'vitest';
import { classSpellcastingMode, preparedFromFormula } from './slots';

// Field shapes mirror the real 5etools PHB class data (confirmed against the
// pinned dataset).
const CLASSES = {
  sorcerer: { casterProgression: 'full', spellsKnownProgression: [2, 3] },
  bard: { casterProgression: 'full', spellsKnownProgression: [4, 5] },
  cleric: { casterProgression: 'full', preparedSpells: '<$level$> + <$wis_mod$>' },
  paladin: { casterProgression: '1/2', preparedSpells: '<$level$> / 2 + <$cha_mod$>' },
  wizard: {
    casterProgression: 'full',
    preparedSpells: '<$level$> + <$int_mod$>',
    spellsKnownProgressionFixed: [6, 8],
  },
  warlock: { casterProgression: 'pact', spellsKnownProgression: [2, 3] },
  fighter: {}, // no caster progression
} as const;

describe('classSpellcastingMode', () => {
  it('classifies each PHB caster correctly', () => {
    expect(classSpellcastingMode(CLASSES.sorcerer)).toBe('known');
    expect(classSpellcastingMode(CLASSES.bard)).toBe('known');
    expect(classSpellcastingMode(CLASSES.cleric)).toBe('prepared');
    expect(classSpellcastingMode(CLASSES.paladin)).toBe('prepared');
    expect(classSpellcastingMode(CLASSES.wizard)).toBe('spellbook');
    expect(classSpellcastingMode(CLASSES.warlock)).toBe('pact');
    expect(classSpellcastingMode(CLASSES.fighter)).toBe('none');
  });

  it('treats a missing entity as none', () => {
    expect(classSpellcastingMode(undefined)).toBe('none');
  });

  it('lets Pact Magic win even when a known progression is present', () => {
    expect(classSpellcastingMode({ casterProgression: 'pact', spellsKnownProgression: [1] })).toBe(
      'pact',
    );
  });

  it('treats prepared + fixed-known as a spellbook, prepared alone as prepared', () => {
    expect(
      classSpellcastingMode({
        casterProgression: 'full',
        preparedSpells: 'x',
        spellsKnownProgressionFixed: [1],
      }),
    ).toBe('spellbook');
    expect(classSpellcastingMode({ casterProgression: 'full', preparedSpells: 'x' })).toBe(
      'prepared',
    );
  });
});

describe('preparedFromFormula', () => {
  it('adds the whole level for a full caster', () => {
    expect(preparedFromFormula('<$level$> + <$wis_mod$>', 5, 3)).toBe(8);
  });

  it('halves the level, rounded down, for the paladin and artificer', () => {
    expect(preparedFromFormula('<$level$> / 2 + <$cha_mod$>', 5, 3)).toBe(5);
    expect(preparedFromFormula('<$level$> / 2 + <$int_mod$>', 2, 1)).toBe(2);
  });

  it('never goes below one, and reads nothing without a level term', () => {
    expect(preparedFromFormula('<$level$> / 2 + <$cha_mod$>', 1, -1)).toBe(1);
    expect(preparedFromFormula('x', 5, 3)).toBeUndefined();
    expect(preparedFromFormula(undefined, 5, 3)).toBeUndefined();
  });
});
