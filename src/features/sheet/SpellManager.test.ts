import { describe, expect, it } from 'vitest';
import { emptyPlayState, type SpellcastingBlock } from '@/engine/types';
import { nextCastResource } from './SpellManager';

const value = { value: 0, base: 0, overridden: false, parts: [] };

function block(overrides: Partial<SpellcastingBlock> = {}): SpellcastingBlock {
  return {
    classUid: 'mage|tst',
    className: 'Mage',
    ability: 'int',
    mode: 'known',
    saveDc: value,
    attackMod: value,
    slots: [4, 3, 2],
    ...overrides,
  };
}

describe('nextCastResource', () => {
  it('previews cantrips without a resource', () => {
    expect(nextCastResource(block(), emptyPlayState(), 0)).toEqual({ kind: 'cantrip', level: 0 });
  });

  it('uses the same pact-first and shared-slot fallback order as casting', () => {
    const play = emptyPlayState();
    const caster = block({ pactSlots: { count: 2, level: 3 } });
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'pact', level: 3 });
    play.pactSlotsSpent = 2;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 1 });
    play.slotsSpent[0] = 4;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 2 });
  });

  it('keeps an exhausted cast possible but labels it as no resource', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(nextCastResource(block(), play, 1)).toEqual({ kind: 'none', level: 1 });
  });
});
