/**
 * Suspected bug 2 (ADR-002): an equipped homebrew potion counted all the time.
 * A potion's own effects, and a pack's for it, go in play when it is drunk
 * (`homebrewLanding`), so carried or equipped they give nothing. The potion is
 * invented.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

const POTION: DataEntity = {
  name: 'Potion of Quickstep',
  source: 'MyHomebrew',
  type: 'P',
  rarity: 'uncommon',
  entries: ['You move faster for an hour.'],
  castGuidance: {
    v: 1,
    effects: [{ kind: 'speedBonus', amount: 10 }],
    moments: [{ at: 'longRest', do: [{ kind: 'cue', text: 'Never while carried' }] }],
  },
};

function sheet(potion: DataEntity, packs: DataEntity[] = []) {
  const base = makeTestContext();
  const ctx: EngineContext = {
    byType: (t) =>
      t === 'item' ? [...base.byType(t), potion] : t === RULE_PACK_TYPE ? packs : base.byType(t),
    get: (t, n, s) => (t === 'item' && n === potion.name ? potion : base.get(t, n, s)),
  };
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
  doc.equipment = [
    {
      id: 'p1',
      ref: { name: potion.name as string, source: 'MyHomebrew' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ] as typeof doc.equipment;
  return deriveSheet(doc, ctx);
}

describe('an equipped homebrew potion', () => {
  it('gives none of its effects while carried', () => {
    expect(sheet(POTION).speedWalk.value).toBe(30);
  });

  it("gives none of a pack's effects for it while carried", () => {
    const pack: DataEntity = {
      name: 'Brew',
      source: 'Brew',
      appliesTo: { characters: ['hero'] },
      castGuidance: {
        v: 1,
        patches: [
          { target: 'Potion of Quickstep|MyHomebrew', add: [{ kind: 'acBonus', amount: 2 }] },
        ],
      },
    };
    const plain = { ...POTION, castGuidance: undefined };
    expect(sheet(plain, [pack]).ac.value).toBe(sheet(plain).ac.value);
  });

  it('holds no moments while carried', () => {
    expect(sheet(POTION).moments).toBeUndefined();
  });
});
