import { describe, expect, it } from 'vitest';
import itemRules from '@/rules/cast-guidance/items.json';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { readRuleSet } from '../effects/mechanics';
import {
  ABILITIES,
  type Ability,
  type CharacterDoc,
  type DataEntity,
  type EngineContext,
  newCharacterDoc,
} from '../types';

/**
 * What each `wornTags` row gives in place of the data's tags, as the table
 * these rows came from (`ITEM_TAG_FIXES`) said it: a field given replaces that
 * tag, one left out keeps the data's. Written out here so that a row giving a
 * kind the real item has no tag of (a deck "nothing worn" on a kind its data
 * lacks), which no derive of the real data shows, is still pinned.
 */
interface Given {
  resist?: string[];
  immune?: string[];
  vulnerable?: string[];
  conditionImmune?: string[];
  save?: { amount: number; abilities?: Ability[] } | null;
}
const NOTHING: Given = { resist: [], immune: [], vulnerable: [], conditionImmune: [], save: null };
const saves = (ability: Ability): Given => ({ save: { amount: 1, abilities: [ability] } });
const EXPECTED: Record<string, Given> = {
  'deck of many more things|bmt': NOTHING,
  'deck of wonder|bmt': NOTHING,
  'muroosa balm|egw': NOTHING,
  'moon card|bmt': NOTHING,
  'ghost step tattoo|tce': { conditionImmune: [] },
  'ring of red fury|crcotn': { conditionImmune: [] },
  'rod of alertness|dmg': { save: null },
  'rod of alertness|xdmg': { save: null },
  'shield of the blazing dreadnought|bgg': { immune: [] },
  'nightbringer|mcv2dc': { immune: [] },
  'mace of the black crown (awakened)|egw': { resist: ['poison'] },
  'mace of the black crown (dormant)|egw': { resist: [] },
  'netherese ring of protection|pabtso': { save: { amount: 1 } },
  'orcsplitter|pota': { conditionImmune: ['frightened'] },
  'periapt of proof against poison|xdmg': { conditionImmune: ['poisoned'] },
  'chronolometer|ai': saves('int'),
  'dimensional loop|ai': saves('str'),
  'far gear|ai': saves('cha'),
  'ioun stone, self-preservation|llk': saves('int'),
  'rotor of return|ai': saves('con'),
  'timepiece of travel|ai': saves('dex'),
  'wheel of stars|ai': saves('wis'),
  'ioun stone of vitality|imr': { save: null },
  'leather golem armor|llk': { save: null },
};

/** Every tag kind the item call site reads, so each row's kinds left out show. */
const EVERY_TAG = {
  resist: ['acid'],
  immune: ['cold'],
  vulnerable: ['fire'],
  conditionImmune: ['charmed'],
  bonusSavingThrow: '+2',
};

function world(
  items: DataEntity[],
  sets: readonly DataEntity[] = BUILT_IN_RULE_SETS,
): EngineContext {
  return {
    get: (type, name, source) =>
      type === 'item'
        ? items.find(
            (e) =>
              String(e.name).toLowerCase() === name.toLowerCase() &&
              (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
          )
        : undefined,
    byType: (type) => (type === RULE_SET_TYPE ? [...sets] : type === 'item' ? items : []),
  };
}

function wearing(item: DataEntity): CharacterDoc {
  const doc = newCharacterDoc('c', 'Hild', 't');
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: String(item.name), source: String(item.source) },
      qty: 1,
      equipped: true,
      attuned: true,
    },
  ];
  return doc;
}

const fixtureFor = (key: string): DataEntity => {
  const [name, source] = key.split('|');
  return { name, source, ...EVERY_TAG };
};

