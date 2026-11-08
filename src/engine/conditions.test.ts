import { describe, expect, it } from 'vitest';
import {
  type ActiveCondition,
  attacksAgainst,
  conditionDefenses,
  conditionMaxHp,
  conditionSpeed,
  type D20Effects,
  type D20Test,
  d20Effects,
  type Edition,
  heldOff,
  noD20Effect,
  resolveD20,
} from './conditions';
import { ABILITIES } from './types';

/** One test's effect as a word: what a roll under it would be. */
function mode(e: D20Effects): string {
  if (e.autoFail.length > 0) return 'fail';
  if (e.advantage.length > 0 && e.disadvantage.length > 0) return 'cancel';
  if (e.advantage.length > 0) return 'adv';
  if (e.disadvantage.length > 0) return 'dis';
  return '-';
}

/** Every test the sheet rolls, summarized for a set of conditions. */
function summary(conditions: ActiveCondition[], edition: Edition) {
  const of = (test: D20Test) => mode(d20Effects(conditions, edition, test));
  return {
    attack: of({ kind: 'attack' }),
    check: ABILITIES.map((ability) => of({ kind: 'check', ability })).join(' '),
    initiative: of({ kind: 'initiative' }),
    save: ABILITIES.map((ability) => of({ kind: 'save', ability })).join(' '),
    death: of({ kind: 'save' }),
    speed: conditionSpeed(30, conditions, edition).value,
  };
}

const NONE = '- - - - - -';
const DIS = 'dis dis dis dis dis dis';
const FAIL_STR_DEX = 'fail fail - - - -';

/** A row: attack, checks, initiative, saves (STR to CHA), speed from 30. */
type Row = [string, string, string, string, string, number];

const quiet = (id: string): Row => [id, '-', NONE, '-', NONE, 30];

// Every condition the picker offers, in both editions. Death saves are left
// out: no condition reaches them (only exhaustion does, tested below).
const TABLE_2014: Row[] = [
  ['Blinded', 'dis', NONE, '-', NONE, 30],
  quiet('Charmed'),
  quiet('Deafened'),
  ['Frightened', 'dis', DIS, 'dis', NONE, 30],
  ['Grappled', '-', NONE, '-', NONE, 0],
  quiet('Incapacitated'),
  ['Invisible', 'adv', NONE, '-', NONE, 30],
  ['Paralyzed', '-', NONE, '-', FAIL_STR_DEX, 0],
  ['Petrified', '-', NONE, '-', FAIL_STR_DEX, 0],
  ['Poisoned', 'dis', DIS, 'dis', NONE, 30],
  ['Prone', 'dis', NONE, '-', NONE, 30],
  ['Restrained', 'dis', NONE, '-', '- dis - - - -', 0],
  ['Stunned', '-', NONE, '-', FAIL_STR_DEX, 0],
  ['Unconscious', 'dis', NONE, '-', FAIL_STR_DEX, 0],
];

const TABLE_2024: Row[] = [
  ['Blinded', 'dis', NONE, '-', NONE, 30],
  quiet('Charmed'),
  quiet('Deafened'),
  ['Frightened', 'dis', DIS, 'dis', NONE, 30],
  // The attack penalty is only against others than the grappler: a note.
  ['Grappled', '-', NONE, '-', NONE, 0],
  ['Incapacitated', '-', NONE, 'dis', NONE, 30],
  ['Invisible', 'adv', NONE, 'adv', NONE, 30],
  ['Paralyzed', '-', NONE, 'dis', FAIL_STR_DEX, 0],
  ['Petrified', '-', NONE, 'dis', FAIL_STR_DEX, 0],
  ['Poisoned', 'dis', DIS, 'dis', NONE, 30],
  ['Prone', 'dis', NONE, '-', NONE, 30],
  ['Restrained', 'dis', NONE, '-', '- dis - - - -', 0],
  // 2024 Stunned no longer says "can't move".
  ['Stunned', '-', NONE, 'dis', FAIL_STR_DEX, 30],
  ['Unconscious', 'dis', NONE, 'dis', FAIL_STR_DEX, 0],
];

describe.each([
  ['2014', TABLE_2014],
  ['2024', TABLE_2024],
] as const)('d20Effects and conditionSpeed: every condition (%s)', (edition, table) => {
  it.each(table)('%s', (id, attack, check, initiative, save, speed) => {
    expect(summary([{ id }], edition)).toEqual({
      attack,
      check,
      initiative,
      save,
      death: '-',
      speed,
    });
  });
});

