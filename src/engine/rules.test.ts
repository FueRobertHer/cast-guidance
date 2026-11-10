import { describe, expect, it } from 'vitest';
import { AS_WRITTEN, RULE_PACK_TYPE, TABLE_RULES, type TableRuleChoices } from './castGuidance';
import {
  asWritten,
  REST_MINUTES,
  restTakes,
  rulesFor,
  sheetRules,
  sheetRulesField,
  tableRulesFor,
} from './rules';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from './types';

const hero = (edition: '2014' | '2024' = '2014', build?: (d: CharacterDoc) => void) => {
  const d = newCharacterDoc('hild', 'Hild', 'tag');
  d.rulesVersion = edition;
  build?.(d);
  return d;
};

/** A context with these packs listed (in the player's order) and the app's choices. */
const ctx = (packs: DataEntity[] = [], rules?: EngineContext['rules']) => ({
  byType: (type: string) => (type === RULE_PACK_TYPE ? packs : []),
  ...(rules === undefined ? {} : { rules }),
});

/** A pack, applied to Hild unless `to` says otherwise (`null` for no appliesTo at all). */
const pack = (
  name: string,
  tableRules: unknown,
  { to = { characters: ['hild'] }, v = 1 }: { to?: unknown; v?: unknown } = {},
): DataEntity => ({
  name,
  source: 'MyTable',
  castGuidance: { ...(v === null ? {} : { v }), tableRules },
  ...(to === null ? {} : { appliesTo: to }),
});

describe('as written', () => {
  it('is the first value of every rule, in both editions', () => {
    for (const edition of ['2014', '2024'] as const) {
      expect(rulesFor(hero(edition), ctx())).toEqual(AS_WRITTEN[edition]);
    }
    expect(asWritten('a future edition')).toBe(AS_WRITTEN['2014']);
  });
});

describe('each layer of the resolver', () => {
  it('takes the app’s choice in Settings over as written', () => {
    expect(rulesFor(hero(), ctx([], { critDamage: 'maxPlusRoll' })).critDamage).toBe('maxPlusRoll');
  });

  it('reads the app’s choices as data: an unknown value counts nothing', () => {
    const odd = { critDamage: 'triple', restLength: 'heroic' } as unknown as EngineContext['rules'];
    const rules = rulesFor(hero(), ctx([], odd));
    expect(rules.critDamage).toBe('doubleDice');
    expect(rules.restLength).toBe('heroic');
  });

  it('takes a pack applied to the character over the app', () => {
    const rules = rulesFor(
      hero(),
      ctx([pack('Gritty Table', { restLength: 'gritty' })], { restLength: 'heroic' }),
    );
    expect(rules.restLength).toBe('gritty');
  });

  it('puts a pack made the app’s default under the app’s own choice', () => {
    const byDefault = pack(
      'Heroic Table',
      { restLength: 'heroic', flanking: 'advantage' },
      { to: { characters: [], appDefault: true } },
    );
    const rules = rulesFor(hero(), ctx([byDefault], { restLength: 'standard' }));
    expect(rules.restLength).toBe('standard');
    expect(rules.flanking).toBe('advantage');
  });

  it('lets the later pack in the player’s order win', () => {
    const rules = rulesFor(
      hero(),
      ctx([
        pack('First', { critDamage: 'maxPlusRoll', flanking: 'plusTwo' }),
        pack('Second', { critDamage: 'doubleTotal' }),
      ]),
    );
    expect(rules.critDamage).toBe('doubleTotal');
    expect(rules.flanking).toBe('plusTwo');
  });

  it('reaches nobody from a pack with no appliesTo, or applied to someone else', () => {
    const rules = rulesFor(
      hero(),
      ctx([
        pack('Nobody', { critDamage: 'doubleTotal' }, { to: null }),
        pack('Someone else', { critDamage: 'doubleTotal' }, { to: { characters: ['other'] } }),
      ]),
    );
    expect(rules.critDamage).toBe('doubleDice');
  });

  it('counts nothing from a pack whose version it cannot read', () => {
    for (const v of [null, 0, 99, 'one']) {
      const rules = rulesFor(hero(), ctx([pack('Odd', { critDamage: 'doubleTotal' }, { v })]));
      expect(rules.critDamage).toBe('doubleDice');
    }
  });

  it('takes the character’s own choice over everything', () => {
    const doc = hero('2014', (d) => {
      d.tableRules = { restLength: 'heroic', hpOnLongRest: 'half' };
      d.hpMethod = 'max';
      d.oneUseDice = 'before';
    });
    const rules = rulesFor(
      doc,
      ctx([pack('Gritty Table', { restLength: 'gritty', hpEachLevel: 'rolled' })], {
        hpOnLongRest: 'hitDice',
        oneUseDice: 'after',
      }),
    );
    expect(rules).toEqual({
      ...AS_WRITTEN['2014'],
      restLength: 'heroic',
      hpOnLongRest: 'half',
      hpEachLevel: 'max',
      oneUseDice: 'before',
    });
  });
});

