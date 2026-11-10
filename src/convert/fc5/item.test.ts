import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import { fc5Context } from './compendium';
import type { Fc5Context, Fc5Result } from './context';
import {
  convertItem,
  itemAcBonus,
  itemDefenses,
  itemWeaponBonus,
  readDetail,
  readModifiers,
} from './item';

const ctx: Fc5Context = fc5Context('test.xml');

function done(result: Fc5Result) {
  if ('skip' in result) throw new Error(`skipped: ${result.skip}`);
  return result;
}

function item(body: string, context: Fc5Context = ctx) {
  return done(convertItem(parseXml(`<item>${body}</item>`), context));
}

function modifiers(...mods: string[]) {
  return readModifiers(parseXml(`<item>${mods.join('')}</item>`));
}

const bonus = (text: string) => `<modifier category="bonus">${text}</modifier>`;

const ALL_SKILLS = [
  'acrobatics',
  'animal handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight of hand',
  'stealth',
  'survival',
];

describe('readDetail', () => {
  it('reads rarity and attunement by a class', () => {
    expect(readDetail('rare (requires attunement by a wizard)')).toEqual({
      rarity: 'rare',
      reqAttune: 'by a wizard',
    });
  });

  it('reads plain attunement and a two-word rarity in any case', () => {
    expect(readDetail('Very Rare (requires attunement)')).toEqual({
      rarity: 'very rare',
      reqAttune: true,
    });
  });

  it('reads a rarity alone, or nothing', () => {
    expect(readDetail('uncommon')).toEqual({ rarity: 'uncommon' });
    expect(readDetail('adventuring gear')).toEqual({});
  });
});

describe('readModifiers', () => {
  it('folds matching attack and damage bonuses into one weapon bonus', () => {
    expect(modifiers(bonus('melee attacks +1'), bonus('melee damage +1'))).toEqual({
      fields: { bonusWeapon: '+1' },
      reasons: [],
    });
    expect(modifiers(bonus('weapon attack +2'), bonus('weapon damage +2')).fields).toEqual({
      bonusWeapon: '+2',
    });
  });

  it('keeps a damage bonus alone off the attack roll', () => {
    expect(modifiers(bonus('ranged damage +2')).fields).toEqual({ bonusWeaponDamage: '+2' });
  });

  it('keeps attack and damage apart when they differ', () => {
    expect(modifiers(bonus('melee attacks +1'), bonus('melee damage +2')).fields).toEqual({
      bonusWeaponAttack: '+1',
      bonusWeaponDamage: '+2',
    });
  });

  it('reads the other named bonuses, signed', () => {
    expect(
      modifiers(
        bonus('ac +1'),
        bonus('saving throws +1'),
        bonus('spell attack +2'),
        bonus('spell dc +2'),
        bonus('proficiency bonus + 1'),
      ).fields,
    ).toEqual({
      bonusAc: '+1',
      bonusSavingThrow: '+1',
      bonusSpellAttack: '+2',
      bonusSpellSaveDc: '+2',
      bonusProficiencyBonus: '+1',
    });
    expect(modifiers(bonus('Armor Class -1')).fields).toEqual({ bonusAc: '-1' });
  });

  it('treats a modifier with no category as a bonus', () => {
    expect(modifiers('<modifier>ac +2</modifier>').fields).toEqual({ bonusAc: '+2' });
  });

  it('adds ability score modifiers up', () => {
    const result = modifiers(
      '<modifier category="ability score">Strength +2</modifier>',
      '<modifier category="ability score">con +1</modifier>',
      '<modifier category="ability score">Strength -1</modifier>',
    );
    expect(result).toEqual({ fields: { ability: { str: 1, con: 1 } }, reasons: [] });
  });

  it('reads the same bonus on every skill as a bonus to ability checks', () => {
    const result = modifiers(
      ...ALL_SKILLS.map((s) => `<modifier category="skill">${s} +1</modifier>`),
    );
    expect(result).toEqual({ fields: { bonusAbilityCheck: '+1' }, reasons: [] });
  });

  it('keeps bonuses to some skills as text', () => {
    const result = modifiers(
      '<modifier category="skill">Stealth +2</modifier>',
      '<modifier category="skill">Arcana +1</modifier>',
    );
    expect(result).toEqual({
      fields: {},
      reasons: ['skill bonuses (stealth +2, arcana +1) are kept as text'],
    });
  });

  it('keeps what it cannot read as text', () => {
    expect(
      modifiers(
        bonus('advantage on stealth'),
        bonus('initiative +2'),
        '<modifier category="ability score">Luck +1</modifier>',
      ).reasons,
    ).toEqual([
      'the modifier "advantage on stealth" is kept as text',
      'the bonus "initiative +2" is kept as text',
      'the bonus "Luck +1" is kept as text',
    ]);
  });

  it('reads a speed bonus as a change to the walking speed', () => {
    expect(modifiers(bonus('speed + 10')).fields).toEqual({ modifySpeed: { bonus: { walk: 10 } } });
    expect(modifiers(bonus('Speed -5')).fields).toEqual({ modifySpeed: { bonus: { walk: -5 } } });
  });
});