describe('d20Effects', () => {
  it('is empty with no conditions', () => {
    const e = d20Effects([], '2024', { kind: 'attack' });
    expect(e).toEqual({ advantage: [], disadvantage: [], autoFail: [], notes: [] });
    expect(noD20Effect(e)).toBe(true);
  });

  it('names a condition that another brings with it after the one on the sheet', () => {
    // Unconscious is Prone (attack disadvantage) and, in 2024, Incapacitated.
    expect(d20Effects([{ id: 'Unconscious' }], '2024', { kind: 'attack' }).disadvantage).toEqual([
      'Unconscious',
    ]);
    expect(
      d20Effects([{ id: 'Unconscious' }], '2024', { kind: 'initiative' }).disadvantage,
    ).toEqual(['Unconscious']);
  });

  it('lists every source once, in the order the conditions were added', () => {
    const e = d20Effects(
      [{ id: 'Poisoned' }, { id: 'Prone' }, { id: 'Restrained' }, { id: 'Poisoned' }],
      '2014',
      { kind: 'attack' },
    );
    expect(e.disadvantage).toEqual(['Poisoned', 'Prone', 'Restrained']);
  });

  it('skips a condition whose effects the player switched off', () => {
    const e = d20Effects([{ id: 'Poisoned', ignored: true }], '2014', { kind: 'attack' });
    expect(noD20Effect(e)).toBe(true);
    expect(conditionSpeed(30, [{ id: 'Grappled', ignored: true }], '2014').value).toBe(30);
  });

  it('lets Petrified suspend Poisoned, unless Petrified is switched off', () => {
    const poisoned = { id: 'Poisoned' };
    expect(
      d20Effects([{ id: 'Petrified' }, poisoned], '2014', { kind: 'check' }).disadvantage,
    ).toEqual([]);
    expect(
      d20Effects([{ id: 'Petrified', ignored: true }, poisoned], '2024', { kind: 'check' })
        .disadvantage,
    ).toEqual(['Poisoned']);
  });

  it('leaves an unknown condition alone', () => {
    expect(noD20Effect(d20Effects([{ id: 'Hexed' }], '2024', { kind: 'attack' }))).toBe(true);
  });

  it('notes what the sheet cannot decide, without applying it', () => {
    const blind = d20Effects([{ id: 'Blinded' }, { id: 'Deafened' }], '2014', {
      kind: 'check',
      ability: 'wis',
    });
    expect(blind.disadvantage).toEqual([]);
    expect(blind.notes).toEqual([
      { source: 'Blinded', text: 'you fail checks that need sight' },
      { source: 'Deafened', text: 'you fail checks that need hearing' },
    ]);
    expect(d20Effects([{ id: 'Grappled' }], '2024', { kind: 'attack' }).notes).toEqual([
      { source: 'Grappled', text: 'disadvantage against anyone but the grappler' },
    ]);
    expect(d20Effects([{ id: 'Grappled' }], '2014', { kind: 'attack' }).notes).toEqual([]);
    // Frightened's line-of-sight clause follows its disadvantage, initiative included.
    expect(d20Effects([{ id: 'Frightened' }], '2024', { kind: 'initiative' }).notes).toEqual([
      { source: 'Frightened', text: 'only while the source of fear is in sight' },
    ]);
  });
});

