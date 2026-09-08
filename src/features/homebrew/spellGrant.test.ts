// The builder writes one spell with one limit; the file format can say far
// more. These are the rules for translating the part they share, and for
// recognizing the part they don't so a hand-written file survives an edit.
import { describe, expect, it } from 'vitest';
import { COMPLEX, readSpellGrant, writeSpellGrant } from './spellGrant';

describe('writeSpellGrant', () => {
  it('writes an at-will grant as a known spell', () => {
    expect(writeSpellGrant({ spell: 'prestidigitation' })).toEqual([
      { known: { _: ['prestidigitation'] } },
    ]);
  });

  it('writes a per-day grant as an innate daily bucket', () => {
    expect(writeSpellGrant({ spell: 'misty step', perDay: 2, ability: 'cha' })).toEqual([
      { ability: 'cha', innate: { _: { daily: { '2': ['misty step'] } } } },
    ]);
  });

  it('drops the field when no spell is named', () => {
    expect(writeSpellGrant({ spell: '   ', perDay: 3 })).toBeUndefined();
  });

  it('treats a zero or negative count as at will', () => {
    expect(writeSpellGrant({ spell: 'light', perDay: 0 })).toEqual([{ known: { _: ['light'] } }]);
  });
});

describe('readSpellGrant', () => {
  it('round-trips what the form wrote', () => {
    for (const grant of [
      { spell: 'fire bolt' },
      { spell: 'misty step', perDay: 1 },
      { spell: 'fireball|phb', perDay: 3, ability: 'int' as const },
    ]) {
      expect(readSpellGrant(writeSpellGrant(grant))).toEqual(grant);
    }
  });

  it('reads no grant from an absent field', () => {
    expect(readSpellGrant(undefined)).toBeUndefined();
  });

  it('reads no grant from an ability with nothing to apply it to', () => {
    expect(readSpellGrant([{ ability: 'cha' }])).toBeUndefined();
  });

  it('refuses to speak for a file saying more than the form can', () => {
    // Two spells in one bucket, a level gate, a choice, several entries, and a
    // list the form has no box for: each stays exactly as its author wrote it.
    expect(readSpellGrant([{ known: { _: ['light', 'dancing lights'] } }])).toBe(COMPLEX);
    expect(readSpellGrant([{ known: { '3': ['fireball'] } }])).toBe(COMPLEX);
    expect(readSpellGrant([{ known: { _: [{ choose: 'level=0|class=Wizard' }] } }])).toBe(COMPLEX);
    expect(readSpellGrant([{ known: { _: ['light'] } }, { known: { _: ['bless'] } }])).toBe(
      COMPLEX,
    );
    expect(readSpellGrant([{ expanded: { s1: ['bless'] } }])).toBe(COMPLEX);
    expect(readSpellGrant([{ innate: { _: { rest: { '1': ['bless'] } } } }])).toBe(COMPLEX);
  });

  it('refuses a grant that is both known and innate', () => {
    expect(
      readSpellGrant([{ known: { _: ['light'] }, innate: { _: { daily: { '1': ['bless'] } } } }]),
    ).toBe(COMPLEX);
  });
});

describe('readSpellGrant on damaged files', () => {
  it('reports rather than throws on a null bucket', () => {
    // The builder renders this function's result, so a throw here is a white
    // screen on the whole page, for a file the author can no longer reach.
    expect(readSpellGrant([{ known: null }])).toBe(COMPLEX);
    expect(readSpellGrant([{ innate: null }])).toBe(COMPLEX);
    expect(readSpellGrant([{ innate: { _: null } }])).toBe(COMPLEX);
    expect(readSpellGrant([{ innate: { _: { daily: null } } }])).toBe(COMPLEX);
    expect(readSpellGrant([null])).toBe(COMPLEX);
    expect(readSpellGrant('nonsense')).toBe(COMPLEX);
  });
});
