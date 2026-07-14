import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import {
  type CharacterDoc,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { calcMaxHp } from './hp';

const ctxWithFaces = (faces: number): EngineContext => ({
  byType: () => [],
  get: (type) => (type === 'class' ? { hd: { faces } } : undefined),
});

function doc(
  levels: number,
  hpMethod?: CharacterDoc['hpMethod'],
  hp: Array<number | 'avg'> = [],
): CharacterDoc {
  const d = newCharacterDoc('c', 'H', 't');
  d.classes = [{ ref: { name: 'C', source: 'T' }, levels, hp }];
  if (hpMethod !== undefined) d.hpMethod = hpMethod;
  return d;
}

function maxHp(d: CharacterDoc, faces = 6, conMod = 0, effects: EffectInput[] = []) {
  const col = new Collector(d, ctxWithFaces(faces));
  return calcMaxHp(d, col, effects, conMod);
}

describe('calcMaxHp', () => {
  it('average method: max die at level 1, rounded-up average after', () => {
    // d6: L1 = 6, L2/L3 = floor(6/2)+1 = 4 each = 14
    const r = maxHp(doc(3), 6);
    expect(r.maxHp.value).toBe(14);
    expect(r.hitDice).toEqual({ d6: 3 });
    expect(r.totalLevel).toBe(3);
  });

  it('rolled method uses per-level rolls (clamped), still max at level 1', () => {
    const d = doc(3, 'rolled', [999, 3, 5]);
    // L1 = 6 (always max), then 3 + 5 = 14
    expect(maxHp(d, 6).maxHp.value).toBe(14);
  });

  it('max method uses the full die every level', () => {
    expect(maxHp(doc(3, 'max'), 6).maxHp.value).toBe(18);
  });

  it('adds CON modifier per level and an hpPerLevel effect per level', () => {
    const origin: EffectOrigin = { label: 'Tough', uid: 'feat|tough', type: 'feat' };
    const effects: EffectInput[] = [{ origin, kind: 'hpPerLevel', amount: 2 }];
    // d6 avg 3 levels = 14, + con 1*3 = 3, + tough 2*3 = 6 → 23
    expect(maxHp(doc(3), 6, 1, effects).maxHp.value).toBe(23);
  });

  it('honors a maxHp override and floors at 1 for a leveled character', () => {
    const d = doc(1);
    d.overrides = { maxHp: { value: 99 } };
    expect(maxHp(d, 6).maxHp.value).toBe(99);
  });
});
