import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import { type EffectOrigin, type EngineContext, newCharacterDoc } from '../types';
import { emitCuratedEffects } from './curatedEffects';

const ctx: EngineContext = { get: () => undefined, byType: () => [] };
const origin: EffectOrigin = { label: 'Feature', uid: 'x', type: 'class' };

function col(className?: string, levels = 5) {
  const doc = newCharacterDoc('c', 'H', 't');
  if (className) doc.classes = [{ ref: { name: className, source: 'PHB' }, levels, hp: [] }];
  return new Collector(doc, ctx);
}

describe('emitCuratedEffects', () => {
  it('returns false and emits nothing for an unknown key', () => {
    const c = col();
    expect(emitCuratedEffects(c, 'nonexistent|zzz', origin)).toBe(false);
    expect(c.effects).toEqual([]);
  });

  it('emits Alert’s +5 initiative', () => {
    const c = col();
    expect(emitCuratedEffects(c, 'alert|phb', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'initiativeBonus', amount: 5 }),
    );
  });

  it('emits the Lay on Hands pool as 5 x paladin level with an action', () => {
    const c = col('Paladin', 5);
    expect(emitCuratedEffects(c, 'lay on hands|paladin', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'lay-on-hands', max: 25, resetOn: 'long' }),
    );
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'action', label: 'Lay on Hands' }),
    );
  });

  it('makes Lay on Hands a bonus action under 2024 rules', () => {
    const c = col('Paladin', 3);
    c.doc.rulesVersion = '2024';
    emitCuratedEffects(c, 'lay on hands|paladin', origin);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'bonus', label: 'Lay on Hands' }),
    );
  });

  it('scales paladin Channel Divinity by edition and level', () => {
    const c2014 = col('Paladin', 12);
    emitCuratedEffects(c2014, 'channel divinity|paladin', origin);
    expect(c2014.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'channel-divinity-paladin', max: 1 }),
    );

    const c2024 = col('Paladin', 12);
    c2024.doc.rulesVersion = '2024';
    emitCuratedEffects(c2024, 'channel divinity|paladin', origin);
    expect(c2024.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'channel-divinity-paladin', max: 3 }),
    );
  });

  it('keeps paladin and cleric Channel Divinity in separate pools', () => {
    // Sharing one key made the max depend on which class was added first, and
    // the 2024 text is explicit that the uses belong to each class separately.
    const c = col('Paladin', 5);
    c.doc.classes.push({ ref: { name: 'Cleric', source: 'PHB' }, levels: 6, hp: [] });
    emitCuratedEffects(c, 'channel divinity|paladin', origin);
    emitCuratedEffects(c, 'channel divinity|cleric', origin);
    const keys = c.effects
      .filter((e) => e.kind === 'resource')
      .map((e) => (e as Extract<typeof e, { kind: 'resource' }>).key);
    expect(new Set(keys)).toEqual(new Set(['channel-divinity-paladin', 'channel-divinity']));
  });

  it('emits Arcane Recovery once per long rest', () => {
    const c = col('Wizard', 2);
    expect(emitCuratedEffects(c, 'arcane recovery|wizard', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({
        kind: 'resource',
        key: 'arcane-recovery',
        max: 1,
        resetOn: 'long',
      }),
    );
  });

  it('emits a stacking superiority-dice pool for Battle Master', () => {
    const c = col('Fighter', 5);
    expect(emitCuratedEffects(c, 'combat superiority|battle master', origin)).toBe(true);
    const pool = c.effects.find(
      (e): e is Extract<typeof e, { kind: 'resource' }> =>
        e.kind === 'resource' && e.key === 'superiority-dice',
    );
    expect(pool).toBeDefined();
    expect(pool?.stack).toBe(true);
    expect(typeof pool?.max === 'number' && pool.max > 0).toBe(true);
  });
});
