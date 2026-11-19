import { describe, expect, it } from 'vitest';
import itemRules from '@/rules/cast-guidance/items.json';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { readRuleSet } from '../effects/mechanics';
import { type DataEntity, type DerivedSheet, type EngineContext, newCharacterDoc } from '../types';

/**
 * The `wornTags` rows for an item's bonus fields (ADR-002 D7), each read from
 * the item's text where its fields misstate it: a bonus for a moment the sheet
 * cannot see (Niko's Mace's summon, the Banner's area once destroyed, one row
 * of the Infernal Machine's table) gives nothing; one for some weapons reaches
 * only those; one for one class's spells reaches only that class's block. Each
 * fixture carries every field at +5, so a kind a row leaves out shows the
 * data's.
 */
const FIELDS = {
  bonusWeaponAttack: '+5',
  bonusWeaponDamage: '+5',
  bonusSpellAttack: '+5',
  bonusSpellSaveDc: '+5',
};
const BONUS_KINDS: readonly string[] = ['attackBonus', 'damageBonus', 'spellDcBonus'];

/**
 * What the item adds to the Longsword's, the Shortbow's, the Sling's and the
 * Unarmed Strike's to-hit and damage: the Sling is a ranged weapon no bow.
 */
interface WeaponGiven {
  toHit: [number, number, number, number];
  damage: [number, number, number, number];
}
const KEPT: WeaponGiven = { toHit: [5, 5, 5, 0], damage: [5, 5, 5, 0] };
const NO_ATTACK: WeaponGiven = { toHit: [0, 0, 0, 0], damage: KEPT.damage };
const WEAPONS: Record<string, WeaponGiven> = {
  'banner of the krig rune|skt': NO_ATTACK,
  "niko's mace|uthftlh": NO_ATTACK,
  'the infernal machine of lum the mad|imr': NO_ATTACK,
  'bracers of archery|dmg': { toHit: KEPT.toHit, damage: [0, 2, 0, 0] },
  'bracers of archery|xdmg': { toHit: KEPT.toHit, damage: [0, 2, 0, 0] },
  ...Object.fromEntries(
    ['', 'greater ', 'unmatched ', 'endless '].flatMap((g) => [
      [`ashen band of ${g}might|icc`, { toHit: KEPT.toHit, damage: [1, 0, 0, 0] }],
      [`ashen band of ${g}vengeance|icc`, { toHit: KEPT.toHit, damage: [0, 2, 2, 0] }],
    ]),
  ),
};

/** What the item adds to a caster block's spell attack and DC, by the block's class. */
interface SpellGiven {
  classes: string[];
  attack: Record<string, number>;
  dc: Record<string, number>;
}
const forClasses = (classes: string[], n: number): SpellGiven => ({
  classes: [...classes, 'Sage'],
  attack: { ...Object.fromEntries(classes.map((c) => [c, n])), Sage: 0 },
  dc: { ...Object.fromEntries(classes.map((c) => [c, n])), Sage: 0 },
});
const SPELLS: Record<string, SpellGiven> = {
  ...Object.fromEntries(
    [1, 2, 3].flatMap((n) => [
      [`+${n} all-purpose tool|tce`, forClasses(['Artificer'], n)],
      [`+${n} arcane grimoire|tce`, forClasses(['Wizard'], n)],
      [`+${n} bloodwell vial|tce`, forClasses(['Sorcerer'], n)],
      [`+${n} moon sickle|tce`, forClasses(['Druid', 'Ranger'], n)],
      [`+${n} rhythm-maker's drum|tce`, forClasses(['Bard'], n)],
      [`+${n} rod of the pact keeper|dmg`, forClasses(['Warlock'], n)],
      [`+${n} rod of the pact keeper|xdmg`, forClasses(['Warlock'], n)],
    ]),
  ),
  ...Object.fromEntries(
    ['psionic', 'tranquil', 'vigilant'].map((r) => [
      `${r} rod of the honed mind|au`,
      forClasses(['Warlock'], 1),
    ]),
  ),
  // Its DC alone: the attack is the data's.
  "reveler's concertina|tce": {
    classes: ['Bard', 'Sage'],
    attack: { Bard: 5, Sage: 5 },
    dc: { Bard: 2, Sage: 0 },
  },
  // Its spell attacks alone: the DC is the data's.
  ...Object.fromEntries(
    ['talisman of pure good|dmg', 'talisman of ultimate evil|dmg'].map((k) => [
      k,
      {
        classes: ['Cleric', 'Paladin', 'Sage'],
        attack: { Cleric: 2, Paladin: 2, Sage: 0 },
        dc: { Cleric: 5, Paladin: 5, Sage: 5 },
      },
    ]),
  ),
  // Spells cast with Charisma: the Warlock's, not the Sage's (Intelligence).
  "jester's mask|bmt": {
    classes: ['Warlock', 'Sage'],
    attack: { Warlock: 3, Sage: 0 },
    dc: { Warlock: 3, Sage: 0 },
  },
};

