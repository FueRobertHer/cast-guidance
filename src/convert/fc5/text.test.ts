import { describe, expect, it } from 'vitest';
import {
  abilityKey,
  defenseSentence,
  entryName,
  inlineText,
  lastGroup,
  leadIn,
  markerEdition,
  own,
  plainText,
  readArmor,
  readLanguages,
  readProficiencies,
  readText,
  readTools,
  readWeapons,
  rollLine,
  sourceLineEdition,
  splitList,
  splitName,
  standingDefenses,
  stripBookTags,
} from './text';

describe('defenseSentence', () => {
  it('reads resistances, immunities and vulnerabilities in the book’s words', () => {
    expect(defenseSentence('you have resistance to cold damage')).toEqual({ resist: ['cold'] });
    expect(defenseSentence('you have resistance to lightning damage and thunder damage')).toEqual({
      resist: ['lightning', 'thunder'],
    });
    expect(defenseSentence('you’re immune to poison damage and the poisoned condition')).toEqual({
      immune: ['poison'],
      conditionImmune: ['poisoned'],
    });
    expect(
      defenseSentence(
        'you have advantage on saving throws against poison, and you have resistance against poison damage',
      ),
    ).toEqual({ resist: ['poison'] });
    expect(
      defenseSentence('you are immune to the charmed, frightened, and stunned conditions'),
    ).toEqual({ conditionImmune: ['charmed', 'frightened', 'stunned'] });
    expect(defenseSentence('you have vulnerability to radiant damage')).toEqual({
      vulnerable: ['radiant'],
    });
  });

  it('reads nothing that lasts a while, offers a choice, or names something else', () => {
    for (const s of [
      'you have resistance to fire damage or poison damage',
      'you have resistance to one of the following damage types: necrotic, psychic, or radiant',
      'you have resistance to the damage type associated with your draconic ancestry',
      'you have resistance to bludgeoning damage from nonmagical attacks',
      'you can use your reaction to gain resistance to fire damage',
      'you have resistance to fire damage until you finish a long rest',
      'your familiar has resistance to the chosen damage type',
      'adapted to the frigid depths, you have resistance to cold damage',
      'you are immune to disease',
      'your familiar has darkvision and resistance to fire damage',
      'you gain a familiar with darkvision and resistance to fire damage',
      'you ignore resistance to cold damage and immunity to fire damage',
      "you have resistance to cold damage, as long as you aren't wearing heavy armor",
      'you are immune to the charmed and frightened conditions from spells',
      'you have immunity to poison damage and the poisoned condition from traps',
    ]) {
      expect(defenseSentence(s), s).toBeUndefined();
    }
  });
});

describe('rollLine', () => {
  it('lists the labeled rolls the text does not show', () => {
    expect(
      rollLine(
        [
          { description: 'Attack Bonus', dice: '1d20 + 8' },
          { description: 'Superiority Die', dice: 'd6' },
          { description: 'Thunder Damage', dice: '1d6' },
        ],
        ['It has a +8 bonus to hit.'],
      ),
    ).toBe(
      '{@b Rolls:} Attack Bonus {@dice 1d20+8}; Superiority Die {@dice d6}; Thunder Damage {@damage 1d6}',
    );
  });

  it('leaves out rolls the text tags, a table header included, and ones it is told of', () => {
    const table = { type: 'table', colLabels: ['{@dice d8}', 'Trait'], rows: [['1', 'Calm']] };
    expect(
      rollLine(
        [
          { description: 'Personality Trait', dice: '1d8' },
          { description: 'Fire', dice: '2d6' },
          { description: 'Weapon', dice: '1d4+3' },
          { dice: '1d20+5' },
          { description: 'Healing', dice: '1d8+%0' },
        ],
        [table, 'It deals {@damage 2d6} fire damage.'],
        ['1d4'],
      ),
    ).toBeUndefined();
  });
});

