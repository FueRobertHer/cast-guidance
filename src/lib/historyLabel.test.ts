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

  it('names spell slots, pact slots and hit dice instead of "Play state"', () => {
    const spent = base();
    spent.play.slotsSpent = [0, 1, 0];
    expect(historyLabel(base(), spent)).toBe('Spent a level 2 slot');
    expect(historyLabel(spent, base())).toBe('Regained a level 2 slot');

    const pact = base();
    pact.play.pactSlotsSpent = 1;
    expect(historyLabel(base(), pact)).toBe('Spent a pact slot');

    const die = base();
    die.play.hitDiceSpent = { d6: 1 };
    expect(historyLabel(base(), die)).toBe('Spent a hit die (d6)');
    expect(historyLabel(die, base())).toBe('Regained a hit die (d6)');
  });

  it('names resource use with a readable key', () => {
    const used = base();
    used.play.resources = [{ key: 'relentless-endurance', used: 1 }];
    expect(historyLabel(base(), used)).toBe('Used relentless endurance');
    expect(historyLabel(used, base())).toBe('Restored relentless endurance');
  });

  it('names death saves, concentration and inspiration', () => {
    const failed = base();
    failed.play.deathSaves = { success: 0, fail: 2 };
    expect(historyLabel(base(), failed)).toBe('Death save failed (2/3)');

    const saved = base();
    saved.play.deathSaves = { success: 1, fail: 0 };
    expect(historyLabel(base(), saved)).toBe('Death save succeeded (1/3)');
    expect(historyLabel(saved, base())).toBe('Death saves cleared');

    const conc = base();
    conc.play.concentratingOn = { label: 'Bless' };
    expect(historyLabel(base(), conc)).toBe('Concentrating on Bless');
    expect(historyLabel(conc, base())).toBe('Concentration ended');

    const insp = base();
    insp.play.inspiration = true;
    expect(historyLabel(base(), insp)).toBe('Inspiration gained');
    expect(historyLabel(insp, base())).toBe('Inspiration used');
  });

  it('names the slice of the turn spent', () => {
    const acted = base();
    acted.play.turn = { action: true, bonus: false, reaction: false };
    expect(historyLabel(base(), acted)).toBe('Used action');

    const both = base();
    both.play.turn = { action: true, bonus: true, reaction: false };
    expect(historyLabel(base(), both)).toBe('Used action + bonus');
  });

  it('calls a cleared turn an undo, because End turn labels itself', () => {
    // Un-ticking a used pip and pressing End turn produce identical diffs, so
    // guessing "Turn ended" here would mislabel the far commoner undo. The
    // End turn button passes its own label instead (see PlayTab).
    const acted = base();
    acted.play.turn = { action: true, bonus: false, reaction: false };
    const both = base();
    both.play.turn = { action: true, bonus: true, reaction: false };
    const fresh = base();
    fresh.play.turn = { action: false, bonus: false, reaction: false };

    expect(historyLabel(acted, fresh)).toBe('Freed action');
    expect(historyLabel(both, fresh)).toBe('Freed action + bonus');
  });

  it('falls back to "Play state" only when nothing else named the change', () => {
    // A resource row appearing with used: 0 moves play state but matches no
    // specific label. 'Play state' is vague, but it beats 'Edited', which
    // implies the change was somewhere else entirely.
    const next = base();
    next.play.resources = [{ key: 'rage', used: 0 }];
    expect(historyLabel(base(), next)).toBe('Play state');
  });

  it('never surfaces the hpInitialized bookkeeping flag', () => {
    const next = base();
    next.play.hpInitialized = !(base().play.hpInitialized ?? false);
    expect(historyLabel(base(), next)).toBe('Edited');
  });

  it('leads with the pick a player scans for, not expiring temp HP', () => {
    const prev = base();
    prev.play.tempHp = 4;
    const next = base();
    next.play.tempHp = 0;
    next.play.slotsSpent = [1];
    next.play.hitDiceSpent = { d6: 1 };
    // Only three labels survive the cap, and the drawer truncates to roughly
    // one, so temp HP must not crowd out the slot and die that went with it.
    expect(historyLabel(prev, next)).toBe(
      'Spent a level 1 slot · Spent a hit die (d6) · Temp HP → 0',
    );
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