describe('itemDefenses', () => {
  it('reads a sentence that says it holds while you wear or hold the item', () => {
    expect(itemDefenses('You have resistance to cold damage while you wear this armor.')).toEqual({
      resist: ['cold'],
    });
    expect(itemDefenses('While wearing the armor, you are immune to slashing damage.')).toEqual({
      immune: ['slashing'],
    });
    expect(
      itemDefenses('In addition, while you hold the sword, you have resistance to fire damage.'),
    ).toEqual({ resist: ['fire'] });
    expect(
      itemDefenses(
        'You are immune to necrotic and cold damage and vulnerable to fire and radiant damage while you wear this armor.',
      ),
    ).toEqual({ immune: ['necrotic', 'cold'], vulnerable: ['fire', 'radiant'] });
  });

  it('reads nothing a condition or choice before a colon sets terms for', () => {
    expect(
      itemDefenses(
        'When you attune to this armor, choose one of the following: while you wear this armor, you have resistance to fire damage.',
      ),
    ).toEqual({});
  });

  it('reads every clause of a sentence that holds while you wear it', () => {
    expect(
      itemDefenses(
        'While wearing this armor, you gain a +1 bonus to AC, you have advantage on saving throws against the breath weapons of dragons, and you have resistance to fire damage.',
      ),
    ).toEqual({ resist: ['fire'] });
    expect(
      itemDefenses(
        'While wearing this armor, you have a +1 bonus to Armor Class, and you have resistance to the following damage types: necrotic, poison, and psychic.',
      ),
    ).toEqual({ resist: ['necrotic', 'poison', 'psychic'] });
    expect(
      itemDefenses(
        'While you wear it, you have Immunity to the Poisoned condition and Poison damage.',
      ),
    ).toEqual({ immune: ['poison'], conditionImmune: ['poisoned'] });
    expect(
      itemDefenses(
        'While you hold the sword, you are immune to being charmed, and you have resistance to psychic damage.',
      ),
    ).toEqual({ resist: ['psychic'], conditionImmune: ['charmed'] });
  });

  it('reads the sentence right after a lead-in that holds while you wear it', () => {
    expect(
      itemDefenses(
        'While you wear this armor, you gain the following benefits: You have resistance to psychic damage.',
      ),
    ).toEqual({ resist: ['psychic'] });
  });

  it("reads the item's own name, a tattoo on your skin, and a clause beside one that is no defense", () => {
    expect(
      itemDefenses(
        "While attuned to Kyrzin's ooze, you have resistance to poison and acid damage, and you're immune to the poisoned condition.",
        "Kyrzin's Ooze",
      ),
    ).toEqual({ resist: ['poison', 'acid'], conditionImmune: ['poisoned'] });
    expect(
      itemDefenses('You are immune to cold damage while holding Matalotok.', 'Matalotok'),
    ).toEqual({
      immune: ['cold'],
    });
    expect(
      itemDefenses('While the tattoo is on your skin, you have resistance to acid damage.'),
    ).toEqual({ resist: ['acid'] });
    expect(
      itemDefenses(
        'While wearing this armor, you gain a +3 bonus to AC, you are immune to fire damage, and you can understand and speak Primordial.',
      ),
    ).toEqual({ immune: ['fire'] });
    expect(
      itemDefenses(
        'Additionally, while you are attuned to the egg, you gain resistance to poison damage.',
      ),
    ).toEqual({ resist: ['poison'] });
    // A word that makes any clause pass makes the whole sentence pass.
    expect(
      itemDefenses(
        'While wearing this armor, you have resistance to fire damage, and you lose it when you remove the armor.',
      ),
    ).toEqual({});
  });

  it('leaves a defense that lasts a while, hangs on a choice or another condition', () => {
    for (const text of [
      'You have resistance to fire damage.',
      'As an action, you gain one of the following benefits of your choice for 1 hour: You have resistance to fire damage.',
      'When you drink this potion, you gain resistance to fire damage for 1 hour.',
      'While wearing this armor, you have resistance to one of the following damage types: fire, cold, or acid.',
      'While wearing this armor, you have resistance to piercing damage from nonmagical weapons.',
      'While wearing the stormgirdle in its dormant state, you have resistance to lightning damage.',
      'While semi-incorporeal, you have resistance to bludgeoning, piercing, and slashing damage.',
      'You and your allies are immune to the frightened condition while within 20 feet of it.',
    ]) {
      expect(itemDefenses(text), text).toEqual({});
    }
  });
});