describe('the built-in worn tag rows', () => {
  it('cover the keys the table had, each once', () => {
    // The rows for the bonus fields are `wornTagFields.test.ts`'s.
    const defenses: readonly string[] = [
      'resist',
      'immune',
      'vulnerable',
      'conditionImmune',
      'saveBonus',
    ];
    const keys = itemRules.rows
      .filter(
        (r) =>
          r.part === 'wornTags' &&
          'replaces' in r &&
          (r.replaces as string[]).some((k) => defenses.includes(k)),
      )
      .flatMap((r) => r.keys);
    expect([...keys].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(readRuleSet(itemRules).problems).toEqual([]);
  });

  for (const [key, given] of Object.entries(EXPECTED)) {
    it(`give what ${key} gives in place of every tag kind it replaces`, () => {
      const item = fixtureFor(key);
      const sheet = deriveSheet(wearing(item), world([item]));
      expect(sheet.resists.map((r) => r.damageType)).toEqual(given.resist ?? EVERY_TAG.resist);
      expect(sheet.immunities.map((r) => r.damageType)).toEqual(given.immune ?? EVERY_TAG.immune);
      expect(sheet.vulnerabilities.map((r) => r.damageType)).toEqual(
        given.vulnerable ?? EVERY_TAG.vulnerable,
      );
      expect(sheet.conditionImmunities.map((c) => c.condition)).toEqual(
        given.conditionImmune ?? EVERY_TAG.conditionImmune,
      );
      const save = given.save === undefined ? { amount: 2 } : given.save;
      for (const a of ABILITIES) {
        const reaches =
          save !== null && (save.abilities === undefined || save.abilities.includes(a));
        expect(sheet.saves[a].total.value, a).toBe(reaches ? save.amount : 0);
      }
    });
  }

  /** Every tag the fixture carries, on the sheet as the data says it. */
  const everyTag = (sheet: ReturnType<typeof deriveSheet>) => {
    expect(sheet.resists.map((r) => r.damageType)).toEqual(EVERY_TAG.resist);
    expect(sheet.immunities.map((r) => r.damageType)).toEqual(EVERY_TAG.immune);
    expect(sheet.vulnerabilities.map((r) => r.damageType)).toEqual(EVERY_TAG.vulnerable);
    expect(sheet.conditionImmunities.map((c) => c.condition)).toEqual(EVERY_TAG.conditionImmune);
    for (const a of ABILITIES) expect(sheet.saves[a].total.value, a).toBe(2);
  };

  it('give nothing under a key no row names, which reads every tag', () => {
    const item: DataEntity = { name: 'Charm of Tests', source: 'TST', ...EVERY_TAG };
    everyTag(deriveSheet(wearing(item), world([item])));
  });

  it('give nothing without the rule sets: the tags stand', () => {
    const item = fixtureFor('far gear|ai');
    everyTag(deriveSheet(wearing(item), world([item], [])));
  });

  it("give nothing to a copy, whose tags are its author's", () => {
    const copy: DataEntity = {
      ...fixtureFor('far gear|ai'),
      source: 'HB',
      castGuidance: { v: 1, basedOn: 'far gear|ai' },
    };
    everyTag(deriveSheet(wearing(copy), world([copy])));
  });

  it('give a potion nothing, whose tags count once it is drunk', () => {
    const potion: DataEntity = { ...fixtureFor('far gear|ai'), type: 'P' };
    const sheet = deriveSheet(wearing(potion), world([potion]));
    expect(sheet.saves.cha.total.value).toBe(0);
    expect(sheet.resists).toEqual([]);
  });

  it('give each kind they replace only the effects of that kind, once', () => {
    const item: DataEntity = { name: 'Charm of Tests', source: 'TST', ...EVERY_TAG };
    const sets: DataEntity[] = [
      {
        type: RULE_SET_TYPE,
        v: 1,
        name: 'Test rules',
        rows: [
          {
            part: 'wornTags',
            keys: ['charm of tests|tst'],
            replaces: ['resist', 'conditionImmune', 'saveBonus'],
            effects: [
              { kind: 'saveBonus', amount: 1, abilities: ['dex'] },
              { kind: 'resist', damageType: 'fire' },
              { kind: 'resist', damageType: 'cold' },
              { kind: 'conditionImmune', condition: 'frightened' },
            ],
          },
        ],
      },
    ];
    const sheet = deriveSheet(wearing(item), world([item], sets));
    expect(sheet.resists.map((r) => r.damageType)).toEqual(['fire', 'cold']);
    expect(sheet.immunities.map((r) => r.damageType)).toEqual(['cold']);
    expect(sheet.vulnerabilities.map((r) => r.damageType)).toEqual(['fire']);
    expect(sheet.conditionImmunities.map((c) => c.condition)).toEqual(['frightened']);
    expect(sheet.saves.dex.total.value).toBe(1);
    expect(sheet.saves.wis.total.value).toBe(0);
  });
});

describe('a worn tag row, read', () => {
  const read = (row: Record<string, unknown>, more: Record<string, unknown>[] = []) =>
    readRuleSet({ type: RULE_SET_TYPE, v: 1, name: 'Test rules', rows: [row, ...more] });
  const row = (fields: Record<string, unknown>) => ({
    part: 'wornTags',
    keys: ['charm of tests|tst'],
    replaces: ['resist'],
    effects: [],
    ...fields,
  });

  it('keeps the kinds it replaces and its effects', () => {
    const set = read(row({ effects: [{ kind: 'resist', damageType: 'fire' }] }));
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.replaces).toEqual(['resist']);
    expect(set.rows[0]?.effects.map((t) => t.effect)).toEqual([
      { kind: 'resist', damageType: 'fire' },
    ]);
  });

  it.each([
    ['no replaces', { replaces: undefined }, '"replaces" lists kinds of tag'],
    ['an empty list', { replaces: [] }, '"replaces" lists kinds of tag'],
    [
      'a kind that is not a tag',
      { replaces: ['acBonus'] },
      '"replaces": "acBonus" is not a kind of tag',
    ],
    ['a kind twice', { replaces: ['resist', 'resist'] }, '"replaces" names "resist" twice'],
    [
      'an effect of a kind no tag is',
      { effects: [{ kind: 'acBonus', amount: 1 }] },
      'an effect of kind "acBonus" is not a kind of tag it can replace',
    ],
    [
      'an effect of a kind it does not replace',
      { effects: [{ kind: 'immune', damageType: 'fire' }] },
      'gives a "immune" but does not replace that kind',
    ],
    [
      'an effect it cannot read, which would take a tag away',
      { effects: [{ kind: 'resist', damageType: 5 }] },
      'an effect it cannot read would take a tag away',
    ],
  ])('leaves out a row with %s, and its keys stay free', (_, fields, problem) => {
    const set = read(row(fields), [row({ replaces: ['immune'] })]);
    expect(set.problems.join('; ')).toContain(problem);
    expect(set.rows).toHaveLength(1);
    expect(set.rows[0]?.replaces).toEqual(['immune']);
  });

  it('takes no level and no scan', () => {
    for (const field of ['level', 'scan']) {
      const set = read(row({ [field]: field === 'level' ? 3 : 'keep' }));
      expect(set.problems.join('; ')).toContain(`"${field}" is not a field a wornTags row has`);
      expect(set.rows).toEqual([]);
    }
  });
});
