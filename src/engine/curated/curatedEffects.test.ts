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