describe('convertItem', () => {
  it('fills its defenses and speed from its text and modifiers', () => {
    const result = item(`
      <name>Glacier Plate</name>
      <type>HA</type>
      <magic>YES</magic>
      <detail>rare (requires attunement)</detail>
      <ac>18</ac>
      ${bonus('speed +5')}
      <text>You have resistance to cold damage while you wear this armor.</text>
    `);
    expect(result.entity).toMatchObject({
      resist: ['cold'],
      modifySpeed: { bonus: { walk: 5 } },
    });
    expect(result.reasons).toEqual([]);
  });

  it('reads a bonus to AC the text gives while you wear the item', () => {
    expect(
      itemAcBonus(
        'While wearing these bracers, you gain a +2 bonus to AC if you are wearing no armor and using no shield.',
      ),
    ).toBe('+2');
    expect(
      itemAcBonus(
        'You have a +2 bonus to AC while wearing these bracers, if you do not wear armor or use a shield at the same time.',
      ),
    ).toBe('+2');
    expect(
      itemAcBonus(
        'While wearing this armor, you gain a +3 bonus to AC, you are immune to fire damage, and you can understand and speak Primordial.',
      ),
    ).toBe('+3');
    expect(
      itemAcBonus(
        'While wearing this armor, you gain a +1 bonus to AC and to saving throws against spells and other magical effects.',
      ),
    ).toBe('+1');
    // Terms of its own, a while, someone else, or no "while you wear it".
    for (const text of [
      'You gain a +2 bonus to AC against ranged attacks while you wield this shield.',
      'You gain a +1 bonus to AC for every two allies within 5 feet of you while you wield this shield.',
      'While wearing this armor, you gain a +1 bonus to AC until the start of your next turn.',
      'While holding this horn, you and all affected creatures gain a +1 bonus to AC.',
      'You gain a +1 bonus to AC.',
    ]) {
      expect(itemAcBonus(text)).toBeUndefined();
    }
  });

  it('reads a weapon bonus the text states for good, and none in a list or for a while', () => {
    expect(
      itemWeaponBonus('You gain a +1 bonus to attack and damage rolls made with this war pick.'),
    ).toBe('+1');
    expect(
      itemWeaponBonus(
        'In addition, you gain a +1 bonus to attack and damage rolls made using the weapon.',
      ),
    ).toBe('+1');
    expect(
      itemWeaponBonus(
        'This staff can be wielded as a magic quarterstaff that grants a +2 bonus to attack and damage rolls made with it.',
      ),
    ).toBe('+2');
    for (const text of [
      'Dormant State:\n• You gain a +1 bonus to attack and damage rolls made with this magic weapon.',
      'Until the end of your turn, you gain a +2 bonus to attack and damage rolls made with this weapon.',
      'You gain a +2 bonus to attack and damage rolls made with this weapon for 1 minute.',
      'Only the one chosen gains a +2 bonus to attack and damage rolls made with this magic weapon.',
      '8 | You gain a +3 bonus to attack and damage rolls made with this weapon',
    ]) {
      expect(itemWeaponBonus(text)).toBeUndefined();
    }
    const pick = (modifier: string) =>
      item(
        `<name>Pick</name><type>M</type><dmg1>1d8</dmg1><dmgType>P</dmgType><text>You gain a +1 bonus to attack and damage rolls made with this war pick.</text>${modifier}`,
      ).entity;
    expect(pick('').bonusWeapon).toBe('+1');
    // A modifier says what the file means, even when it says less than the text.
    expect(pick('<modifier category="bonus">melee attacks +2</modifier>')).toMatchObject({
      bonusWeaponAttack: '+2',
    });
    expect(
      pick('<modifier category="bonus">melee attacks +2</modifier>').bonusWeapon,
    ).toBeUndefined();
  });

  it('keeps the bonus to AC a modifier gives over the one its text states', () => {
    const ward = (modifier: string) =>
      item(
        `<name>Ward</name><type>W</type><text>While wearing these bracers, you gain a +2 bonus to AC.</text>${modifier}`,
      ).entity.bonusAc;
    expect(ward('')).toBe('+2');
    expect(ward('<modifier category="bonus">ac +1</modifier>')).toBe('+1');
    // A list is for one of the item's states, which the official data leaves to the reader.
    const jewel = item(
      `<name>Jewel</name><type>W</type><dmg1>1d4</dmg1><text>In its Dormant State, the jewel has the following properties:</text><text>• You gain a +1 bonus to AC while wearing the jewel.</text><text>• You gain a +1 bonus to attack and damage rolls made with this magic weapon.</text>`,
    ).entity;
    expect(jewel.bonusAc).toBeUndefined();
    expect(jewel.bonusWeapon).toBeUndefined();
  });

  it("reads what an attuned item's text states for good, and nothing a choice offers", () => {
    const attuned = (text: string, detail = 'rare (requires attunement)') =>
      item(`<name>Ember Cloak</name><type>W</type><detail>${detail}</detail>${text}`).entity;
    expect(
      attuned(
        '<text>While wearing this cloak, you gain the following benefits:</text><text>• You have resistance to poison damage.</text><text>• You have a climbing speed.</text>',
      ).resist,
    ).toEqual(['poison']);
    expect(attuned('<text>You have resistance against lightning damage.</text>').resist).toEqual([
      'lightning',
    ]);
    expect(
      attuned(
        '<text>When you attune to this cloak, choose one of the following:</text><text>• You have resistance to fire damage.</text><text>• You have resistance to cold damage.</text>',
      ).resist,
    ).toBeUndefined();
    // Without attunement nothing says when a bare sentence holds.
    expect(
      attuned('<text>You have resistance to fire damage.</text>', 'rare').resist,
    ).toBeUndefined();
  });

  it('converts a magic melee weapon', () => {
    const result = item(`
      <name>Cinder Axe</name>
      <type>M</type>
      <magic>YES</magic>
      <detail>uncommon</detail>
      <weight>4</weight>
      <value>15</value>
      <property>V,M,F</property>
      <dmg1>1d8</dmg1>
      <dmg2>1d10</dmg2>
      <dmgType>S</dmgType>
      ${bonus('melee attacks +1')}
      ${bonus('melee damage +1')}
      <text>A blackened axe that never cools.</text>
      <text>Sap (Mastery): A struck foe falters.</text>
    `);
    expect(result.kind).toBe('item');
    expect(result.edition).toBe('2014');
    expect(result.reasons).toEqual([]);
    expect(result.entity).toEqual({
      name: 'Cinder Axe',
      source: 'FCTest',
      type: 'M',
      rarity: 'uncommon',
      weight: 4,
      value: 1500,
      dmg1: '1d8',
      dmg2: '1d10',
      dmgType: 'S',
      property: ['V', 'F'],
      weaponCategory: 'martial',
      mastery: ['Sap|XPHB'],
      bonusWeapon: '+1',
      entries: [
        'A blackened axe that never cools.',
        { type: 'entries', name: 'Sap (Mastery)', entries: ['A struck foe falters.'] },
      ],
    });
  });

  it('converts a simple ranged weapon with its range', () => {
    const result = item(`
      <name>Reed Bow</name><type>R</type><property>A, 2H</property>
      <dmg1>1 d6</dmg1><dmgType>P</dmgType><range>80 / 320</range>
    `);
    expect(result.entity).toEqual({
      name: 'Reed Bow',
      source: 'FCTest',
      type: 'R',
      rarity: 'none',
      dmg1: '1d6',
      dmgType: 'P',
      property: ['A', '2H'],
      weaponCategory: 'simple',
      range: '80/320',
    });
  });

  it('ignores a range that is not two numbers', () => {
    expect(item('<name>Reed Bow</name><type>R</type><range>touch</range>').entity.range).toBe(
      undefined,
    );
  });

  it('maps the damage codes 5etools spells differently', () => {
    const dmg = (code: string) =>
      item(`<name>Odd Blade</name><type>M</type><dmg1>1d4</dmg1><dmgType>${code}</dmgType>`).entity
        .dmgType;
    expect(dmg('FC')).toBe('O');
    expect(dmg('ps')).toBe('I');
    expect(dmg('PY')).toBe('Y');
    expect(dmg('R')).toBe('R');
  });

  it('leaves out a damage type with no damage dice', () => {
    expect(item('<name>Odd Blade</name><type>M</type><dmgType>S</dmgType>').entity.dmgType).toBe(
      undefined,
    );
  });

  it('reports unknown weapon properties', () => {
    const result = item('<name>Odd Blade</name><type>M</type><property>F,ZZ,Q</property>');
    expect(result.entity.property).toEqual(['F']);
    expect(result.reasons).toEqual(['unknown weapon properties ZZ, Q']);
  });

  it('converts gold-piece values to copper, fractions kept', () => {
    expect(item('<name>Pebble</name><type>A</type><value>0.02</value>').entity.value).toBe(2);
    expect(item('<name>Grit</name><type>A</type><value>0.002</value>').entity.value).toBe(0.2);
    expect(item('<name>Grit</name><type>A</type><value>0</value>').entity.value).toBeUndefined();
  });

  it('converts armor', () => {
    const result = item(`
      <name>Slag Plate</name><type>HA</type><ac>18</ac><strength>15</strength>
      <stealth>YES</stealth><weight>60</weight>
    `);
    expect(result.entity).toEqual({
      name: 'Slag Plate',
      source: 'FCTest',
      type: 'HA',
      rarity: 'none',
      weight: 60,
      ac: 18,
      strength: '15',
      stealth: true,
    });
  });

  describe('types', () => {
    it('marks a W item wondrous, with no type', () => {
      const result = item(
        '<name>Lantern of Ash</name><type>W</type><detail>rare (requires attunement by a wizard)</detail>',
      );
      expect(result.entity.type).toBeUndefined();
      expect(result.entity.wondrous).toBe(true);
      expect(result.entity.rarity).toBe('rare');
      expect(result.entity.reqAttune).toBe('by a wizard');
    });

    it('gives a magic item with no rarity word an unknown rarity', () => {
      expect(item('<name>Lantern of Ash</name><type>W</type>').entity.rarity).toBe(
        'unknown (magic)',
      );
    });

    it('ignores a rarity word on mundane gear', () => {
      const result = item('<name>Rope Coil</name><type>G</type><detail>common</detail>');
      expect(result.entity.type).toBe('G');
      expect(result.entity.rarity).toBe('none');
    });

    it('counts attunement as magic', () => {
      const result = item(
        '<name>Rope Coil</name><type>G</type><detail>common (requires attunement)</detail>',
      );
      expect(result.entity.rarity).toBe('common');
      expect(result.entity.reqAttune).toBe(true);
    });

    it('reads the gear kind from the detail', () => {
      const kind = (detail: string, type = 'G') =>
        item(`<name>Kit</name><type>${type}</type><detail>${detail}</detail>`).entity.type;
      expect(kind("artisan's tools")).toBe('AT');
      expect(kind('musical instrument')).toBe('INS');
      expect(kind('gaming set')).toBe('GS');
      expect(kind('holy symbol')).toBe('SCF');
      expect(kind('mount')).toBe('MNT');
      expect(kind('vehicle (water)')).toBe('SHP');
      expect(kind('vehicle (air)')).toBe('AIR');
      expect(kind('vehicle (land)')).toBe('VEH');
      expect(kind('tools')).toBe('T');
      expect(kind('gaming set', '')).toBe('GS');
    });

    it('gives an untyped item with no gear kind no type', () => {
      expect(item('<name>Kit</name>').entity.type).toBeUndefined();
    });

    it('keeps a plain spellcasting focus out of the magic items', () => {
      const result = item('<name>Ash Wand</name><type>WD</type><detail>arcane focus</detail>');
      expect(result.entity.type).toBe('WD');
      expect(result.entity.rarity).toBe('none');
    });

    it('reads a ring as magic', () => {
      const result = item('<name>Ember Ring</name><type>RG</type><detail>uncommon</detail>');
      expect(result.entity.type).toBe('RG');
      expect(result.entity.rarity).toBe('uncommon');
    });

    it('reads a staff with no weapon traits as a focus you can wield as a quarterstaff', () => {
      // As the official data gives every staff, the Player's Handbook focus among them.
      const quarterstaff = {
        staff: true,
        dmg1: '1d6',
        dmg2: '1d8',
        dmgType: 'B',
        property: ['V'],
        weaponCategory: 'simple',
      };
      const result = item('<name>Ash Staff</name><type>ST</type>');
      expect(result.entity).toMatchObject({ type: 'SCF', ...quarterstaff });
      expect(result.entity.mastery).toBeUndefined();
      // A 2024 staff is a Quarterstaff, mastery and all.
      expect(item('<name>Ash Staff [2024]</name><type>ST</type>').entity).toMatchObject({
        type: 'M',
        ...quarterstaff,
        mastery: ['Topple|XPHB'],
      });
    });

    it('reads a versatile staff as a quarterstaff', () => {
      const result = item(
        '<name>Ash Staff</name><type>ST</type><property>V</property><magic>YES</magic><detail>rare</detail>',
      );
      expect(result.entity).toMatchObject({
        type: 'M',
        staff: true,
        dmg1: '1d6',
        dmg2: '1d8',
        dmgType: 'B',
        property: ['V'],
        weaponCategory: 'simple',
        rarity: 'rare',
      });
    });

    it('keeps a staff with its own dice', () => {
      const result = item(
        '<name>Ash Staff</name><type>ST</type><dmg1>1d4</dmg1><dmgType>FC</dmgType>',
      );
      expect(result.entity).toMatchObject({ type: 'M', dmg1: '1d4', dmgType: 'O' });
      expect(result.entity.dmg2).toBeUndefined();
    });

    it('reads currency', () => {
      expect(item('<name>Ash Coin</name><type>$</type>').entity.type).toBe('$C');
    });

    it('files a poison as gear', () => {
      const result = item('<name>Ash Venom</name><type>P</type><detail>poison (injury)</detail>');
      expect(result.entity).toMatchObject({
        type: 'G',
        poison: true,
        poisonTypes: ['injury'],
        rarity: 'none',
      });
    });

    it('keeps a potion a magic potion', () => {
      const result = item('<name>Ember Draught</name><type>P</type><detail>uncommon</detail>');
      expect(result.entity.type).toBe('P');
      expect(result.entity.poison).toBeUndefined();
      expect(result.entity.rarity).toBe('uncommon');
    });

    it('reports an unknown type code', () => {
      const result = item('<name>Odd Thing</name><type>XQ</type>');
      expect(result.entity.type).toBeUndefined();
      expect(result.reasons).toEqual(['its type "XQ" is not one this app knows']);
    });
  });

  it('reads mastery only on weapons', () => {
    const text = '<text>Sap (Mastery): A struck foe falters.</text>';
    expect(item(`<name>Cudgel</name><type>M</type>${text}`).entity.mastery).toEqual(['Sap|XPHB']);
    expect(item(`<name>Charm</name><type>W</type>${text}`).entity.mastery).toBeUndefined();
  });

  it('reads the edition from a name marker or a Source line', () => {
    const marked = item('<name>Cinder Axe [2024]</name><type>M</type>');
    expect(marked.name).toBe('Cinder Axe');
    expect(marked.edition).toBe('2024');
    expect(marked.entity.edition).toBe('one');

    const sourced = item(
      '<name>Cinder Axe</name><type>M</type><text>Hot.</text><text>Source: Homebrew Codex (2024)</text>',
    );
    expect(sourced.edition).toBe('2024');
    expect(sourced.entity.source).toBe('FCHomebrewCodex2024');
    expect(sourced.entity.entries).toEqual(['Hot.']);
  });

  it('falls back to the file edition', () => {
    expect(item('<name>Rope Coil</name>', fc5Context('test_5.5e.xml')).edition).toBe('2024');
  });

  it('leaves entries out when there is no text', () => {
    expect('entries' in item('<name>Rope Coil</name><type>G</type>').entity).toBe(false);
  });

  it('carries modifier reasons into the result', () => {
    const result = item(`<name>Ember Ring</name><type>RG</type>${bonus('initiative +2')}`);
    expect(result.reasons).toEqual(['the bonus "initiative +2" is kept as text']);
  });

  it('skips an entry with no name', () => {
    expect(convertItem(parseXml('<item><type>G</type></item>'), ctx)).toEqual({
      skip: 'it has no name',
    });
  });
});

