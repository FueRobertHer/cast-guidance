import { describe, expect, it } from 'vitest';
import { CAST_GUIDANCE_LIMITS as L } from '@/engine/castGuidance';
import { mergeHomebrew, normalizeDataset } from './normalize';
import {
  PACK_LOCAL_KEY,
  packLocal,
  packName,
  packRefusals,
  packsInOrder,
  rulePackEntries,
  sharedFile,
  withPackLocal,
} from './rulePack';

const pack = (guidance: Record<string, unknown>, full = 'Gritty Table') => ({
  _meta: { sources: [{ json: 'GT', full }], castGuidance: { v: 1, ...guidance } },
});
const everyone = { characters: [], appDefault: true };

describe('a pack on this device', () => {
  it('holds who it applies to only for the file it was written for', () => {
    const stored = withPackLocal(pack({}), { file: 'id-1', appliesTo: { characters: ['hild'] } });
    expect(packLocal(stored, 'id-1')).toEqual({
      file: 'id-1',
      appliesTo: { characters: ['hild'] },
    });
    // The same content under another id: a file that arrived holding it.
    expect(packLocal(stored, 'id-2')).toBeUndefined();
    expect(packLocal(stored, '')).toBeUndefined();
  });

  it('reads a stored block as data: odd characters dropped, the list capped', () => {
    const odd = {
      _meta: {
        ...pack({})._meta,
        [PACK_LOCAL_KEY]: {
          file: 'id-1',
          appliesTo: { characters: ['hild', 7, '', 'x'.repeat(101), ...Array(1_200).fill('a')] },
          order: Number.NaN,
        },
      },
    };
    const local = packLocal(odd, 'id-1');
    expect(local?.appliesTo.characters[0]).toBe('hild');
    expect(local?.appliesTo.characters).toHaveLength(L.charactersPerPack - 3);
    expect(local).not.toHaveProperty('order');
    expect(local?.appliesTo).not.toHaveProperty('appDefault');
  });

  it('leaves it behind when the file leaves, and changes nothing else', () => {
    const original = pack({ tableRules: { restLength: 'gritty' } });
    const stored = withPackLocal(original, { file: 'id-1', appliesTo: everyone, order: 2 });
    expect(stored._meta).toHaveProperty(PACK_LOCAL_KEY);
    expect(original._meta).not.toHaveProperty(PACK_LOCAL_KEY);
    // The same text as the file that came in, so the same id where it is imported again.
    expect(JSON.stringify(sharedFile(stored))).toBe(JSON.stringify(original));
    const plain = { _meta: { sources: [] }, spell: [] };
    expect(sharedFile(plain)).toBe(plain);
  });

  it('is named by its book', () => {
    expect(packName(pack({}))).toBe('Gritty Table');
    expect(packName({ _meta: { sources: [{ json: 'GT' }] } })).toBe('GT');
    expect(packName({})).toBe('A rule pack');
  });
});

describe('the registry’s packs', () => {
  const files = (...entries: Array<[string, Record<string, unknown>]>) => new Map(entries);

  it('lists packs in the player’s order, then as they merged, so the later wins', () => {
    const a = withPackLocal(pack({}, 'A'), { file: 'a', appliesTo: everyone, order: 1 });
    const b = withPackLocal(pack({}, 'B'), { file: 'b', appliesTo: everyone, order: 0 });
    const c = withPackLocal(pack({}, 'C'), { file: 'c', appliesTo: everyone });
    const d = withPackLocal(pack({}, 'D'), { file: 'd', appliesTo: everyone });
    const plain = { _meta: { sources: [{ json: 'X' }] }, spell: [] };
    expect(
      packsInOrder(files(['c', c], ['a', a], ['x', plain], ['d', d], ['b', b])).map((p) => p.name),
    ).toEqual(['B', 'A', 'C', 'D']);
  });

  it('gives a pack no reach unless applied here, and none while it breaks a limit', () => {
    const applied = withPackLocal(pack({}, 'Applied'), {
      file: 'a',
      appliesTo: { characters: ['hild'] },
    });
    const elsewhere = withPackLocal(pack({}, 'Elsewhere'), { file: 'other', appliesTo: everyone });
    const tooMany = withPackLocal(
      pack({ moments: Array(L.momentsPerPack + 1).fill({ at: 'zeroHp', do: [] }) }, 'Too many'),
      { file: 't', appliesTo: everyone },
    );
    const entries = rulePackEntries(files(['a', applied], ['e', elsewhere], ['t', tooMany]));
    expect(entries.map((e) => [e.name, e.source, e.appliesTo])).toEqual([
      ['Applied', 'GT', { characters: ['hild'] }],
      ['Elsewhere', 'GT', undefined],
      ['Too many', 'GT', undefined],
    ]);
  });

  it('reach the engine through the registry, never as content', () => {
    const reg = normalizeDataset(new Map());
    const applied = withPackLocal(
      { ...pack({}), feat: [{ name: 'Grit Feat', source: 'GT' }] },
      { file: 'a', appliesTo: everyone },
    );
    mergeHomebrew(reg, files(['a', applied]));
    expect(reg.byType('rulePack').map((e) => e.name)).toEqual(['Gritty Table']);
    // Its content merges as any homebrew file's does.
    expect(reg.byType('feat').map((e) => e.name)).toEqual(['Grit Feat']);
    mergeHomebrew(reg, files());
    expect(reg.byType('rulePack')).toEqual([]);
  });
});