describe('every value of every rule', () => {
  it('reaches the character from each layer', () => {
    for (const [id, values] of Object.entries(TABLE_RULES)) {
      for (const value of values) {
        const one = { [id]: value } as Partial<TableRuleChoices>;
        expect(rulesFor(hero(), ctx([], one))[id as keyof TableRuleChoices]).toBe(value);
        expect(rulesFor(hero(), ctx([pack('P', one)]))[id as keyof TableRuleChoices]).toBe(value);
      }
    }
  });
});

describe('what does not read', () => {
  it('says what in a pack’s rules or the character’s own did not count', () => {
    const doc = hero('2014', (d) => {
      d.tableRules = { critDamage: 'triple' } as unknown as CharacterDoc['tableRules'];
    });
    const { rules, problems } = tableRulesFor(
      doc,
      ctx([pack('Odd Table', { restLength: 'forever', sneezing: 'on' })]),
    );
    expect(rules).toEqual(AS_WRITTEN['2014']);
    expect(problems).toEqual([
      'Your own table rules: critDamage is one of doubleDice, maxPlusRoll, doubleTotal',
      'Odd Table: table rules: restLength is one of standard, gritty, heroic',
      'Odd Table: table rules: unknown rule "sneezing"',
    ]);
  });

  it('ignores a stored HP method or one-use dice it does not know', () => {
    const doc = hero('2014', (d) => {
      (d as { hpMethod: unknown }).hpMethod = 'luck';
      (d as { oneUseDice: unknown }).oneUseDice = 'never';
    });
    expect(rulesFor(doc, ctx())).toEqual(AS_WRITTEN['2014']);
  });

  it('never reads inherited keys from a hostile pack', () => {
    const hostile = JSON.parse(
      '{"name":"x","castGuidance":{"v":1,"tableRules":{"__proto__":{"critDamage":"doubleTotal"}}},"appliesTo":{"characters":["hild"]}}',
    );
    const read = tableRulesFor(hero(), ctx([hostile]));
    expect(read.rules.critDamage).toBe('doubleDice');
    expect(({} as Record<string, unknown>).critDamage).toBeUndefined();
  });
});

describe('the sheet’s rules', () => {
  it('are absent when every rule is as written, so such a sheet derives as before', () => {
    expect(sheetRulesField(hero(), ctx())).toEqual({ problems: [] });
    // Chosen, but chosen as written, is still as written.
    expect(sheetRulesField(hero(), ctx([], { restLength: 'standard' })).rules).toBeUndefined();
  });

  it('are the whole set once one differs, and read back through sheetRules', () => {
    const field = sheetRulesField(hero('2024'), ctx([], { flanking: 'plusTwo' }));
    expect(field.rules).toEqual({ ...AS_WRITTEN['2024'], flanking: 'plusTwo' });
    expect(sheetRules({ rules: field.rules }, '2024').flanking).toBe('plusTwo');
    expect(sheetRules({}, '2024')).toBe(AS_WRITTEN['2024']);
  });
});

describe('rest lengths', () => {
  it('take an hour and eight as written, eight hours and a week gritty, minutes heroic', () => {
    expect(REST_MINUTES).toEqual({
      standard: { short: 60, long: 480 },
      gritty: { short: 480, long: 10080 },
      heroic: { short: 5, long: 60 },
    });
    expect(
      (['standard', 'gritty', 'heroic'] as const).map(
        (length) => `${restTakes(length, 'short')}, ${restTakes(length, 'long')}`,
      ),
    ).toEqual(['1 hour, 8 hours', '8 hours, 7 days', '5 minutes, 1 hour']);
  });
});