describe('what an item gives only under terms', () => {
  it('reads no defense or AC bonus a condition opens or a terms clause precedes', () => {
    for (const text of [
      'While raging, you have resistance to fire damage while you wear this armor.',
      'If the wand has at least 1 charge remaining, you have resistance to necrotic damage while you hold it.',
      'While you wear this armor and you are raging, you have resistance to fire damage.',
      'While wearing this armor, you can use a bonus action to speak its command word, and you have resistance to fire damage.',
    ]) {
      expect(itemDefenses(text), text).toEqual({});
    }
    for (const text of [
      'While raging, you gain a +1 bonus to AC while you wear this armor.',
      'Once per day, you gain a +2 bonus to AC while wearing this armor.',
      'While enlarged, your size becomes Large, and you gain a +1 bonus to AC while you wield the shield.',
      'While you wear this armor and you are bloodied, you gain a +2 bonus to AC.',
      'While wearing this armor, you gain a +1 bonus to AC and to saving throws while you are raging.',
      'While wearing this ring, you gain a +1 bonus to AC and saving throws against undead.',
      'While wearing this item, you gain a +2 bonus to AC if you wear no armor and are using a shield.',
      'While wearing this cloak, you gain a +1 bonus to AC and saving throws in dim light or darkness.',
      'While wearing this cap underwater, you gain a +1 bonus to AC.',
      'While you hold this shield aloft, you gain a +2 bonus to AC.',
    ]) {
      expect(itemAcBonus(text), text).toBeUndefined();
    }
    // The Blackstaff's list of what else the bonus is to.
    expect(
      itemAcBonus(
        'While holding it, you gain a +2 bonus to Armor Class, saving throws, and spell attack rolls.',
      ),
    ).toBe('+2');
    // A clause after the bonus with no hold over it leaves the bonus as it is.
    expect(
      itemAcBonus(
        'While wearing this armor, you gain a +3 bonus to AC, you are immune to fire damage, and you can understand and speak Primordial.',
      ),
    ).toBe('+3');
    expect(
      itemAcBonus(
        "While wearing these bracers, you gain a +2 bonus to AC if you aren't wearing armor or using a shield.",
      ),
    ).toBe('+2');
  });

  it('reads no weapon bonus with terms after it, or after a sentence that sets them', () => {
    for (const text of [
      'You gain a +1 bonus to attack and damage rolls made with it against undead.',
      'You gain a +2 bonus to attack and damage rolls made with it while raging.',
      'You gain a +2 bonus to attack and damage rolls made with this weapon, but only against undead.',
      'You gain a +1 bonus to attack and damage rolls made with this weapon, once per day.',
      "When you speak this sword's command word, flames erupt from the blade. You gain a +2 bonus to attack and damage rolls made with this magic weapon.",
      "You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade. You gain a +2 bonus to attack and damage rolls made with this weapon.",
    ]) {
      expect(itemWeaponBonus(text), text).toBeUndefined();
    }
    for (const text of [
      'You gain a +2 bonus to attack and damage rolls made with this sword, and it deals an extra 2d6 damage on a hit.',
      // The terms in a later clause are that clause's.
      'You gain a +2 bonus to attack and damage rolls made with this magic weapon, and you ignore the normal penalties on ranged weapon attacks while using this weapon underwater.',
      'You gain a +2 bonus to attack and damage rolls made with this bow, and you suffer no disadvantage when attacking at long range.',
    ]) {
      expect(itemWeaponBonus(text), text).toBe('+2');
    }
  });

  it("reads no bonus from a part for one of the item's states, or from a bullet line", () => {
    const weapon = (...text: string[]) =>
      item(
        `<name>Wrath Blade</name><type>M</type><magic>YES</magic><dmg1>1d8</dmg1><dmgType>S</dmgType>${text.map((t) => `<text>${t}</text>`).join('')}`,
      ).entity;
    expect(
      weapon(
        'This weapon awakens as its wielder grows.',
        'Stirring (Rare): You gain a +1 bonus to attack and damage rolls made with this magic weapon.',
      ).bonusWeapon,
    ).toBeUndefined();
    const jewel = weapon(
      'In its Dormant State, the jewel has the following properties:',
      '•You gain a +1 bonus to AC while wearing the jewel.',
      '•You gain a +1 bonus to attack and damage rolls made with this magic weapon.',
    );
    expect([jewel.bonusAc, jewel.bonusWeapon]).toEqual([undefined, undefined]);
    // A state's label on a line of its own, as the 5.5e file writes Dragon's Wrath weapons.
    expect(
      weapon(
        'This weapon is decorated with dragon heads.',
        'Slumbering (Uncommon):',
        'Whenever you roll a 20 on your attack roll with this weapon, each creature of your choice within 5 feet of the target takes 5 damage.',
        'Stirring (Rare):',
        'The Stirring weapon has the Slumbering property. In addition, you gain a +1 bonus to attack and damage rolls made using the weapon.',
      ).bonusWeapon,
    ).toBeUndefined();
  });

  it("reads no defense an attuned item's text gives under a heading or a lead-in with terms", () => {
    const cloak = (text: string) =>
      item(
        `<name>Storm Cloak</name><type>W</type><detail>rare (requires attunement)</detail><text>${text}</text>`,
      ).entity;
    const scion = cloak(
      'You gain resistance to lightning damage.\nTATTOOED\nThe distance you can teleport increases to 30 feet.\nSCARIFIED\nYou gain immunity to lightning damage.',
    );
    expect([scion.resist, scion.immune]).toEqual([['lightning'], undefined]);
    expect(
      cloak(
        'As an action, you can turn into mist for 1 minute. While in this form:\nYou have resistance to fire damage.',
      ).resist,
    ).toBeUndefined();
  });

  it("keeps a staff's own rolls that match the quarterstaff dice, and drops a bonus the text applies from the report", () => {
    const staff = item(
      '<name>Ember Staff</name><type>ST</type><magic>YES</magic><text>The staff has charges.</text><roll description="Regain Charges">1d6+4</roll><roll description="Fire Damage">1d8</roll>',
    );
    expect(JSON.stringify(staff.entity.entries)).toContain('Fire Damage {@damage 1d8}');
    const bracers = item(
      '<name>Guard Bracers</name><type>W</type><magic>YES</magic><attunement>Requires Attunement</attunement><modifier category="bonus">unarmored armor class +2</modifier><text>While wearing these bracers, you gain a +2 bonus to AC if you are wearing no armor and using no shield.</text>',
    );
    expect([bracers.entity.bonusAc, bracers.reasons]).toEqual(['+2', []]);
  });

  it('reads the defenses a named part gives after a held lead-in that ends a paragraph', () => {
    const rod = item(
      '<name>Rod of Embers</name><type>RD</type><detail>very rare (requires attunement)</detail><text>This rod can be used as an arcane focus. While holding this rod, you gain the following benefits:</text><text>Ember Resistance:</text><text>You have resistance to fire and necrotic damage.</text>',
    ).entity;
    expect(rod.resist).toEqual(['fire', 'necrotic']);
  });
});