describe('exhaustion', () => {
  const ex = (level: number): ActiveCondition[] => [{ id: 'Exhaustion', level }];

  it.each([
    // level, attack, checks, initiative, saves, death save, speed
    [1, '-', DIS, 'dis', NONE, '-', 30],
    [2, '-', DIS, 'dis', NONE, '-', 15],
    [3, 'dis', DIS, 'dis', DIS, 'dis', 15],
    [4, 'dis', DIS, 'dis', DIS, 'dis', 15],
    [5, 'dis', DIS, 'dis', DIS, 'dis', 0],
    [6, 'dis', DIS, 'dis', DIS, 'dis', 0],
  ] as const)('2014 level %i is the cumulative table', (level, attack, check, init, save, death, speed) => {
    expect(summary(ex(level), '2014')).toEqual({
      attack,
      check,
      initiative: init,
      save,
      death,
      speed,
    });
    expect(d20Effects(ex(level), '2014', { kind: 'attack' }).penalty).toBeUndefined();
  });

  it.each([1, 2, 3, 4, 5])('2024 level %i takes 2 per level off every d20 test', (level) => {
    for (const test of [
      { kind: 'attack' },
      { kind: 'check', ability: 'str' },
      { kind: 'initiative' },
      { kind: 'save', ability: 'con' },
      { kind: 'save' },
    ] as const) {
      const e = d20Effects(ex(level), '2024', test);
      expect(e.penalty).toEqual({ amount: -2 * level, source: `Exhaustion ${level}` });
      expect(mode(e)).toBe('-');
    }
    expect(conditionSpeed(30, ex(level), '2024')).toEqual({
      value: 30 - 5 * level,
      sources: [`Exhaustion ${level}`],
    });
  });

  it('is nothing at level 0, and keeps counting at level 6 (death) in both editions', () => {
    expect(noD20Effect(d20Effects(ex(0), '2024', { kind: 'attack' }))).toBe(true);
    expect(noD20Effect(d20Effects(ex(0), '2014', { kind: 'check' }))).toBe(true);
    // Like 2014's table, 2024's formula still applies: the sheet's death
    // prompt is what level 6 adds, not an end to the penalties.
    expect(d20Effects(ex(6), '2024', { kind: 'attack' }).penalty).toEqual({
      amount: -12,
      source: 'Exhaustion 6',
    });
    expect(conditionSpeed(30, ex(6), '2024').value).toBe(0);
  });

  it('clamps a stored level past 6', () => {
    expect(conditionSpeed(30, ex(9), '2014').value).toBe(0);
    expect(d20Effects(ex(9), '2014', { kind: 'save' }).disadvantage).toEqual(['Exhaustion 6']);
  });

  it('switched off, changes nothing', () => {
    const off: ActiveCondition[] = [{ id: 'Exhaustion', level: 4, ignored: true }];
    expect(noD20Effect(d20Effects(off, '2024', { kind: 'attack' }))).toBe(true);
    expect(conditionSpeed(30, off, '2014').value).toBe(30);
    expect(conditionMaxHp(40, off, '2014').value).toBe(40);
  });
});

describe('conditionSpeed', () => {
  it('rounds a halved speed down', () => {
    expect(conditionSpeed(25, [{ id: 'Exhaustion', level: 2 }], '2014').value).toBe(12);
  });

  it('never goes below 0 in 2024', () => {
    expect(conditionSpeed(20, [{ id: 'Exhaustion', level: 5 }], '2024').value).toBe(0);
  });

  it('names exhaustion first, then each condition that holds the character still', () => {
    expect(
      conditionSpeed(
        30,
        [{ id: 'Grappled' }, { id: 'Exhaustion', level: 2 }, { id: 'Prone' }],
        '2014',
      ),
    ).toEqual({ value: 0, sources: ['Exhaustion 2', 'Grappled'] });
    expect(conditionSpeed(30, [{ id: 'Grappled' }, { id: 'Restrained' }], '2024')).toEqual({
      value: 0,
      sources: ['Grappled', 'Restrained'],
    });
  });

  it('has no sources when nothing changed', () => {
    expect(conditionSpeed(30, [{ id: 'Exhaustion', level: 1 }], '2014')).toEqual({
      value: 30,
      sources: [],
    });
  });
});

describe('conditionMaxHp', () => {
  it('halves the 2014 maximum from exhaustion 4, rounding down', () => {
    expect(conditionMaxHp(45, [{ id: 'Exhaustion', level: 3 }], '2014')).toEqual({ value: 45 });
    expect(conditionMaxHp(45, [{ id: 'Exhaustion', level: 4 }], '2014')).toEqual({
      value: 22,
      source: 'Exhaustion 4',
    });
    expect(conditionMaxHp(45, [{ id: 'Exhaustion', level: 5 }], '2014').value).toBe(22);
  });

  it('keeps at least 1, and leaves a character with no hit points at 0', () => {
    expect(conditionMaxHp(1, [{ id: 'Exhaustion', level: 4 }], '2014').value).toBe(1);
    expect(conditionMaxHp(0, [{ id: 'Exhaustion', level: 4 }], '2014').value).toBe(0);
  });

  it('never changes in 2024', () => {
    expect(conditionMaxHp(45, [{ id: 'Exhaustion', level: 5 }], '2024')).toEqual({ value: 45 });
  });
});

