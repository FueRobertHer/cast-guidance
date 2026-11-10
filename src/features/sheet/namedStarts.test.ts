import { beforeEach, describe, expect, it } from 'vitest';
import type { HpLimits } from '@/engine/effectLife';
import { type MomentsInForce, readMoments } from '@/engine/moments';
import {
  type CharacterDoc,
  emptyPlayState,
  type FormulaScope,
  type SpellcastingBlock,
} from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { noticeStore } from '@/stores/notices';
import { castSpell } from './castResources';
import { castSpellAsking } from './namedStarts';

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

const SCOPE: FormulaScope = {
  level: 5,
  classLevel: 5,
  prof: 3,
  hp: 0,
  maxHp: 100,
  mod: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
  score: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
};

function inForce(raw: unknown[]): MomentsInForce {
  const read = readMoments(raw, 'Wild Weave');
  expect(read.problems).toEqual([]);
  return {
    moments: read.moments,
    scope: SCOPE,
    pools: [{ key: 'flux', label: 'Flux', max: 3 }],
    hpWhenDerived: 50,
  };
}

/** A document and an updater that applies each change to it, counting the changes. */
function session() {
  const doc = { play: emptyPlayState() } as CharacterDoc;
  doc.play.currentHp = 50;
  const labels: unknown[] = [];
  const update: DocUpdater = (recipe, label) => {
    recipe(doc);
    labels.push(typeof label === 'function' ? label(doc) : label);
  };
  return { doc, update, labels };
}

const shield = { name: 'Shield', source: 'xphb' };

beforeEach(() => noticeStore.getState().clear());

describe('castSpellAsking and the castAtLevel moment', () => {
  it('casts exactly as castSpell does when no moment is in force', () => {
    const asking = session();
    const plain = session();
    const hp: HpLimits = { maxHp: 100, edition: '2024' };
    castSpellAsking(asking.update, hp, block(), 1, shield);
    castSpell(plain.update, hp, block(), 1, shield);
    expect(asking.doc).toEqual(plain.doc);
    expect(asking.labels).toEqual(plain.labels);
    expect(noticeStore.getState().notice).toBeNull();
  });

  it('fires in the same change as the cast, at the slot spent, and says what it did', () => {
    const { doc, update, labels } = session();
    const hp: HpLimits = {
      maxHp: 100,
      edition: '2024',
      moments: inForce([
        {
          at: 'castAtLevel',
          level: 2,
          do: [
            { kind: 'regain', resource: 'flux', amount: 1 },
            { kind: 'cue', text: 'Roll on the surge table', tone: 'warn' },
          ],
        },
      ]),
    };
    doc.play.resources.push({ key: 'flux', used: 2 });
    castSpellAsking(update, hp, block(), 1, shield, { kind: 'slot', level: 2 });
    expect(doc.play.slotsSpent[1]).toBe(1);
    expect(doc.play.resources).toEqual([{ key: 'flux', used: 1 }]);
    expect(labels).toEqual(['Cast Shield (L2)']);
    expect(noticeStore.getState().notice).toEqual({
      title: 'Roll on the surge table',
      detail: 'Flux: regained 1 · Wild Weave',
      tone: 'warn',
    });
  });

  it('reads the slot the cast spends when none was chosen', () => {
    const hp: HpLimits = {
      maxHp: 100,
      edition: '2024',
      moments: inForce([
        { at: 'castAtLevel', level: 2, do: [{ kind: 'tempHp', amount: { f: 'mod.int' } }] },
      ]),
    };
    // No first-level slots left, so a first-level spell goes up to the second.
    const low = session();
    castSpellAsking(low.update, hp, block({ slots: [1, 1] }), 1, shield);
    expect(low.doc.play.tempHp).toBe(0);
    const up = session();
    up.doc.play.slotsSpent = [1];
    castSpellAsking(up.update, hp, block({ slots: [1, 1] }), 1, shield);
    expect(up.doc.play.slotsSpent).toEqual([1, 1]);
    expect(up.doc.play.tempHp).toBe(3);
  });

  it('reads the HP maximum as the cast left it, after concentration ended what it held', () => {
    const hp: HpLimits = {
      // 90 of the sheet's own and 10 from Bolster, held by the caster's concentration.
      maxHp: 100,
      edition: '2024',
      moments: inForce([
        { at: 'castAtLevel', level: 1, do: [{ kind: 'tempHp', amount: { f: 'maxHp' } }] },
      ]),
    };
    const { doc, update } = session();
    doc.play.activeEffects = [
      {
        id: 'bolster',
        name: 'Bolster',
        parts: [{ kind: 'maxHpBonus', amount: 10 }],
        lasts: { minutes: 10, concentration: true },
        mine: true,
      },
    ];
    doc.play.concentratingOn = { label: 'Bolster' };
    castSpellAsking(update, hp, block(), 1, { ...shield, concentration: true });
    expect(doc.play.activeEffects).toBeUndefined();
    expect(doc.play.tempHp).toBe(90);
  });
});
