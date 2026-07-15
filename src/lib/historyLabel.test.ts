import { describe, expect, it } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { historyLabel } from './historyLabel';

const base = (): CharacterDoc => {
  const d = newCharacterDoc('c', 'Hero', 't');
  d.classes = [{ ref: { name: 'Wizard', source: 'PHB' }, levels: 1, hp: ['avg'] }];
  return d;
};

describe('historyLabel', () => {
  it('labels the first snapshot', () => {
    expect(historyLabel(undefined, base())).toBe('Snapshot');
  });

  it('labels a rename', () => {
    const next = base();
    next.name = 'Gandalf';
    expect(historyLabel(base(), next)).toBe('Renamed to Gandalf');
  });

  it('labels a level up and an added/removed class', () => {
    const up = base();
    up.classes[0] = { ...up.classes[0], levels: 2 } as CharacterDoc['classes'][number];
    expect(historyLabel(base(), up)).toBe('Level up: Wizard 2');

    const added = base();
    added.classes.push({ ref: { name: 'Cleric', source: 'PHB' }, levels: 1, hp: ['avg'] });
    expect(historyLabel(base(), added)).toBe('Added Cleric');

    expect(historyLabel(added, base())).toBe('Removed Cleric');
  });

  it('labels an HP change specifically', () => {
    const next = base();
    next.play.currentHp = 3;
    const prev = base();
    prev.play.currentHp = 8;
    expect(historyLabel(prev, next)).toBe('HP 8→3');
  });

  it('names equipment added and removed', () => {
    const withSword = base();
    withSword.equipment = [
      {
        id: 'e1',
        ref: { name: 'Longsword', source: 'PHB' },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    expect(historyLabel(base(), withSword)).toBe('Added Longsword');
    expect(historyLabel(withSword, base())).toBe('Removed Longsword');
  });

  it('names a prepared spell change', () => {
    const prepared = base();
    prepared.spellcasting = {
      Wizard: { known: [], prepared: [{ name: 'Bless', source: 'PHB' }] },
    };
    expect(historyLabel(base(), prepared)).toBe('Prepared Bless');
    expect(historyLabel(prepared, base())).toBe('Unprepared Bless');
  });

  it('names a condition added or removed', () => {
    const poisoned = base();
    poisoned.play.conditions = [{ id: 'Poisoned' }];
    expect(historyLabel(base(), poisoned)).toBe('Poisoned added');
    expect(historyLabel(poisoned, base())).toBe('Poisoned removed');
  });

  it('names a condition level change (Exhaustion 2 → 3)', () => {
    const two = base();
    two.play.conditions = [{ id: 'Exhaustion', level: 2 }];
    const three = base();
    three.play.conditions = [{ id: 'Exhaustion', level: 3 }];
    expect(historyLabel(two, three)).toBe('Exhaustion → 3');
  });

  it('names an equipment swap and a learned spell', () => {
    const withDagger = base();
    withDagger.equipment = [
      { id: 'e1', ref: { name: 'Dagger', source: 'PHB' }, qty: 1, equipped: true, attuned: false },
    ];
    const withSword = base();
    withSword.equipment = [
      {
        id: 'e1',
        ref: { name: 'Longsword', source: 'PHB' },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    expect(historyLabel(withDagger, withSword)).toBe('Gear: +Longsword −Dagger');

    const learned = base();
    learned.spellcasting = {
      Wizard: { known: [{ name: 'Fireball', source: 'PHB' }], prepared: [] },
    };
    expect(historyLabel(base(), learned)).toBe('Learned Fireball');
  });

  it('falls back to Edited when nothing recognizable changed', () => {
    // structuredClone-equal docs → no labels
    const prev = base();
    expect(historyLabel(prev, base())).toBe('Edited');
  });

  it('caps at three labels with an ellipsis', () => {
    const next = base();
    next.name = 'X';
    next.rulesVersion = '2024';
    next.notes = 'hi';
    next.play.currentHp = 5;
    const label = historyLabel(base(), next);
    expect(label.endsWith(' · …')).toBe(true);
    expect(label.split(' · ')).toHaveLength(4); // 3 labels + the ellipsis token
  });
});