describe('a pack past a limit is refused, with the reason', () => {
  const effect = { kind: 'acBonus', amount: 1 };
  const many = (n: number, v: unknown) => Array(n).fill(v);
  it.each([
    [
      'patches',
      { patches: many(L.patchesPerPack + 1, { target: 'a|b' }) },
      /501 changes to entries; a pack has at most 500/,
    ],
    ['moments', { moments: many(L.momentsPerPack + 1, { at: 'zeroHp', do: [] }) }, /201 moments/],
    ['cues', { cues: many(L.cuesPerPack + 1, { at: 'zeroHp', text: 'x' }) }, /201 cues/],
    [
      'effects in a change',
      { patches: [{ target: 'a|b', add: many(65, effect) }] },
      /change 1 has 65 effects/,
    ],
    [
      'what a moment does',
      { moments: [{ at: 'zeroHp', do: many(65, { kind: 'cue', text: 'x' }) }] },
      /moment 1 does 65 things/,
    ],
    [
      'effects a moment adds',
      {
        moments: [
          { at: 'zeroHp', do: [{ kind: 'addEffect', name: 'x', effects: many(65, effect) }] },
        ],
      },
      /moment 1 adds an effect of 65 parts/,
    ],
    [
      'states',
      { patches: [{ target: 'a|b', add: [{ ...effect, while: many(9, 'raging') }] }] },
      /at most 8 states/,
    ],
    [
      'a formula’s length',
      {
        patches: [
          { target: 'a|b', add: [{ kind: 'acBonus', amount: { f: `${'1+'.repeat(101)}1` } }] },
        ],
      },
      /a formula is at most 200 characters/,
    ],
    [
      'a formula’s depth',
      {
        patches: [
          {
            target: 'a|b',
            // Forty sums, each inside the last: deeper than the grammar reads.
            add: [{ kind: 'acBonus', amount: { f: `${'(1+'.repeat(40)}1${')'.repeat(40)}` } }],
          },
        ],
      },
      /a formula is at most 32/,
    ],
    [
      'a level table',
      {
        patches: [
          {
            target: 'a|b',
            add: [
              {
                kind: 'acBonus',
                amount: {
                  byLevel: Object.fromEntries(many(31, 0).map((_, i) => [String(i + 1), 1])),
                },
              },
            ],
          },
        ],
      },
      /a level table has at most 30 levels/,
    ],
    [
      'a number',
      { patches: [{ target: 'a|b', add: [{ kind: 'acBonus', amount: 1_000_000 }] }] },
      /a number is at most 999,999 either way/,
    ],
    [
      'a text',
      { cues: [{ at: 'zeroHp', text: 'x'.repeat(501) }] },
      /a text is at most 500 characters/,
    ],
    [
      'a target',
      { patches: [{ target: 'x'.repeat(201) }] },
      /a change’s target is at most 200 characters/,
    ],
    [
      'a name',
      { moments: [{ at: 'zeroHp', do: [{ kind: 'offer', label: 'x'.repeat(101) }] }] },
      /a name or label is at most 100 characters/,
    ],
  ])('%s', (_, guidance, reason) => {
    const refusals = packRefusals({ v: 1, ...guidance });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(reason);
  });

  it('keeps to every limit at the limit itself', () => {
    expect(
      packRefusals({
        v: 1,
        patches: many(L.patchesPerPack, { target: 'a|b', add: many(64, effect) }),
        moments: many(L.momentsPerPack, {
          at: 'zeroHp',
          do: many(64, { kind: 'cue', text: 'x'.repeat(500) }),
        }),
        cues: many(L.cuesPerPack, { at: 'zeroHp', text: 'x' }),
      }),
    ).toEqual([]);
  });

  it('lists five reasons at most, then how many more', () => {
    const refusals = packRefusals({
      v: 1,
      patches: [
        ...many(L.patchesPerPack, { target: 'a|b' }),
        { target: 'x'.repeat(201), add: [{ kind: 'acBonus', amount: 1e7, while: many(9, 's') }] },
      ],
      moments: many(L.momentsPerPack + 1, { at: 'zeroHp', do: [] }),
      cues: [
        ...many(L.cuesPerPack, { at: 'zeroHp', text: 'x' }),
        { at: 'zeroHp', text: 'x'.repeat(501) },
      ],
    });
    expect(refusals).toHaveLength(6);
    expect(refusals[5]).toBe('and 2 more');
  });
});
