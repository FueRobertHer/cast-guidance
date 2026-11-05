import { describe, expect, it } from 'vitest';
import { spellMeta, spellSaves } from './spellMeta';

const bolt = {
  name: 'Bolt',
  source: 'TST',
  level: 1,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'point', distance: { type: 'feet', amount: 120 } },
  duration: [{ type: 'instant' }],
};

describe('spellMeta', () => {
  it('leaves the usual action and an instant duration unsaid', () => {
    expect(spellMeta(bolt)).toBe('Evocation · 120 ft');
  });

  it('says the level only where the list does not', () => {
    expect(spellMeta(bolt, { withLevel: true })).toBe('Level 1 · Evocation · 120 ft');
    expect(spellMeta({ ...bolt, level: 0 }, { withLevel: true })).toBe(
      'Cantrip · Evocation · 120 ft',
    );
  });

  it('says a range that is not a distance as it is', () => {
    const touch = { type: 'point', distance: { type: 'touch' } };
    expect(spellMeta({ ...bolt, range: touch })).toBe('Evocation · Touch');
    const aura = { type: 'radius', distance: { type: 'feet', amount: 15 } };
    expect(spellMeta({ ...bolt, range: aura })).toBe('Evocation · Self (15 ft radius)');
  });

  it('says a casting time other than an action, then a save, then a duration', () => {
    expect(
      spellMeta({
        ...bolt,
        time: [{ number: 1, unit: 'bonus' }],
        savingThrow: ['wisdom'],
        duration: [{ type: 'timed', duration: { type: 'hour', amount: 8 } }],
      }),
    ).toBe('Evocation · 120 ft · bonus action · WIS save · 8 hours');
    expect(spellMeta({ ...bolt, time: [{ number: 1, unit: 'reaction' }] })).toBe(
      'Evocation · 120 ft · reaction',
    );
  });

  it('says a concentration spell lasts up to its time, and is running once it is', () => {
    const held = {
      ...bolt,
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
    };
    expect(spellMeta(held)).toBe('Evocation · 120 ft · up to 1 minute');
    expect(spellMeta(held, { concentrating: true })).toBe('Evocation · 120 ft · concentrating');
  });

  it('skips what the data does not say, and says when no file holds the spell', () => {
    expect(spellMeta({ name: 'Bare', source: 'TST', level: 1 })).toBe('');
    expect(spellMeta(undefined)).toBe('Level unknown: not in the downloaded data');
  });
});

describe('spellSaves', () => {
  it('shortens each ability the way the table says it', () => {
    expect(spellSaves({ ...bolt, savingThrow: ['dexterity', 'constitution'] })).toEqual([
      'DEX',
      'CON',
    ]);
    expect(spellSaves(bolt)).toEqual([]);
    expect(spellSaves(undefined)).toEqual([]);
  });
});
