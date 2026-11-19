import { describe, expect, it } from 'vitest';
import { CAST_GUIDANCE_LIMITS as L } from '@/engine/castGuidance';
import { mergeHomebrew, normalizeDataset } from './normalize';
import {
  PACK_LOCAL_KEY,
  type PackFile,
  type PackLocal,
  packName,
  packRefusals,
  packsInOrder,
  readPackLocal,
  rulePackEntries,
  sharedFile,
} from './rulePack';

const pack = (guidance: Record<string, unknown>, full = 'Gritty Table') => ({
  _meta: { sources: [{ json: 'GT', full }], castGuidance: { v: 1, ...guidance } },
});
const everyone = { characters: [], appDefault: true };

describe('a pack on this device', () => {
  it('reads a row’s settings as data: odd characters dropped, the list capped', () => {
    const local = readPackLocal({
      appliesTo: { characters: ['hild', 7, '', 'x'.repeat(101), ...Array(1_200).fill('a')] },
      order: Number.NaN,
    });
    expect(local?.appliesTo.characters[0]).toBe('hild');
    expect(local?.appliesTo.characters).toHaveLength(L.charactersPerPack - 3);
    expect(local).not.toHaveProperty('order');
    expect(local?.appliesTo).not.toHaveProperty('appDefault');
    expect(readPackLocal({ appliesTo: everyone, order: 2 })).toEqual({
      appliesTo: everyone,
      order: 2,
    });
    expect(readPackLocal(undefined)).toBeUndefined();
    expect(readPackLocal('everyone')).toBeUndefined();
  });

  it('sends a file without an old Apply to block, and changes nothing else', () => {
    const original = pack({ tableRules: { restLength: 'gritty' } });
    const held = {
      ...original,
      _meta: { ...original._meta, [PACK_LOCAL_KEY]: { file: 'id-1', appliesTo: everyone } },
    };
    // The same text as the file that came in, so the same id where it is imported again.
    expect(JSON.stringify(sharedFile(held))).toBe(JSON.stringify(original));
    const plain = { _meta: { sources: [] }, spell: [] };
    expect(sharedFile(plain)).toBe(plain);
    // The id a collection made in the app is known by goes with it.
    const made = { _meta: { ...held._meta, castGuidanceCollection: 'osk' } };
    expect(sharedFile(made)._meta).toHaveProperty('castGuidanceCollection', 'osk');
  });

  it('is named by its book', () => {
    expect(packName(pack({}))).toBe('Gritty Table');
    expect(packName({ _meta: { sources: [{ json: 'GT' }] } })).toBe('GT');
    expect(packName({})).toBe('A rule pack');
  });
});

describe('the registry’s packs', () => {
  const file = (id: string, json: Record<string, unknown>, local?: PackLocal): PackFile =>
    local === undefined ? { id, json } : { id, json, pack: local };

  it('lists packs in the player’s order, then as they merged, so the later wins', () => {
    const plain = { _meta: { sources: [{ json: 'X' }] }, spell: [] };
    expect(
      packsInOrder([
        file('c', pack({}, 'C'), { appliesTo: everyone }),
        file('a', pack({}, 'A'), { appliesTo: everyone, order: 1 }),
        file('x', plain),
        file('d', pack({}, 'D'), { appliesTo: everyone }),
        file('b', pack({}, 'B'), { appliesTo: everyone, order: 0 }),
      ]).map((p) => p.name),
    ).toEqual(['B', 'A', 'C', 'D']);
  });

  it('gives a pack no reach unless applied here, and none while it breaks a limit', () => {
    // Arrived holding another device's Apply to, in the file: read as nothing.
    const elsewhere = pack({}, 'Elsewhere');
    (elsewhere._meta as Record<string, unknown>)[PACK_LOCAL_KEY] = {
      file: 'e',
      appliesTo: everyone,
    };
    const tooMany = pack(
      { moments: Array(L.momentsPerPack + 1).fill({ at: 'zeroHp', do: [] }) },
      'Too many',
    );
    const entries = rulePackEntries([
      file('a', pack({}, 'Applied'), { appliesTo: { characters: ['hild'] } }),
      file('e', elsewhere),
      file('t', tooMany, { appliesTo: everyone }),
    ]);
    expect(entries.map((e) => [e.name, e.source, e.appliesTo])).toEqual([
      ['Applied', 'GT', { characters: ['hild'] }],
      ['Elsewhere', 'GT', undefined],
      ['Too many', 'GT', undefined],
    ]);
  });

  it('reach the engine through the registry, never as content', () => {
    const reg = normalizeDataset(new Map());
    const applied = { ...pack({}), feat: [{ name: 'Grit Feat', source: 'GT' }] };
    mergeHomebrew(reg, new Map([['a', applied]]), new Map([['a', { appliesTo: everyone }]]));
    expect(reg.byType('rulePack').map((e) => [e.name, e.appliesTo])).toEqual([
      ['Gritty Table', everyone],
    ]);
    // Its content merges as any homebrew file's does.
    expect(reg.byType('feat').map((e) => e.name)).toEqual(['Grit Feat']);
    // Without its row's settings it reaches nobody.
    mergeHomebrew(reg, new Map([['a', applied]]));
    expect(reg.byType('rulePack').map((e) => e.appliesTo)).toEqual([undefined]);
    mergeHomebrew(reg, new Map());
    expect(reg.byType('rulePack')).toEqual([]);
  });
});

