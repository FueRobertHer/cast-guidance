import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import { rollEffects } from '../playRules';
import { type EffectInput, type EffectOrigin, type EngineContext, newCharacterDoc } from '../types';
import { ROLL_ADVANTAGES } from './rollAdvantages';
import { emitRollExtras, ROLL_EXTRAS } from './rollExtras';

const empty: EngineContext = { get: () => undefined, byType: () => [] };
const origin: EffectOrigin = { label: 'Feature', uid: 'feature|tst', type: 'feat' };

function emit(keys: string[], level?: number) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
  const found = emitRollExtras(col, keys, origin, level);
  return {
    found,
    rows: col.effects.filter(
      (e): e is Extract<EffectInput, { kind: 'rollDie' | 'rollPaid' }> =>
        e.kind === 'rollDie' || e.kind === 'rollPaid',
    ),
  };
}

describe('the roll extras table', () => {
  it('keys every row in lowercase, and words when it holds as the prompt reads it', () => {
    for (const [key, rows] of Object.entries(ROLL_EXTRAS)) {
      expect(key).toBe(key.toLowerCase());
      for (const row of rows) {
        if (row.free === true || row.when === undefined) continue;
        expect(row.when, key).toMatch(/^Only /);
        expect(row.when, key).not.toMatch(/[–—.]$/);
      }
    }
  });

  it('gives every paid row one thing to add, and a flat bonus only once the d20 shows', () => {
    for (const [key, rows] of Object.entries(ROLL_EXTRAS)) {
      for (const row of rows) {
        if (row.free === true) continue;
        const adds = [row.dice, row.poolDie, row.bonus, row.advantage].filter(
          (x) => x !== undefined,
        );
        expect(adds, key).toHaveLength(1);
        if (row.bonus !== undefined) expect(row.after, key).toBe(true);
        // Advantage is claimed before the d20, so nothing about it waits on a failure.
        if (row.advantage === true) expect(row.ifFailed, key).toBeUndefined();
        // Kept on a failure means the roll can still fail after it is added.
        if (row.spentOnSuccess === true) expect(row.ifFailed, key).toBe(true);
      }
    }
  });

  it('never sells advantage that the advantage table already gives for the key', () => {
    for (const [key, rows] of Object.entries(ROLL_EXTRAS)) {
      const held = ROLL_ADVANTAGES[key];
      if (held === undefined) continue;
      expect(
        rows.some((r) => r.free !== true && r.advantage === true),
        key,
      ).toBe(false);
    }
  });

  it('adds nothing, and says so, for keys it has no row for', () => {
    expect(emit(['nothing|tst'])).toEqual({ found: false, rows: [] });
  });

  it('reads a free die as one that rolls in', () => {
    expect(emit(["warder's intuition|erlw"]).rows).toEqual([
      {
        kind: 'rollDie',
        dice: '1d4',
        on: { rolls: ['check'], skills: ['Investigation'] },
        origin,
      },
    ]);
  });

  it('reads a paid row with what it adds and its flags', () => {
    expect(emit(['tactical mind|fighter|xphb']).rows).toEqual([
      {
        kind: 'rollPaid',
        on: { rolls: ['check'] },
        dice: '1d10',
        ifFailed: true,
        spentOnSuccess: true,
        origin,
      },
    ]);
    expect(emit(['guided strike|war domain|xphb']).rows[0]).toMatchObject({
      kind: 'rollPaid',
      bonus: 10,
      after: true,
      ifFailed: true,
      reaction: false,
    });
  });

  it('stops at the first key that has rows, and reads all of its rows', () => {
    const { found, rows } = emit(['nothing|tst', 'ambush|tce', 'lucky|xphb']);
    expect(found).toBe(true);
    expect(rows.map((r) => r.on)).toEqual([
      { rolls: ['check'], skills: ['Stealth'] },
      { rolls: ['check'], initiative: true },
    ]);
  });

  it('tells two cards of one feature apart by their level', () => {
    const guided = (level: number) =>
      emit(['channel divinity: guided strike|war domain|phb'], level).rows;
    expect(guided(2)).toHaveLength(1);
    expect(guided(6)).toEqual([]);
  });
});

describe('roll extras on a derived sheet', () => {
  // Rows for the synthetic world's own species traits and class feature, so the
  // walks read the table as they read real data.
  const ADDED = {
    'test surge|prosefolk|tst': [{ on: { rolls: ['check' as const] }, dice: '1d6' }],
    'once guard|prosefolk|tst': [
      {
        on: { rolls: ['save' as const] },
        bonus: 'equalToProfBonus' as const,
        after: true,
        reaction: true,
        ifFailed: true,
      },
    ],
    'grit|warrior|tst': [{ free: true as const, on: { rolls: ['check' as const] }, dice: '1d4' }],
    'alert|phb': [{ on: { rolls: ['check' as const], initiative: true }, dice: '1d8' }],
    'archery|phb': [{ on: { rolls: ['attack' as const] }, advantage: true }],
  };
  beforeAll(() => {
    Object.assign(ROLL_EXTRAS, ADDED);
  });
  afterAll(() => {
    for (const key of Object.keys(ADDED)) Reflect.deleteProperty(ROLL_EXTRAS, key);
  });

  const sheet = () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: [] }];
    doc.race = { name: 'Prosefolk', source: 'TST' };
    return deriveSheet(doc, makeTestContext());
  };

  it('names a trait’s extra for the trait, and counts its bonus as the sheet stands', () => {
    const s = sheet();
    expect(s.rollRiders.filter((r) => r.kind === 'paid')).toEqual([
      { kind: 'paid', on: { rolls: ['check'] }, dice: '1d6', origin: 'Test Surge' },
      {
        kind: 'paid',
        on: { rolls: ['save'] },
        bonus: 3,
        after: true,
        reaction: true,
        ifFailed: true,
        origin: 'Once Guard',
      },
    ]);
  });

  it('rolls a free die in, and leaves the paid ones to be priced', () => {
    const check = rollEffects(sheet(), { kind: 'check', ability: 'wis' });
    expect(check.dice).toEqual([{ dice: '1d4', source: 'Grit' }]);
    expect(check.paid?.map((p) => p.source)).toEqual(['Test Surge']);
    expect(check.offers).toEqual([]);
  });

  it('reads a feat and a picked optional feature, each named for itself', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: [] }];
    doc.feats = [{ ref: { name: 'Alert', source: 'PHB' }, instanceId: 'f0' }];
    const ctx = makeTestContext();
    const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Combat Stance')?.id;
    expect(id).toBeDefined();
    doc.choices[id ?? ''] = ['archery|phb'];
    const s = deriveSheet(doc, ctx);
    expect(rollEffects(s, { kind: 'initiative' }).paid).toEqual([{ source: 'Alert', dice: '1d8' }]);
    expect(rollEffects(s, { kind: 'attack' }).paid).toEqual([
      { source: 'Combat Stance: Archery', advantage: true },
    ]);
  });
});
