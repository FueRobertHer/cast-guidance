import { describe, expect, it } from 'vitest';
import {
  type Draft,
  type DraftPart,
  describedEffect,
  keptEffects,
  keptFrom,
  newDraft,
  notReady,
  partsOf,
} from './describedEffect';
import { forget, keepOn } from './keptList';

const draft = (parts: DraftPart[], more: Partial<Draft> = {}): Draft => ({
  ...newDraft('Ember blessing'),
  parts,
  ...more,
});

describe('a described part as stored parts', () => {
  it('raises each number picked, and speed by 5 ft a step', () => {
    expect(
      partsOf(
        { kind: 'num', targets: ['Armor Class', 'Attacks', 'Damage', 'Saves', 'Speed'], n: 2 },
        'X',
      ).parts,
    ).toEqual([
      { kind: 'acBonus', amount: 2 },
      { kind: 'attackBonus', scope: 'all', amount: 2, attack: 'any' },
      { kind: 'damageBonus', scope: 'all', amount: 2 },
      { kind: 'saveBonus', amount: 2 },
      { kind: 'speedBonus', amount: 10 },
    ]);
  });

  it('raises every check, initiative with them, and initiative alone when checks are not picked', () => {
    expect(partsOf({ kind: 'num', targets: ['Checks', 'Initiative'], n: 1 }, 'X').parts).toEqual([
      { kind: 'checkBonus', amount: 1, every: true },
    ]);
    expect(partsOf({ kind: 'num', targets: ['Initiative'], n: 3 }, 'X').parts).toEqual([
      { kind: 'initiativeBonus', amount: 3 },
    ]);
  });

  it('rolls a die in, on damage as a rider, or offers it once after the roll', () => {
    expect(
      partsOf({ kind: 'die', count: 2, d: 6, on: ['Attacks', 'Damage', 'Saves'], when: 'in' }, 'X')
        .parts,
    ).toEqual([
      { kind: 'rollDie', dice: '2d6', on: { rolls: ['attack', 'save'] } },
      { kind: 'damageDie', scope: 'all', dice: '2d6' },
    ]);
    expect(
      partsOf({ kind: 'die', count: 1, d: 8, on: ['Checks', 'Damage'], when: 'wait' }, 'X').parts,
    ).toEqual([{ kind: 'rollOffer', dice: '1d8', on: { rolls: ['check'] }, once: true }]);
  });

  it('gives advantage, rerolls as a line, and cuts each damage type picked', () => {
    expect(partsOf({ kind: 'adv', on: ['Saves', 'Checks'] }, 'X').parts).toEqual([
      { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check', 'save'] } },
    ]);
    expect(partsOf({ kind: 'reroll', on: ['Attacks', 'Saves'], n: 2 }, 'X').parts).toEqual([
      {
        kind: 'cue',
        tone: 'help',
        text: 'Reroll the d20 of an attack roll or a saving throw, 2 times',
      },
    ]);
    expect(partsOf({ kind: 'cut', mode: 'resist', types: ['Fire', 'Cold'] }, 'X').parts).toEqual([
      { kind: 'resist', damageType: 'fire' },
      { kind: 'resist', damageType: 'cold' },
    ]);
    expect(partsOf({ kind: 'cut', mode: 'immune', types: ['Poison'] }, 'X').parts).toEqual([
      { kind: 'immune', damageType: 'poison' },
    ]);
  });

  it('blocks conditions, gives hit points, moves, and adds a box for one more action', () => {
    expect(partsOf({ kind: 'cond', on: ['Charmed'] }, 'X').parts).toEqual([
      { kind: 'conditionImmune', condition: 'Charmed' },
    ]);
    expect(partsOf({ kind: 'hp', mode: 'temp', n: 7 }, 'X')).toEqual({ parts: [], tempHp: 7 });
    expect(partsOf({ kind: 'hp', mode: 'max', n: 5 }, 'X').parts).toEqual([
      { kind: 'maxHpBonus', amount: 5 },
    ]);
    expect(partsOf({ kind: 'move', mode: 'faster', feet: 10 }, 'X').parts).toEqual([
      { kind: 'speedBonus', amount: 10 },
    ]);
    expect(partsOf({ kind: 'move', mode: 'fly', feet: 60 }, 'X').parts).toEqual([
      { kind: 'moveSpeed', mode: 'fly', speed: 60 },
    ]);
    expect(partsOf({ kind: 'move', mode: 'swim', feet: 10 }, 'X').parts).toEqual([
      { kind: 'moveSpeed', mode: 'swim', speed: 'walk' },
    ]);
    expect(partsOf({ kind: 'turn', what: 'bonus' }, 'Ember blessing').parts).toEqual([
      {
        kind: 'extraAction',
        label: 'Ember blessing bonus action',
        note: 'one more bonus action each turn',
      },
    ]);
  });

  it('writes what it does, what it costs and a note as lines, and nothing while empty', () => {
    expect(partsOf({ kind: 'act', name: 'Ember lash', dice: '2d6 fire' }, 'X').parts).toEqual([
      { kind: 'cue', tone: 'help', text: 'Ember lash: 2d6 fire' },
    ]);
    expect(partsOf({ kind: 'cost', text: ' Speed 0 ' }, 'X').parts).toEqual([
      { kind: 'cue', tone: 'warn', text: 'Speed 0' },
    ]);
    expect(partsOf({ kind: 'note', text: 'Glows' }, 'X').parts).toEqual([
      { kind: 'cue', tone: 'info', text: 'Glows' },
    ]);
    expect(partsOf({ kind: 'act', name: ' ', dice: '1d6' }, 'X').parts).toEqual([]);
    expect(partsOf({ kind: 'note', text: '' }, 'X').parts).toEqual([]);
    expect(partsOf({ kind: 'cut', mode: 'resist', types: [] }, 'X').parts).toEqual([]);
  });

  it('narrowed to a moment, says what it does and when, and changes no number', () => {
    expect(
      partsOf({ kind: 'num', targets: ['Saves'], n: 1, only: 'Only against poison' }, 'X'),
    ).toEqual({
      parts: [{ kind: 'cue', tone: 'help', text: '+1 to every saving throw, only against poison' }],
    });
    expect(partsOf({ kind: 'hp', mode: 'temp', n: 5, only: 'while raging' }, 'X')).toEqual({
      parts: [{ kind: 'cue', tone: 'help', text: '5 temporary hit points, only while raging' }],
    });
    // Blank is always.
    expect(partsOf({ kind: 'adv', on: ['Saves'], only: '  ' }, 'X').parts[0]?.kind).toBe(
      'rollAdvantage',
    );
  });
});

describe('a description as an effect', () => {
  it('lands with its name, its parts, the most temporary hit points, and when it ends', () => {
    const { effect, tempHp } = describedEffect(
      draft(
        [
          { kind: 'hp', mode: 'temp', n: 5 },
          { kind: 'num', targets: ['Armor Class'], n: 1 },
          { kind: 'hp', mode: 'temp', n: 8 },
        ],
        { name: '  Ember blessing ', ends: 'long' },
      ),
      'id1',
    );
    expect(effect).toEqual({
      id: 'id1',
      name: 'Ember blessing',
      parts: [{ kind: 'acBonus', amount: 1 }],
      lasts: { rest: 'long' },
    });
    expect(tempHp).toBe(8);
    expect(describedEffect(draft([], { ends: 'concentration' }), 'a').effect.lasts).toEqual({
      concentration: true,
    });
    expect(describedEffect(draft([], { ends: 'short' }), 'a').effect.lasts).toEqual({
      rest: 'short',
    });
    expect('lasts' in describedEffect(draft([]), 'a').effect).toBe(false);
  });

  it('waits for a name, then for something it does', () => {
    expect(notReady(draft([{ kind: 'note', text: 'x' }], { name: ' ' }))).toBe('Name it to add it');
    expect(notReady(draft([{ kind: 'note', text: '' }]))).toBe('Say what it does to add it');
    expect(notReady(draft([{ kind: 'hp', mode: 'temp', n: 3 }]))).toBeUndefined();
  });
});

describe('a description kept for next time', () => {
  it('keeps what it does, and reads back only what this version can read whole', () => {
    const kept = keptFrom(
      draft([
        { kind: 'cut', mode: 'resist', types: ['Fire'] },
        { kind: 'hp', mode: 'temp', n: 4 },
      ]),
      'k1',
    );
    expect(kept).toEqual({
      id: 'k1',
      name: 'Ember blessing',
      parts: [{ kind: 'resist', damageType: 'fire' }],
      tempHp: 4,
    });
    const stored = [
      kept,
      { id: 'k2', name: 'Future', parts: [{ kind: 'timeStop' }], tempHp: -3 },
      'junk',
    ];
    // Future holds a part this version cannot read, so it is not offered at all.
    expect(keptEffects(stored)).toEqual([kept]);
    expect(keptEffects([{ id: 'k4', name: 'Odd', parts: [], tempHp: -3 }])).toEqual([
      { id: 'k4', name: 'Odd', parts: [] },
    ]);
    expect(keptEffects(undefined)).toEqual([]);
  });

  it('replaces one of its name, keeps what it cannot read, and forgets by id', () => {
    const one = { id: 'a', name: 'Ember blessing', parts: [] };
    const other = { id: 'b', name: 'Frost ward', parts: [] };
    const unread = { id: 'c', parts: [{ kind: 'timeStop' }] };
    const again = { id: 'd', name: 'ember Blessing', parts: [{ kind: 'acBonus', amount: 1 }] };
    expect(keepOn([one, other, unread], again as never)).toEqual([other, unread, again]);
    expect(keepOn(undefined, one)).toEqual([one]);
    expect(forget([one, other], 'a')).toEqual([other]);
    expect(forget([one], 'a')).toBeUndefined();
  });
});
