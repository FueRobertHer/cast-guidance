import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import {
  abilitySummary,
  castingTime,
  itemDamage,
  itemValue,
  speedSummary,
  spellComponents,
  spellDuration,
  spellLevel,
  spellRange,
} from './fmt';

describe('spellLevel', () => {
  it('formats cantrips and ordinal levels', () => {
    expect(spellLevel(0)).toBe('Cantrip');
    expect(spellLevel(1)).toBe('1st level');
    expect(spellLevel(2)).toBe('2nd level');
    expect(spellLevel(3)).toBe('3rd level');
    expect(spellLevel(5)).toBe('5th level');
  });
  it('is tolerant of non-numbers', () => {
    expect(spellLevel('x')).toBe('?');
    expect(spellLevel(undefined)).toBe('?');
  });
});

describe('castingTime', () => {
  it('reads the first time entry', () => {
    expect(castingTime([{ number: 1, unit: 'action' }])).toBe('1 action');
    expect(castingTime([{ number: 10, unit: 'minute' }])).toBe('10 minute');
  });
  it('is tolerant of empty/malformed input', () => {
    expect(castingTime([])).toBe('?');
    expect(castingTime(undefined)).toBe('?');
  });
});

describe('spellRange', () => {
  it('formats point, self, and touch ranges', () => {
    expect(spellRange({ type: 'point', distance: { type: 'feet', amount: 60 } })).toBe('60 feet');
    expect(spellRange({ distance: { type: 'self' } })).toBe('Self');
    expect(spellRange({ distance: { type: 'touch' } })).toBe('Touch');
  });
  it('is tolerant of non-objects', () => {
    expect(spellRange(null)).toBe('?');
    expect(spellRange('60 feet')).toBe('?');
  });
});

describe('spellComponents', () => {
  it('joins V/S/M with material text', () => {
    expect(spellComponents({ v: true, s: true })).toBe('V, S');
    expect(spellComponents({ v: true, s: true, m: 'a pinch of sulfur' })).toBe(
      'V, S, M (a pinch of sulfur)',
    );
    expect(spellComponents({ m: { text: 'a diamond' } })).toBe('M (a diamond)');
    expect(spellComponents({ m: true })).toBe('M');
  });
  it('shows an em dash for no components and ? for non-objects', () => {
    expect(spellComponents({})).toBe('—');
    expect(spellComponents(undefined)).toBe('?');
  });
});

describe('spellDuration', () => {
  it('formats instant/permanent/special and timed durations', () => {
    expect(spellDuration([{ type: 'instant' }])).toBe('Instantaneous');
    expect(spellDuration([{ type: 'permanent' }])).toBe('Permanent');
    expect(spellDuration([{ type: 'timed', duration: { type: 'hour', amount: 1 } }])).toBe(
      '1 hour',
    );
    expect(spellDuration([{ type: 'timed', duration: { type: 'minute', amount: 10 } }])).toBe(
      '10 minutes',
    );
  });
  it('prefixes concentration', () => {
    expect(
      spellDuration([
        { type: 'timed', duration: { type: 'minute', amount: 10 }, concentration: true },
      ]),
    ).toBe('Concentration, up to 10 minutes');
  });
  it('is tolerant of empty input', () => {
    expect(spellDuration([])).toBe('?');
  });
});

describe('abilitySummary', () => {
  it('formats fixed bonuses and choose blocks', () => {
    expect(abilitySummary([{ str: 2 }])).toBe('Str +2');
    expect(abilitySummary([{ con: 2, cha: 1 }])).toBe('Con +2, Cha +1');
    expect(abilitySummary([{ choose: { count: 1, amount: 1, from: ['str', 'dex'] } }])).toBe(
      'Choose 1 +1 (Str/Dex)',
    );
  });
  it('is empty for non-arrays', () => {
    expect(abilitySummary(undefined)).toBe('');
  });
});

describe('speedSummary', () => {
  it('handles a plain number and a speed object', () => {
    expect(speedSummary(30)).toBe('30 ft.');
    expect(speedSummary({ walk: 30, fly: 60 })).toBe('30 ft., fly 60 ft.');
  });
  it('is tolerant of non-objects', () => {
    expect(speedSummary('fast')).toBe('?');
  });
});

describe('itemValue', () => {
  it('scales cp into sp/gp', () => {
    expect(itemValue(150)).toBe('1.5 gp');
    expect(itemValue(50)).toBe('5 sp');
    expect(itemValue(5)).toBe('5 cp');
  });
  it('is undefined for non-numbers', () => {
    expect(itemValue(undefined)).toBeUndefined();
  });
});

describe('itemDamage', () => {
  it('joins damage dice with a spelled-out type', () => {
    expect(itemDamage({ dmg1: '1d8', dmgType: 'S' } as Entity)).toBe('1d8 slashing');
    expect(itemDamage({ dmg1: '1d6' } as Entity)).toBe('1d6');
  });
  it('is undefined without damage dice', () => {
    expect(itemDamage({} as Entity)).toBeUndefined();
  });
});