describe('resolveD20', () => {
  const effects = (over: Partial<D20Effects>): D20Effects => ({
    advantage: [],
    disadvantage: [],
    autoFail: [],
    notes: [],
    ...over,
  });

  it('takes the dock mode alone when nothing applies or the player ignored the effects', () => {
    expect(resolveD20('adv', effects({})).advantage).toBe('adv');
    expect(resolveD20(undefined, undefined)).toEqual({
      advantage: undefined,
      cancelled: false,
      penalty: 0,
      autoFail: false,
    });
    expect(resolveD20('dis', undefined).advantage).toBe('dis');
  });

  it("applies a condition's disadvantage or advantage on a normal roll", () => {
    expect(resolveD20(undefined, effects({ disadvantage: ['Poisoned'] })).advantage).toBe('dis');
    expect(resolveD20(undefined, effects({ advantage: ['Invisible'] })).advantage).toBe('adv');
  });

  it('cancels any advantage against any disadvantage, however many of each', () => {
    const r = resolveD20('adv', effects({ disadvantage: ['Poisoned', 'Prone'] }));
    expect(r).toMatchObject({ advantage: undefined, cancelled: true });
    expect(
      resolveD20(undefined, effects({ advantage: ['Invisible'], disadvantage: ['Prone'] })),
    ).toMatchObject({ advantage: undefined, cancelled: true });
  });

  it('does not stack the same kind twice', () => {
    expect(resolveD20('dis', effects({ disadvantage: ['Poisoned'] }))).toMatchObject({
      advantage: 'dis',
      cancelled: false,
    });
  });

  it('carries the penalty and an automatic failure through', () => {
    expect(
      resolveD20(undefined, effects({ penalty: { amount: -4, source: 'Exhaustion 2' } })).penalty,
    ).toBe(-4);
    expect(resolveD20(undefined, effects({ autoFail: ['Stunned'] })).autoFail).toBe(true);
  });
});

describe('attacksAgainst', () => {
  it('groups lines by what they say, naming every source', () => {
    expect(attacksAgainst([{ id: 'Restrained' }, { id: 'Paralyzed' }], '2014')).toEqual([
      { text: 'Attack rolls against you have advantage', sources: ['Restrained', 'Paralyzed'] },
      { text: 'Hits from within 5 ft are critical hits', sources: ['Paralyzed'] },
    ]);
  });

  it('is empty for conditions that say nothing about attacks against you', () => {
    expect(attacksAgainst([{ id: 'Poisoned' }, { id: 'Exhaustion', level: 3 }], '2024')).toEqual(
      [],
    );
  });

  it('says Prone alone: advantage within 5 ft, disadvantage beyond', () => {
    expect(attacksAgainst([{ id: 'Prone' }], '2014')).toEqual([
      {
        text: 'Attack rolls against you have advantage within 5 ft, disadvantage beyond',
        sources: ['Prone'],
      },
    ]);
  });

  it("reads Prone with another condition's advantage as one line: a straight roll beyond 5 ft", () => {
    // Unconscious is Prone as well, so it says so in one line, not two that disagree.
    expect(attacksAgainst([{ id: 'Unconscious' }], '2024')).toEqual([
      {
        text: 'Attack rolls against you have advantage within 5 ft, a straight roll beyond',
        sources: ['Unconscious'],
      },
      { text: 'Hits from within 5 ft are critical hits', sources: ['Unconscious'] },
    ]);
    expect(attacksAgainst([{ id: 'Restrained' }, { id: 'Prone' }], '2014')).toEqual([
      {
        text: 'Attack rolls against you have advantage within 5 ft, a straight roll beyond',
        sources: ['Restrained', 'Prone'],
      },
    ]);
  });
});

