/**
 * A homebrew condition's moments (ADR-002 D7): the entries in force are moment
 * subjects, so what their `castGuidance.moments` say happens while the
 * condition is on. Conditions are invented.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { homebrewConditionEffects } from './conditions';
import { deriveSheet } from './derive';
import { collectMoments } from './moments';
import { type DataEntity, type EngineContext, newCharacterDoc } from './types';

const cue = (text: string) => [{ at: 'turnStart', do: [{ kind: 'cue', text }] }];
const condition = (name: string, guidance: Record<string, unknown>) => ({
  name,
  source: 'MyHomebrew',
  entries: ['Invented.'],
  castGuidance: { v: 1, ...guidance },
});

const ENTRIES: Record<string, Record<string, unknown>> = {
  bleeding: condition('Bleeding', {
    effects: [{ kind: 'acBonus', amount: -1 }],
    moments: cue('Lose 1d4 hit points'),
  }),
  // Moments and nothing else to count.
  haunted: condition('Haunted', { moments: cue('A voice calls your name') }),
  // Effects and no moments.
  dazed: condition('Dazed', { effects: [{ kind: 'acBonus', amount: -2 }] }),
  // Holds the other three off.
  warded: condition('Warded', {
    effects: [
      { kind: 'conditionImmune', condition: 'Bleeding' },
      { kind: 'conditionImmune', condition: 'Haunted' },
    ],
  }),
  // A built-in condition's name: the app's own to count.
  poisoned: condition('Poisoned', { moments: cue('Never said') }),
};
const entryOf = (name: string) => ENTRIES[name.trim().toLowerCase()];
const labels = (ids: Array<{ id: string; ignored?: boolean }>, immune: string[] = []) =>
  homebrewConditionEffects(ids, entryOf, {
    immune: immune.map((c) => ({ condition: c, origin: 'Amulet' })),
  }).subjects.map((s) => s.label);

describe('homebrew condition moments', () => {
  it('are the moments of each condition in force, those with moments alone too', () => {
    expect(labels([{ id: 'Bleeding' }, { id: 'Haunted' }, { id: 'Dazed' }])).toEqual([
      'Bleeding',
      'Haunted',
    ]);
  });

  it('count nothing from one switched off, held off by an immunity, or built in', () => {
    expect(
      labels([
        { id: 'Bleeding', ignored: true },
        { id: 'Haunted', ignored: true },
      ]),
    ).toEqual([]);
    expect(labels([{ id: 'Bleeding' }, { id: 'Haunted' }], ['bleeding', 'Haunted'])).toEqual([]);
    expect(labels([{ id: 'Poisoned' }])).toEqual([]);
  });

  it('count nothing from one another condition in force holds off', () => {
    expect(labels([{ id: 'Bleeding' }, { id: 'Haunted' }, { id: 'Warded' }])).toEqual([]);
  });

  it('read as moments, named for the condition', () => {
    const { subjects } = homebrewConditionEffects([{ id: 'Haunted' }], entryOf);
    const read = collectMoments(subjects, { byType: () => [] }, 'hero');
    expect(read.problems).toEqual([]);
    expect(read.moments).toEqual([
      {
        at: 'turnStart',
        do: [{ kind: 'cue', text: 'A voice calls your name', tone: 'info' }],
        from: 'Haunted',
      },
    ]);
  });

  it("reach the sheet's moments while the condition is on, and leave them when it is off", () => {
    const base = makeTestContext();
    const ctx: EngineContext = {
      get: (t, n, s) => base.get(t, n, s),
      byType: (t) =>
        t === 'condition'
          ? [...base.byType(t), ...(Object.values(ENTRIES) as DataEntity[])]
          : base.byType(t),
    };
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    doc.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
    ];
    expect(deriveSheet(doc, ctx).moments).toBeUndefined();
    doc.play.conditions = [{ id: 'Bleeding' }];
    const on = deriveSheet(doc, ctx);
    expect(on.moments?.moments.map((m) => [m.at, m.from])).toEqual([['turnStart', 'Bleeding']]);
    doc.play.conditions = [{ id: 'Bleeding', ignored: true }];
    expect(deriveSheet(doc, ctx).moments).toBeUndefined();
  });
});