const base = makeTestContext();
const SLING: DataEntity = {
  name: 'Sling',
  source: 'HB',
  type: 'R',
  weaponCategory: 'simple',
  weapon: true,
  dmg1: '1d4',
  dmgType: 'B',
  property: ['A'],
  range: '30/120',
};
/** A caster of this name: the fixture's Pactcaster (Charisma) for a Warlock, else its Mage. */
const casterNamed = (name: string): DataEntity => ({
  ...(base.get('class', name === 'Warlock' ? 'Pactcaster' : 'Mage', 'TST') as DataEntity),
  name,
  classFeatures: [],
});

function sheetWith(item: DataEntity | undefined, classes: string[]): DerivedSheet {
  const ctx: EngineContext = {
    byType: (t) =>
      t === 'item'
        ? [...base.byType(t), SLING, ...(item === undefined ? [] : [item])]
        : base.byType(t),
    get: (t, n, s) => {
      if (t === 'item' && item !== undefined && n === item.name) return item;
      if (t === 'item' && n === 'Sling') return SLING;
      if (t === 'class' && classes.includes(n) && n !== 'Warrior') return casterNamed(n);
      return base.get(t, n, s);
    },
  };
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.classes = classes.map((name) => ({ ref: { name, source: 'TST' }, levels: 1, hp: ['avg'] }));
  doc.equipment = [
    {
      id: 'sword',
      ref: { name: 'Longsword', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
    { id: 'bow', ref: { name: 'Shortbow', source: 'TST' }, qty: 1, equipped: true, attuned: false },
    { id: 'sling', ref: { name: 'Sling', source: 'HB' }, qty: 1, equipped: true, attuned: false },
    ...(item === undefined
      ? []
      : [
          {
            id: 'it',
            ref: { name: String(item.name), source: String(item.source) },
            qty: 1,
            equipped: true,
            attuned: true,
          },
        ]),
  ] as typeof doc.equipment;
  return deriveSheet(doc, ctx);
}

const fixtureFor = (key: string): DataEntity => {
  const [name, source] = key.split('|');
  return { name, source, type: 'RG', rarity: 'rare', ...FIELDS };
};

/** A damage string's flat part: "1d8+7" is 7, an unarmed strike's "3" is 3. */
const flat = (damage: string | undefined): number => {
  if (damage === undefined) return Number.NaN;
  const m = /[+-]\d+$/.exec(damage);
  return damage.includes('d') ? Number(m?.[0] ?? 0) : Number(damage);
};

const ROWS = ['Longsword', 'Shortbow', 'Sling', 'Unarmed Strike'];

describe('the built-in worn tag rows for bonus fields', () => {
  it('cover the misread items, each once, and read with no problem', () => {
    const keys = itemRules.rows
      .filter(
        (r) =>
          r.part === 'wornTags' &&
          'replaces' in r &&
          (r.replaces as string[]).some((k) => BONUS_KINDS.includes(k)),
      )
      .flatMap((r) => r.keys);
    expect([...keys].sort()).toEqual([...Object.keys(WEAPONS), ...Object.keys(SPELLS)].sort());
    expect(readRuleSet(itemRules).problems).toEqual([]);
  });

  const plain = sheetWith(undefined, ['Warrior']);
  for (const [key, given] of Object.entries(WEAPONS)) {
    it(`give ${key}'s weapon bonuses as its text says`, () => {
      const item = fixtureFor(key);
      const sheet = sheetWith(item, ['Warrior']);
      const row = (s: DerivedSheet, label: string) => s.attacks.find((a) => a.label === label);
      expect(
        ROWS.map((l) => row(sheet, l)?.toHit.parts.find((p) => p.label === item.name)?.amount ?? 0),
      ).toEqual(given.toHit);
      expect(ROWS.map((l) => flat(row(sheet, l)?.damage) - flat(row(plain, l)?.damage))).toEqual(
        given.damage,
      );
    });
  }

  for (const [key, given] of Object.entries(SPELLS)) {
    it(`give ${key}'s spell bonuses to the blocks its text says`, () => {
      const item = fixtureFor(key);
      const sheet = sheetWith(item, given.classes);
      const from = (parts: ReadonlyArray<{ label: string; amount: number }> | undefined) =>
        (parts ?? []).filter((p) => p.label === item.name).reduce((n, p) => n + p.amount, 0);
      const block = (c: string) => sheet.spellcasting.find((b) => b.className === c);
      expect(
        Object.fromEntries(given.classes.map((c) => [c, from(block(c)?.attackMod.parts)])),
      ).toEqual(given.attack);
      expect(
        Object.fromEntries(given.classes.map((c) => [c, from(block(c)?.saveDc.parts)])),
      ).toEqual(given.dc);
    });
  }
});