describe('held off by an immunity', () => {
  const immune = (...conditions: string[]) => ({
    immune: conditions.map((condition) => ({ condition, origin: "Heroes' Feast" })),
  });

  it('applies nothing for a condition the character is immune to, whatever its case', () => {
    const frightened = [{ id: 'Frightened' }];
    expect(d20Effects(frightened, '2014', { kind: 'attack' }).disadvantage).toEqual(['Frightened']);
    expect(d20Effects(frightened, '2014', { kind: 'attack' }, immune('frightened'))).toEqual(
      d20Effects([], '2014', { kind: 'attack' }),
    );
  });

  it('holds off what another condition brings, and keeps the rest of it', () => {
    const asleep = [{ id: 'Unconscious' }];
    const against = attacksAgainst(asleep, '2014', immune('Prone')).map((l) => l.text);
    expect(against).toEqual([
      'Attack rolls against you have advantage',
      'Hits from within 5 ft are critical hits',
    ]);
    expect(d20Effects(asleep, '2014', { kind: 'attack' }, immune('Prone')).disadvantage).toEqual(
      [],
    );
    expect(
      d20Effects(asleep, '2014', { kind: 'save', ability: 'dex' }, immune('Prone')).autoFail,
    ).toEqual(['Unconscious']);
  });

  it('holds off exhaustion everywhere it is looked up', () => {
    const tired = [{ id: 'Exhaustion', level: 4 }];
    expect(d20Effects(tired, '2024', { kind: 'attack' }, immune('Exhaustion')).penalty).toBe(
      undefined,
    );
    expect(conditionSpeed(30, tired, '2024', immune('exhaustion')).value).toBe(30);
    expect(conditionMaxHp(40, tired, '2014', immune('Exhaustion')).value).toBe(40);
  });

  it('lets a held-off Petrified suspend nothing', () => {
    const both = [{ id: 'Petrified' }, { id: 'Poisoned' }];
    expect(d20Effects(both, '2014', { kind: 'attack' }, immune('Petrified')).disadvantage).toEqual([
      'Poisoned',
    ]);
  });

  it('names what holds each condition off, for its chip', () => {
    const conditions = [{ id: 'Frightened' }, { id: 'Prone' }, { id: 'Charmed', ignored: true }];
    expect(
      heldOff(conditions, {
        immune: [
          { condition: 'frightened', origin: "Heroes' Feast" },
          { condition: 'Frightened', origin: 'Mindless Rage' },
          { condition: 'charmed', origin: 'Mindless Rage' },
        ],
      }),
    ).toEqual([
      { id: 'Frightened', by: ["Heroes' Feast", 'Mindless Rage'] },
      { id: 'Charmed', by: ['Mindless Rage'] },
    ]);
  });
});

describe('conditionDefenses', () => {
  it('resists all damage while Petrified, in both editions', () => {
    for (const edition of ['2014', '2024'] as const) {
      expect(conditionDefenses([{ id: 'Petrified' }], edition)).toEqual([
        { damageType: 'all', origin: 'Petrified' },
      ]);
    }
    expect(conditionDefenses([{ id: 'Petrified', ignored: true }], '2014')).toEqual([]);
    expect(conditionDefenses([{ id: 'Prone' }], '2014')).toEqual([]);
  });
});

describe('conditionSpeed with a multiplier', () => {
  const haste = { multiplier: { factor: 2, sources: ['Haste'] } };

  it('doubles what exhaustion left, so 2024 exhaustion 1 under Haste is 50', () => {
    expect(conditionSpeed(30, [{ id: 'Exhaustion', level: 1 }], '2024', haste)).toEqual({
      value: 50,
      sources: ['Exhaustion 1', 'Haste'],
    });
    expect(conditionSpeed(30, [{ id: 'Exhaustion', level: 2 }], '2014', haste).value).toBe(30);
    expect(conditionSpeed(30, [], '2014', haste)).toEqual({ value: 60, sources: ['Haste'] });
  });

  it('never lifts speed 0 from a condition, and names no multiplier that changed nothing', () => {
    expect(conditionSpeed(30, [{ id: 'Grappled' }], '2014', haste)).toEqual({
      value: 0,
      sources: ['Haste', 'Grappled'],
    });
    expect(conditionSpeed(0, [], '2014', haste)).toEqual({ value: 0, sources: [] });
    expect(conditionSpeed(30, [], '2014', { multiplier: { factor: 1, sources: [] } })).toEqual({
      value: 30,
      sources: [],
    });
  });

  it('rounds a slowed speed down', () => {
    const slow = { multiplier: { factor: 0.5, sources: ['Slow'] } };
    expect(conditionSpeed(35, [], '2014', slow)).toEqual({ value: 17, sources: ['Slow'] });
  });
});
