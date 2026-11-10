import { describe, expect, it } from 'vitest';
import type { PackAppliesTo } from '@/engine/castGuidance';
import {
  describeConflict,
  describeIncomingConflict,
  type PackInPlay,
  packConflicts,
  packReview,
  targetWords,
} from './importPreview';

const every: PackAppliesTo = { characters: [], appDefault: true };
const to = (...characters: string[]): PackAppliesTo => ({ characters });
const pack = (id: string, guidance: Record<string, unknown>, appliesTo?: PackAppliesTo) =>
  ({
    id,
    name: id,
    guidance: { v: 1, ...guidance },
    ...(appliesTo === undefined ? {} : { appliesTo }),
  }) satisfies PackInPlay;
const rest = (value: string) => ({ tableRules: { restLength: value } });

describe('where packs disagree', () => {
  it('the later wins between two alike, and packs that agree are no clash', () => {
    const got = packConflicts([
      pack('Gritty', { tableRules: { restLength: 'gritty', critDamage: 'maxPlusRoll' } }, every),
      pack('Heroic', { tableRules: { restLength: 'heroic', critDamage: 'maxPlusRoll' } }, every),
    ]);
    expect(got.map(describeConflict)).toEqual([
      'Gritty and Heroic both set rest length. Heroic wins: it comes later in your pack order.',
    ]);
  });

  it('a pack applied to the characters wins over one applied to every character', () => {
    const [clash] = packConflicts([
      pack('Chosen', rest('gritty'), to('hild')),
      pack('Everyone', rest('heroic'), every),
    ]);
    expect(clash && describeConflict(clash)).toBe(
      'Chosen and Everyone both set rest length. Chosen wins: it is applied to those characters, over every character.',
    );
  });

  it('packs that reach no character in common, or nobody, do not clash', () => {
    expect(
      packConflicts([
        pack('Hild’s', rest('gritty'), to('hild')),
        pack('Bram’s', rest('heroic'), to('bram')),
        pack('Nobody’s', rest('standard')),
        pack('Empty', rest('standard'), to()),
      ]),
    ).toEqual([]);
  });

  it('two packs replacing one entry clash; adding to it does not', () => {
    const replace = (target: string) => ({ patches: [{ target, effects: [] }] });
    const got = packConflicts([
      pack(
        'One',
        {
          patches: [
            { target: 'Rage|Barbarian', effects: [] },
            { target: 'Alert|PHB', add: [] },
          ],
        },
        every,
      ),
      pack('Two', replace('rage|barbarian'), to('hild')),
      pack('Three', { patches: [{ target: 'Alert|PHB', add: [] }] }, every),
    ]);
    expect(got.map(describeConflict)).toEqual([
      'One and Two both set Rage (Barbarian). Two wins: it comes later in your pack order.',
    ]);
  });

  it('says a clash from the side of a pack coming in', () => {
    const packs = [pack('Gritty', rest('gritty'), every), pack('In', rest('heroic'), every)];
    const [clash] = packConflicts(packs);
    expect(clash && describeIncomingConflict(clash, 'In')).toBe(
      'Sets rest length, which Gritty also sets. In would win, as it goes last in your pack order.',
    );
    const [held] = packConflicts([
      pack('Gritty', rest('gritty'), to('hild')),
      { ...packs[1], appliesTo: every } as PackInPlay,
    ]);
    expect(held && describeIncomingConflict(held, 'In')).toBe(
      'Sets rest length, which Gritty also sets. Gritty would still win, as it is applied to those characters.',
    );
  });
});

describe('what a pack holds', () => {
  it('names a target as the player reads it', () => {
    expect(targetWords('Rage|Barbarian')).toBe('Rage (Barbarian)');
    expect(targetWords('Rage')).toBe('Rage');
    expect(targetWords('Hunter|Ranger|PHB')).toBe('Hunter (Ranger, PHB)');
  });

  it('lists what it cannot read, and holds nothing the app reads', () => {
    const review = packReview({
      _meta: {
        sources: [{ json: 'Odd' }],
        castGuidance: { v: 1, tables: [], tableRules: { restLength: 'forever' } },
      },
    });
    expect(review?.name).toBe('Odd');
    expect(review?.holds).toBe('Nothing the app reads yet');
    expect(review?.problems).toEqual([
      '"tables" is not part of a rule pack, so it is not read',
      'table rules: restLength is one of standard, gritty, heroic',
    ]);
    expect(packReview({ _meta: { sources: [{ json: 'X' }] }, spell: [] })).toBeUndefined();
  });
});