describe('a pack past a limit is refused, with the reason', () => {
  const effect = { kind: 'acBonus', amount: 1 };
  const many = (n: number, v: unknown) => Array(n).fill(v);
  /** An action whose `field` is a level table, its words at level 5 `length` long. */
  const byLevel = (field: 'label' | 'note', length: number) => ({
    kind: 'action',
    economy: 'action',
    label: 'Flare',
    [field]: { byLevel: { '1': 'x', '5': 'x'.repeat(length) } },
  });
  const byAnswer = (length: number, rows = 2) => ({
    kind: 'action',
    economy: 'action',
    label: 'Flare',
    note: {
      byAnswer: 'kind',
      values: Object.fromEntries(
        Array.from({ length: rows }, (_, i) => [`a${i}`, i === 0 ? 'x'.repeat(length) : 'x']),
      ),
    },
  });
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
      'prices in a change',
      { patches: [{ target: 'a|b', amend: many(L.amendsPerEntry + 1, { cost: { amount: 2 } }) }] },
      /change 1 has 65 prices; one change has at most 64/,
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
    [
      'a reference',
      {
        patches: [
          { target: 'a|b', add: [{ kind: 'grantSpell', spell: `${'x'.repeat(197)}|PHB` }] },
        ],
      },
      /a reference to an entry is at most 200 characters/,
    ],
    [
      'a label by level',
      { patches: [{ target: 'a|b', add: [byLevel('label', 101)] }] },
      /a name or label is at most 100 characters/,
    ],
    [
      'a note by level',
      { patches: [{ target: 'a|b', add: [byLevel('note', 501)] }] },
      /a text is at most 500 characters/,
    ],
    [
      'a note by an answer',
      { patches: [{ target: 'a|b', add: [byAnswer(501)] }] },
      /a text is at most 500 characters/,
    ],
    [
      'a table by an answer too long',
      { patches: [{ target: 'a|b', add: [byAnswer(1, L.answerRows + 1)] }] },
      new RegExp(`a table by an answer or a spell granted has at most ${L.answerRows} rows`),
    ],
    [
      'a table by a spell granted too long',
      {
        patches: [
          {
            target: 'a|b',
            add: [
              {
                kind: 'resist',
                damageType: {
                  byGrant: Object.fromEntries(
                    Array.from({ length: L.answerRows + 1 }, (_, i) => [`s${i}`, 'fire']),
                  ),
                },
              },
            ],
          },
        ],
      },
      new RegExp(`has at most ${L.answerRows} rows`),
    ],
  ])('%s', (_, guidance, reason) => {
    const refusals = packRefusals({ v: 1, ...guidance });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(reason);
  });

  it('holds the words of a level table to the field that holds it', () => {
    const add = [byLevel('label', 100), byLevel('note', 500), byAnswer(500, L.answerRows)];
    expect(packRefusals({ v: 1, patches: [{ target: 'a|b', add }] })).toEqual([]);
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

  it('takes a reference as long as the effect reader does', () => {
    const spell = `${'x'.repeat(2 * L.labelLength - 4)}|PHB`;
    expect(spell).toHaveLength(2 * L.labelLength);
    expect(
      packRefusals({ v: 1, patches: [{ target: 'a|b', add: [{ kind: 'grantSpell', spell }] }] }),
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