describe('standingDefenses', () => {
  it('reads first sentences, and list items after a standing lead-in', () => {
    expect(
      standingDefenses([
        'You have resistance to acid damage. When you are hit, you have resistance to fire damage.',
        'You gain the following benefits:',
        { type: 'list', items: ['You are immune to the poisoned condition.'] },
        { type: 'entries', name: 'Hardy', entries: ['You have resistance to cold damage.'] },
      ]),
    ).toEqual({ resist: ['acid', 'cold'], conditionImmune: ['poisoned'] });
  });

  it('reads no list after a lead-in that does not stand, and nothing after a choice', () => {
    expect(
      standingDefenses([
        'While raging, you gain the following benefits:',
        { type: 'list', items: ['You have resistance to fire damage.'] },
        'Arctic:',
        { type: 'list', items: ['You have resistance to cold damage.'] },
      ]),
    ).toEqual({});
    expect(
      standingDefenses([
        'Choose one of these gifts.',
        { type: 'entries', name: 'Frost', entries: ['You have resistance to cold damage.'] },
      ]),
    ).toEqual({});
  });

  it('reads every one-item list after a standing lead-in, and parts beside a settled choice', () => {
    expect(
      standingDefenses([
        'You gain the following benefits:',
        { type: 'list', items: ['Increase your Constitution score by 1.'] },
        { type: 'list', items: ['You have resistance to cold and poison damage.'] },
      ]),
    ).toEqual({ resist: ['cold', 'poison'] });
    expect(
      standingDefenses([
        'You gain the following benefits.',
        {
          type: 'entries',
          name: 'Ability Score Increase',
          entries: ['Increase one ability score of your choice by 1.'],
        },
        { type: 'entries', name: 'Antitoxic', entries: ['You have Immunity to Poison damage.'] },
      ]),
    ).toEqual({ immune: ['poison'] });
    expect(
      defenseSentence(
        'you have resistance to cold and fire damage and ignore difficult terrain created by ice',
      ),
    ).toEqual({ resist: ['cold', 'fire'] });
  });

  it('reads no named part whose name sets terms, or that follows a lead-in that does not stand', () => {
    expect(
      standingDefenses(readText(['While Raging. You have resistance to fire damage.']).entries),
    ).toEqual({});
    expect(
      standingDefenses(
        readText([
          'You gain the following benefits:',
          '• You have darkvision.',
          'Elemental Gift: Choose one of the following options:',
          '• You have resistance to fire damage.',
          '• You have resistance to cold damage.',
        ]).entries,
      ),
    ).toEqual({});
    expect(
      standingDefenses([
        'Your hide adapts to where you live:',
        { type: 'entries', name: 'Arctic', entries: ['You have resistance to cold damage.'] },
        { type: 'entries', name: 'Desert', entries: ['You have resistance to fire damage.'] },
      ]),
    ).toEqual({});
  });

  it('reads a tag that never closes in linear time', () => {
    const started = performance.now();
    expect(standingDefenses([`{@i ${'a'.repeat(200_000)}`])).toEqual({});
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('lists', () => {
  it('splits on commas, semicolons and "and", dropping blanks', () => {
    expect(splitList('Insight, Religion')).toEqual(['Insight', 'Religion']);
    expect(splitList('Ash, Soot, and Cinders')).toEqual(['Ash', 'Soot', 'Cinders']);
    expect(splitList('Ash; Soot;; ')).toEqual(['Ash', 'Soot']);
  });

  it('does not split inside a word that contains "and"', () => {
    expect(splitList('Sleight of Hand, Animal Handling')).toEqual([
      'Sleight of Hand',
      'Animal Handling',
    ]);
  });

  it('reads abilities by full name or abbreviation', () => {
    expect(abilityKey('Strength')).toBe('str');
    expect(abilityKey(' WIS ')).toBe('wis');
    expect(abilityKey('luck')).toBeUndefined();
  });
});

describe('own', () => {
  it('finds only the table own keys', () => {
    const table = { ash: 1 };
    expect(own(table, 'ash')).toBe(1);
    expect(own(table, 'soot')).toBeUndefined();
    expect(own(table, 'constructor')).toBeUndefined();
    expect(own(table, '__proto__')).toBeUndefined();
  });
});

describe('readProficiencies', () => {
  it('separates skills from whatever else the list names', () => {
    expect(readProficiencies('Insight, Religion, Wisdom Saving Throws')).toEqual({
      skills: ['insight', 'religion'],
      other: ['Wisdom Saving Throws'],
    });
  });

  it('reads multi-word skills joined by "and"', () => {
    expect(readProficiencies('Sleight of Hand and Animal Handling')).toEqual({
      skills: ['sleight of hand', 'animal handling'],
      other: [],
    });
  });
});

describe('readLanguages', () => {
  it('reads named languages', () => {
    expect(readLanguages('Common, Ignan, Deep Speech.')).toEqual({
      common: true,
      ignan: true,
      'deep speech': true,
    });
  });

  it('reads a count of languages of your choice', () => {
    expect(readLanguages('Two of your choice')).toEqual({ anyStandard: 2 });
    expect(readLanguages('Common and one extra language of your choice')).toEqual({
      common: true,
      anyStandard: 1,
    });
    expect(readLanguages('Common plus 2 standard languages of your choice')).toEqual({
      common: true,
      anyStandard: 2,
    });
  });

  it('reads the count a languages tag gives as "Any N languages"', () => {
    expect(readLanguages('Any 2 languages')).toEqual({ anyStandard: 2 });
    expect(readLanguages('Any one language')).toEqual({ anyStandard: 1 });
    expect(readLanguages('Any one of your choice')).toEqual({ anyStandard: 1 });
    expect(readLanguages('Sylvan, any one language')).toEqual({ sylvan: true, anyStandard: 1 });
  });

  it('reads one language of a list', () => {
    expect(readLanguages('Choose one of Elvish, Giant, or Kraul')).toEqual({
      choose: { from: ['elvish', 'giant', 'kraul'] },
    });
    expect(readLanguages('Choose one of Elvish, Dwarvish and Gnomish')).toEqual({
      choose: { from: ['elvish', 'dwarvish', 'gnomish'] },
    });
    expect(readLanguages('Choose one of Elvish, Giant, and Kraul')).toEqual({
      choose: { from: ['elvish', 'giant', 'kraul'] },
    });
    expect(readLanguages('Choose either Abyssal or Giant')).toEqual({
      choose: { from: ['abyssal', 'giant'] },
    });
    expect(readLanguages('One of your choice of Elvish, Gnomish, Goblin, or Sylvan')).toEqual({
      choose: { from: ['elvish', 'gnomish', 'goblin', 'sylvan'] },
    });
  });

  it('reads one of two named languages', () => {
    expect(readLanguages('Common, Draconic or Elven')).toEqual({
      common: true,
      choose: { from: ['draconic', 'elven'] },
    });
    expect(readLanguages('Common and either Abyssal or Void Speech')).toEqual({
      common: true,
      choose: { from: ['abyssal', 'void speech'] },
    });
  });

  it('reads no phrase about languages as a language', () => {
    expect(readLanguages('The Languages You Knew In Life')).toBeUndefined();
    expect(readLanguages('Common, telepathy')).toBeUndefined();
    expect(readLanguages('You only speak Common')).toBeUndefined();
    expect(readLanguages('Common, Speak Ratfolk')).toBeUndefined();
  });

  it('reads past a recommendation', () => {
    expect(readLanguages('Two of your choice (Celestial or Gith recommended)')).toEqual({
      anyStandard: 2,
    });
  });

  it('gives up on any other kind of choice or wording', () => {
    expect(readLanguages('Choose Ignan or Aquan')).toBeUndefined();
    expect(readLanguages('Common, 3 more')).toBeUndefined();
    expect(readLanguages('One racial language')).toBeUndefined();
    expect(
      readLanguages('Dwarvish or one other of your choice if you already speak Dwarvish'),
    ).toBeUndefined();
    expect(readLanguages('Primordial (Aquan, Auran, Ignan, or Terran)')).toBeUndefined();
    expect(readLanguages('Choose one of Elvish, or the tongue of your ancestors')).toBeUndefined();
    expect(readLanguages('')).toBeUndefined();
  });
});

describe('readTools', () => {
  it('reads a kind of tool as a choice of one', () => {
    expect(readTools('Choose one kind of Gaming Set')).toEqual({ anyGamingSet: 1 });
    expect(readTools("One type of Artisan's Tools")).toEqual({ anyArtisansTool: 1 });
    expect(readTools('Choose one kind of Artisan’s Tools')).toEqual({ anyArtisansTool: 1 });
    expect(readTools('one kind of Musical Instrument')).toEqual({ anyMusicalInstrument: 1 });
    expect(readTools('Gaming Set')).toEqual({ anyGamingSet: 1 });
    expect(readTools("One set of artisan's tools")).toEqual({ anyArtisansTool: 1 });
    expect(
      readTools('One gaming set of your choice (such as playing cards or three-dragon ante cards)'),
    ).toEqual({ anyGamingSet: 1 });
  });

  it('reads named tools beside kinds of tool', () => {
    expect(readTools('Lantern Kit, Ember Tongs')).toEqual({
      'lantern kit': true,
      'ember tongs': true,
    });
    expect(readTools("One type of gaming set, thieves' tools")).toEqual({
      anyGamingSet: 1,
      "thieves' tools": true,
    });
    expect(readTools("Artisan's Tools, Vehicles (Land)")).toEqual({
      anyArtisansTool: 1,
      'vehicles (land)': true,
    });
    expect(readTools('Vehicles (land) and vehicles (water)')).toEqual({
      'vehicles (land)': true,
      'vehicles (water)': true,
    });
  });

  it("names a tool of the rules by the rules' spelling, and keeps any other name", () => {
    expect(readTools('Disguise kits, one type of musical instrument')).toEqual({
      'disguise kit': true,
      anyMusicalInstrument: 1,
    });
    expect(readTools('Thieves tools, land-based vehicles')).toEqual({
      "thieves' tools": true,
      'vehicles (land)': true,
    });
    expect(readTools("Alchemist's tools")).toEqual({ "alchemist's supplies": true });
    expect(readTools('Herbalist kit, vehicle (water)')).toEqual({
      'herbalism kit': true,
      'vehicles (water)': true,
    });
    expect(readTools('Bagpipes, farm implements')).toEqual({
      bagpipes: true,
      'farm implements': true,
    });
  });

  it('reads any tool', () => {
    expect(readTools('Two of your choice')).toEqual({ any: 2 });
    expect(readTools('1 tool of your choice')).toEqual({ any: 1 });
  });

  it('reads one tool or kind of tool from a list', () => {
    expect(readTools('Your choice of a gaming set or a musical instrument')).toEqual({
      choose: { from: ['gaming set', 'musical instrument'] },
    });
    expect(readTools("One type of musical instrument or artisan's tools")).toEqual({
      choose: { from: ['musical instrument', "artisan's tools"] },
    });
    expect(readTools("Disguise kit, forgery kit, or thieves' tools (one of your choice)")).toEqual({
      choose: { from: ['disguise kit', 'forgery kit', "thieves' tools"] },
    });
    expect(
      readTools(
        "Artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools",
      ),
    ).toEqual({ choose: { from: ["smith's tools", "brewer's supplies", "mason's tools"] } });
  });

  it('gives up on anything else', () => {
    expect(readTools('Any one tool')).toBeUndefined();
    expect(readTools('Choose a kit')).toBeUndefined();
    expect(readTools('Special (see origin below)')).toBeUndefined();
    expect(readTools('Two proficiencies from the House Tool Proficiencies table')).toBeUndefined();
    expect(
      readTools("One type of artistic artisan's tools and one musical instrument"),
    ).toBeUndefined();
    expect(
      readTools("Disguise kit, and one type of artisan's tools or gaming set"),
    ).toBeUndefined();
    expect(readTools('Vehicles (water, land)')).toBeUndefined();
  });
});

describe('readWeapons', () => {
  it('reads weapons by name, in the edition book', () => {
    expect(readWeapons('Battleaxe, Handaxe, Light Hammer, Warhammer', '2014')).toEqual({
      'battleaxe|phb': true,
      'handaxe|phb': true,
      'light hammer|phb': true,
      'warhammer|phb': true,
    });
    expect(readWeapons('Longsword, Shortsword, Shortbow, and Longbow', '2024')).toEqual({
      'longsword|xphb': true,
      'shortsword|xphb': true,
      'shortbow|xphb': true,
      'longbow|xphb': true,
    });
  });

  it('reads plurals and a spaced name', () => {
    expect(readWeapons('Rapiers, short bows, hand crossbows', '2014')).toEqual({
      'rapier|phb': true,
      'shortbow|phb': true,
      'hand crossbow|phb': true,
    });
  });

  it('reads a category and a choice of weapons', () => {
    expect(readWeapons('Simple Weapons, Martial Weapons', '2014')).toEqual({
      simple: true,
      martial: true,
    });
    expect(readWeapons('Two martial weapons of your choice', '2014')).toEqual({
      choose: { fromFilter: 'type=martial weapon|miscellaneous=mundane', count: 2 },
    });
  });

  it('reads improvised weapons and firearms as their 5etools keys', () => {
    expect(readWeapons('Improvised Weapons', '2024')).toEqual({ improvised: true });
    expect(readWeapons('Firearms', '2014')).toEqual({ firearms: true });
  });

  it('gives up on a weapon it does not know', () => {
    expect(readWeapons('Finesse Weapons', '2014')).toBeUndefined();
    expect(readWeapons('Longsword, Whips of Fire', '2014')).toBeUndefined();
    expect(readWeapons('', '2014')).toBeUndefined();
  });
});

describe('readArmor', () => {
  it('reads the kinds of armor and shields', () => {
    expect(readArmor('Light Armor, Medium Armor, Shields')).toEqual({
      light: true,
      medium: true,
      shield: true,
    });
    expect(readArmor('Heavy armor.')).toEqual({ heavy: true });
  });

  it('gives up on anything else', () => {
    expect(readArmor('Light Armor, Hide')).toBeUndefined();
    expect(readArmor('')).toBeUndefined();
  });
});

describe('names and editions', () => {
  it('strips an edition marker and reports its edition', () => {
    expect(splitName('Ember Lance [5.5e]')).toEqual({ name: 'Ember Lance', edition: '2024' });
    expect(splitName('Keen Forager [2024]')).toEqual({ name: 'Keen Forager', edition: '2024' });
    expect(splitName('Ember Lance [XPHB]')).toEqual({ name: 'Ember Lance', edition: '2024' });
    expect(splitName('Ember Lance [2014]')).toEqual({ name: 'Ember Lance', edition: '2014' });
    expect(splitName('Ember Lance [5e]')).toEqual({ name: 'Ember Lance', edition: '2014' });
  });

  it('strips a source marker that names no edition', () => {
    expect(splitName('Ember Lance [HBX]')).toEqual({ name: 'Ember Lance' });
  });

  it('keeps a bracket that is not a marker', () => {
    expect(splitName('Glass Pike [Cursed]')).toEqual({ name: 'Glass Pike [Cursed]' });
    expect(splitName('Glass Pike [+1]')).toEqual({ name: 'Glass Pike [+1]' });
    expect(splitName('Glass [2024] Pike')).toEqual({ name: 'Glass [2024] Pike' });
  });

  it('keeps a name that is only a marker', () => {
    expect(splitName('[2024]')).toEqual({ name: '[2024]' });
  });

  it('collapses whitespace', () => {
    expect(splitName('  Ember \n  Lance  ')).toEqual({ name: 'Ember Lance' });
  });

  it('maps markers to editions', () => {
    expect(markerEdition('5.2.1')).toBe('2024');
    expect(markerEdition('xdmg')).toBe('2024');
    expect(markerEdition('5.1')).toBe('2014');
    expect(markerEdition('HBX')).toBeUndefined();
  });

  it('reads the edition a Source line points at', () => {
    expect(sourceLineEdition('Homebrew Codex (2024) p. 3')).toBe('2024');
    expect(sourceLineEdition('System Reference Document 5.2.1')).toBe('2024');
    expect(sourceLineEdition('System Reference Document 5.1')).toBe('2014');
    expect(sourceLineEdition('Homebrew Codex p. 3')).toBeUndefined();
  });
});

describe('inlineText', () => {
  it('turns HTML emphasis into 5etools tags and drops other tags', () => {
    expect(inlineText('<b>Bold</b>, <strong>strong</strong>, <i>it</i>, <em>em</em>')).toBe(
      '{@b Bold}, {@b strong}, {@i it}, {@i em}',
    );
    expect(inlineText('<span class="x">plain</span><br/>text')).toBe('plaintext');
  });

  it('drops an emphasis tag that is never closed', () => {
    expect(inlineText('<b>open and <i>it</i>')).toBe('open and {@i it}');
  });

  it('tags dice as damage when a damage type follows, else as dice', () => {
    expect(inlineText('It takes 2d6 fire damage.')).toBe('It takes {@damage 2d6} fire damage.');
    expect(inlineText('It takes 3d8 Radiant damage.')).toBe(
      'It takes {@damage 3d8} Radiant damage.',
    );
    expect(inlineText('Gain 1d4 temporary hit points.')).toBe(
      'Gain {@dice 1d4} temporary hit points.',
    );
    expect(inlineText('Roll 2d6')).toBe('Roll {@dice 2d6}');
  });

  it('tags dice as damage when "damage" follows within a word or two', () => {
    expect(inlineText('It takes 3d8 damage of the type you chose.')).toBe(
      'It takes {@damage 3d8} damage of the type you chose.',
    );
    expect(inlineText('It deals 1d4 extra damage.')).toBe('It deals {@damage 1d4} extra damage.');
    expect(inlineText('It deals 2d6 additional cold or fire damage.')).toBe(
      'It deals {@damage 2d6} additional cold or fire damage.',
    );
    expect(inlineText('Add 1d4 to the damage roll.')).toBe('Add {@dice 1d4} to the damage roll.');
    expect(inlineText('Attacks with them deal 1d4 less damage.')).toBe(
      'Attacks with them deal {@damage 1d4} less damage.',
    );
  });

  it('tags "roll a d4" as a roll, as 5etools does', () => {
    expect(inlineText('The target must roll a d4 and subtract it.')).toBe(
      'The target must roll a {@dice d4} and subtract it.',
    );
    expect(inlineText('Roll a d20.')).toBe('Roll a {@dice d20}.');
    expect(inlineText('Your die is a d6.')).toBe('Your die is a d6.');
  });

  it('keeps a flat bonus with the dice, without spaces', () => {
    expect(inlineText('Roll 1d20 + 3 to find it.')).toBe('Roll {@dice 1d20+3} to find it.');
    expect(inlineText('It takes 1d8-1 cold damage.')).toBe('It takes {@damage 1d8-1} cold damage.');
  });

  it('leaves existing 5etools tags alone', () => {
    expect(inlineText('{@damage 1d4} and {@dice 2d4|label} stay')).toBe(
      '{@damage 1d4} and {@dice 2d4|label} stay',
    );
    expect(inlineText('{@spell ember lance} deals 1d8 cold damage')).toBe(
      '{@spell ember lance} deals {@damage 1d8} cold damage',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(inlineText('  Ember   Lance  ')).toBe('Ember Lance');
  });
});

describe('leadIn', () => {
  it('reads a Title Case label ending in a period', () => {
    expect(leadIn('Repeatable. You can take this feat twice.')).toEqual({
      name: 'Repeatable',
      rest: 'You can take this feat twice.',
    });
    expect(leadIn('Wand of the Ember. It hums.')).toEqual({
      name: 'Wand of the Ember',
      rest: 'It hums.',
    });
  });

  it('reads a short label ending in a colon', () => {
    expect(leadIn('Versatile: Use it with two hands.')).toEqual({
      name: 'Versatile',
      rest: 'Use it with two hands.',
    });
    expect(leadIn('Sap (Mastery): The foe falters.')).toEqual({
      name: 'Sap (Mastery)',
      rest: 'The foe falters.',
    });
  });

  it('leaves ordinary prose alone', () => {
    expect(leadIn('The flame spreads. It ignites things.')).toBeUndefined();
    expect(leadIn('A. Not a label.')).toBeUndefined();
    expect(leadIn('One Two Three Four Five Six Seven: too long')).toBeUndefined();
    expect(leadIn('Caption:')).toBeUndefined();
  });
});

describe('entry names', () => {
  it('finds the last bracket, brackets inside it included', () => {
    expect(lastGroup('Ember Lance (Ash (Old))')).toEqual({
      base: 'Ember Lance',
      inner: 'Ash (Old)',
    });
    expect(lastGroup('Ember Lance')).toBeUndefined();
    expect(lastGroup('(Ash)')).toBeUndefined();
  });

  it('takes book tags out of the trailing brackets, wherever they sit', () => {
    expect(stripBookTags('Ember Fear (Charisma) (HB)')).toEqual({
      name: 'Ember Fear (Charisma)',
      tags: ['hb'],
    });
    expect(stripBookTags('Ember Acrobat (UA) (Proficient)')).toEqual({
      name: 'Ember Acrobat (Proficient)',
      tags: ['ua'],
    });
    expect(stripBookTags('Ember Lance (Ritual Only)')).toEqual({
      name: 'Ember Lance (Ritual Only)',
      tags: [],
    });
  });

  it('drops the footnote star, the tags and the edition marker', () => {
    expect(entryName('Ember Lance*')).toEqual({ name: 'Ember Lance' });
    expect(entryName('Ember Lance (UA) [5.5e]')).toEqual({ name: 'Ember Lance', edition: '2024' });
    expect(entryName('Ember Lance [5.5e] (UA)')).toEqual({ name: 'Ember Lance', edition: '2024' });
  });

  it('reads (Legacy) as the 2014 entry', () => {
    expect(entryName('Emberkin (Legacy)')).toEqual({ name: 'Emberkin', edition: '2014' });
  });
});

describe('readText', () => {
  it('joins a Source line that runs on after a comma, and drops a repeated label', () => {
    expect(readText(['Text.', 'Source: Ember Codex p. 2,', 'Ash Codex p. 9']).sourceLine).toBe(
      'Ember Codex p. 2, Ash Codex p. 9',
    );
    expect(readText(['Source: Source: Ember Codex p. 2']).sourceLine).toBe('Ember Codex p. 2');
  });

  it('makes every non-blank line a paragraph, across and within blocks', () => {
    expect(readText(['First line\nSecond   line', '', '   ', 'Third'])).toEqual({
      entries: ['First line', 'Second line', 'Third'],
    });
  });

  it('returns the last Source line separately', () => {
    const read = readText(['Text here.', 'Source: Old Codex p. 1', 'Source: Homebrew Codex p. 4']);
    expect(read).toEqual({ entries: ['Text here.'], sourceLine: 'Homebrew Codex p. 4' });
  });

  it('omits sourceLine when there is none', () => {
    expect('sourceLine' in readText(['Text here.'])).toBe(false);
  });

  it('reads pipe lines as a table captioned by the line before, its die column a roll', () => {
    const read = readText(['Ember Table:', 'd4 | Effect', '1 | Smoke', '2 | Sparks 1d6 fire']);
    expect(read.entries).toEqual([
      {
        type: 'table',
        caption: 'Ember Table',
        colLabels: ['{@dice d4}', 'Effect'],
        rows: [
          ['1', 'Smoke'],
          ['2', 'Sparks {@damage 1d6} fire'],
        ],
      },
    ]);
  });

  it('pads short rows, trims long ones and drops outer pipes', () => {
    const read = readText(['Plain intro.', '| A | B | C |', '1 | 2', '1|2|3|4']);
    expect(read.entries).toEqual([
      'Plain intro.',
      {
        type: 'table',
        colLabels: ['A', 'B', 'C'],
        rows: [
          ['1', '2', ''],
          ['1', '2', '3'],
        ],
      },
    ]);
  });

  it('keeps a single pipe line as a paragraph', () => {
    expect(readText(['Either this | or that']).entries).toEqual(['Either this | or that']);
  });

  it('reads a header of up to 24 columns as a table, and a wider one as text', () => {
    const header = (width: number) => Array.from({ length: width }, (_, k) => `c${k}`).join(' | ');
    const at24 = readText([header(24), 'x | y']).entries;
    expect(at24).toHaveLength(1);
    expect(at24[0]).toMatchObject({ type: 'table' });

    const at25 = readText([header(25), 'x | y']).entries;
    expect(at25).toEqual([header(25), 'x | y']);
  });

  it('reads bullet lines as a list', () => {
    const read = readText(['Choose one:', '• Smoke', '- Sparks', '* Ash 1d4 fire', 'After.']);
    expect(read.entries).toEqual([
      'Choose one:',
      { type: 'list', items: ['Smoke', 'Sparks', 'Ash {@damage 1d4} fire'] },
      'After.',
    ]);
  });

  it('reads lead-ins as named entries', () => {
    expect(readText(['Ember Burst. Each creature takes 2d6 fire damage.']).entries).toEqual([
      {
        type: 'entries',
        name: 'Ember Burst',
        entries: ['Each creature takes {@damage 2d6} fire damage.'],
      },
    ]);
  });
});

describe('plainText', () => {
  it('flattens strings, names, nested entries, list items and table rows', () => {
    const text = plainText([
      'Intro',
      { type: 'entries', name: 'Lead', entries: ['Inner'] },
      { type: 'list', items: ['A', 'B'] },
      { type: 'table', caption: 'Cap', colLabels: ['X'], rows: [['r1', 'r2']] },
    ]);
    expect(text).toBe('Intro\nLead\nInner\nA\nB\nr1\nr2');
  });
});
