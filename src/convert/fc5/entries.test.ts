import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import {
  addFeatSource,
  backgroundAbility,
  convertBackground,
  featGrant,
  readSkills,
} from './background';
import { fc5Context } from './compendium';
import type { Fc5Context, Fc5Result, FeatRef } from './context';
import { abilityFromProse, convertFeat, featCategory, readPrerequisite } from './feat';
import { convertRace, raceAbility, traitRules } from './race';

const ctx: Fc5Context = fc5Context('test.xml');

/** The installed feats a test's game data has, by `name|edition`. */
const OFFICIAL_FEATS: Record<string, string> = {
  'ember adept|2024': 'ember adept|xphb',
  'iron lungs|2014': 'iron lungs|phb',
  'iron lungs|2024': 'iron lungs|xphb',
};
const withOfficial: Fc5Context = fc5Context('test.xml', {
  officialFeat: (name, edition) => OFFICIAL_FEATS[`${name.toLowerCase()}|${edition}`],
});

/** A context whose file converts these feats, as `[name, source]`. */
function withFeats(...feats: [string, string][]): Fc5Context {
  const featSources = new Map<string, FeatRef[]>();
  for (const [name, source] of feats) addFeatSource(featSources, name, source);
  return fc5Context('test.xml', { featSources });
}

function done(result: Fc5Result) {
  if ('skip' in result) throw new Error(`skipped: ${result.skip}`);
  return result;
}

function trait(name: string, ...text: string[]): string {
  return `<trait><name>${name}</name>${text.map((t) => `<text>${t}</text>`).join('')}</trait>`;
}

const ALL_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

describe('feats', () => {
  describe('featCategory', () => {
    it('reads the category prefix off the name', () => {
      expect(featCategory('Origin: Keen Forager')).toEqual({
        name: 'Keen Forager',
        category: 'O',
      });
      expect(featCategory('General Feat: Iron Lungs')).toEqual({
        name: 'Iron Lungs',
        category: 'G',
      });
      expect(featCategory('Fighting Style Feats: Twin Guard')).toEqual({
        name: 'Twin Guard',
        category: 'FS',
      });
      expect(featCategory('epic boon: Star Step')).toEqual({ name: 'Star Step', category: 'EB' });
    });

    it('leaves a name with no prefix alone', () => {
      expect(featCategory('Keen Forager')).toEqual({ name: 'Keen Forager' });
      expect(featCategory('Lore: Keen Forager')).toEqual({ name: 'Lore: Keen Forager' });
    });
  });

  describe('readPrerequisite', () => {
    it('reads a level written as an ordinal', () => {
      expect(readPrerequisite('4th-level character')).toEqual([{ level: 4 }]);
      expect(readPrerequisite('Level 4')).toEqual([{ level: 4 }]);
    });

    it('reads an ability minimum', () => {
      expect(readPrerequisite('Dexterity 13 or higher')).toEqual([{ ability: [{ dex: 13 }] }]);
      expect(readPrerequisite('Strength 13+')).toEqual([{ ability: [{ str: 13 }] }]);
    });

    it('keeps anything else as other text', () => {
      expect(readPrerequisite('The ability to cast at least one spell')).toEqual([
        { other: 'The ability to cast at least one spell' },
      ]);
      expect(readPrerequisite('4th level, proficiency with a shield')).toEqual([
        { level: 4, other: '4th level, proficiency with a shield' },
      ]);
    });
  });

  describe('abilityFromProse', () => {
    it('reads an increase to any ability', () => {
      expect(abilityFromProse('Increase one ability score of your choice by 1.')).toEqual([
        { choose: { from: ALL_ABILITIES } },
      ]);
      expect(abilityFromProse('Increase one ability score of your choice by 2.')).toEqual([
        { choose: { from: ALL_ABILITIES, amount: 2 } },
      ]);
    });

    it('reads +2 to one score or +1 to two as the two choices the 2024 feat has', () => {
      expect(
        abilityFromProse(
          'Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1.',
        ),
      ).toEqual([
        { choose: { from: ALL_ABILITIES, amount: 2 } },
        { choose: { from: ALL_ABILITIES, count: 2 } },
      ]);
    });

    it('reads an increase to named abilities', () => {
      expect(abilityFromProse('Increase your Constitution score by 1.')).toEqual([{ con: 1 }]);
      expect(abilityFromProse('Increase your Strength or Dexterity score by 1.')).toEqual([
        { choose: { from: ['str', 'dex'] } },
      ]);
      expect(
        abilityFromProse('Increase your Intelligence, Wisdom, or Charisma score by 2.'),
      ).toEqual([{ choose: { from: ['int', 'wis', 'cha'], amount: 2 } }]);
    });

    it('finds nothing in other prose', () => {
      expect(abilityFromProse('You feel braver.')).toBeUndefined();
    });
  });

  describe('convertFeat', () => {
    it('converts a feat with a category, edition, abilities and skills', () => {
      const result = done(
        convertFeat(
          parseXml(`<feat>
            <name>Origin: Keen Forager [2024]</name>
            <text>You know where to look.</text>
            <text>Repeatable. You can take this feat twice.</text>
            <text>Sharp Senses. Increase your Wisdom or Intelligence score by 1.</text>
            <proficiency>Survival, Nature, Herbalism Kit</proficiency>
          </feat>`),
          ctx,
        ),
      );
      expect(result.kind).toBe('feat');
      expect(result.name).toBe('Keen Forager');
      expect(result.edition).toBe('2024');
      expect(result.reasons).toEqual(['proficiency in Herbalism Kit is kept as text']);
      expect(result.entity).toEqual({
        name: 'Keen Forager',
        source: 'FCTest',
        edition: 'one',
        category: 'O',
        ability: [{ choose: { from: ['wis', 'int'] } }],
        skillProficiencies: [{ survival: true, nature: true }],
        repeatable: true,
        entries: [
          'You know where to look.',
          { type: 'entries', name: 'Repeatable', entries: ['You can take this feat twice.'] },
          {
            type: 'entries',
            name: 'Sharp Senses',
            entries: ['Increase your Wisdom or Intelligence score by 1.'],
          },
        ],
      });
    });

    it('prefers ability score modifiers to prose, and keeps other modifiers as text', () => {
      const result = done(
        convertFeat(
          parseXml(`<feat>
            <name>Iron Lungs</name>
            <prerequisite>Constitution 13 or higher</prerequisite>
            <modifier category="ability score">Constitution +1</modifier>
            <modifier category="ability score">Charisma score +1</modifier>
            <modifier category="bonus">initiative +5</modifier>
            <text>Increase your Strength score by 1.</text>
          </feat>`),
          ctx,
        ),
      );
      expect(result.edition).toBe('2014');
      expect(result.entity.edition).toBeUndefined();
      expect(result.entity.category).toBeUndefined();
      expect(result.entity.prerequisite).toEqual([{ ability: [{ con: 13 }] }]);
      expect(result.entity.ability).toEqual([{ con: 1, cha: 1 }]);
      expect(result.reasons).toEqual(['the modifier "initiative +5" is kept as text']);
    });

    it('reads the edition and the book from a Source line', () => {
      const result = done(
        convertFeat(
          parseXml(
            '<feat><name>Iron Lungs</name><text>Breathe deep.</text><text>Source: Homebrew Codex (2024)</text></feat>',
          ),
          ctx,
        ),
      );
      expect(result.edition).toBe('2024');
      expect(result.entity.source).toBe('FCHomebrewCodex2024');
      expect(result.placement.source.full).toBe('Homebrew Codex (2024)');
      expect(result.entity.entries).toEqual(['Breathe deep.']);
    });

    it('reads the proficiencies its tags and its sentences grant, tags first', () => {
      const result = done(
        convertFeat(
          parseXml(`<feat>
            <name>Drillmaster</name>
            <weapons>Longsword, Shortbow</weapons>
            <text>You gain the following benefits:</text>
            <text>• You gain proficiency with light armor.</text>
            <text>• You gain proficiency in the Athletics or Acrobatics skill (your choice).</text>
            <text>• You gain proficiency with cook's utensils if you don't already have it.</text>
            <text>• You gain proficiency with the battleaxe.</text>
            <text>• You gain proficiency with tinker's widgets.</text>
          </feat>`),
          ctx,
        ),
      );
      expect(result.entity.weaponProficiencies).toEqual([
        { 'longsword|phb': true, 'shortbow|phb': true },
      ]);
      expect(result.entity.armorProficiencies).toEqual([{ light: true }]);
      expect(result.entity.skillProficiencies).toEqual([
        { choose: { from: ['athletics', 'acrobatics'] } },
      ]);
      expect(result.entity.toolProficiencies).toEqual([{ "cook's utensils": true }]);
    });

    it('reads the choice in its text when a modifier holds one pick of it', () => {
      const result = done(
        convertFeat(
          parseXml(`<feat>
            <name>Keen Mind</name>
            <modifier category="ability score">Intelligence +1</modifier>
            <text>Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.</text>
          </feat>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toEqual([{ choose: { from: ['int', 'wis', 'cha'] } }]);
    });

    it('reads the defenses a feat states for good, and leaves a reaction to the text', () => {
      const result = done(
        convertFeat(
          parseXml(`<feat>
            <name>Frostblood</name>
            <text>Cold runs in your veins. You gain the following benefits:</text>
            <text>• You have resistance to cold and poison damage.</text>
            <text>• When you are hit, you can use your reaction to gain resistance to fire damage.</text>
          </feat>`),
          ctx,
        ),
      );
      expect(result.entity.resist).toEqual(['cold', 'poison']);
      expect(result.entity.immune).toBeUndefined();
    });

    it('is not repeatable for the word mid-sentence', () => {
      const result = done(
        convertFeat(
          parseXml('<feat><name>Iron Lungs</name><text>This is not Repeatable.</text></feat>'),
          ctx,
        ),
      );
      expect(result.entity.repeatable).toBeUndefined();
    });

    it('skips an entry with no name', () => {
      expect(convertFeat(parseXml('<feat><text>x</text></feat>'), ctx)).toEqual({
        skip: 'it has no name',
      });
    });
  });
});

describe('backgrounds', () => {
  describe('readSkills', () => {
    it('reads "A, B, or C" and "A or B" as one choice, and stops at a phrase', () => {
      expect(readSkills('Arcana, History, or Religion')).toEqual({
        entry: { choose: { from: ['arcana', 'history', 'religion'] } },
        rest: [],
      });
      expect(readSkills('Arcana or Religion')).toEqual({
        entry: { choose: { from: ['arcana', 'religion'] } },
        rest: [],
      });
      expect(readSkills('Nature, plus your choice of Arcana or Survival')).toEqual({
        entry: { nature: true },
        rest: ['plus your choice of Arcana or Survival'],
      });
    });
  });

  describe('backgroundAbility', () => {
    it('reads three abilities as both 2024 arrangements', () => {
      const from = ['int', 'wis', 'cha'];
      expect(backgroundAbility('Intelligence, Wisdom, Charisma')).toEqual([
        { choose: { weighted: { from, weights: [2, 1] } } },
        { choose: { weighted: { from, weights: [1, 1, 1] } } },
      ]);
      expect(backgroundAbility('Int, Wis, or Cha')).toEqual(
        backgroundAbility('Intelligence, Wisdom, Charisma'),
      );
    });

    it('gives up unless there are exactly three', () => {
      expect(backgroundAbility('Strength or Dexterity')).toBeUndefined();
      expect(backgroundAbility('Strength, Dexterity, Luck')).toBeUndefined();
    });
  });

  describe('featGrant', () => {
    it('names the installed feat, an option included', () => {
      expect(featGrant('Ember Adept (Cleric)', withOfficial, '2024', 'FCTest')).toEqual({
        key: 'ember adept; cleric|xphb',
      });
      expect(featGrant('Iron Lungs', withOfficial, '2014', 'FCTest')).toEqual({
        key: 'iron lungs|phb',
      });
      expect(featGrant('Iron Lungs [2024]', withOfficial, '2024', 'FCTest')).toEqual({
        key: 'iron lungs|xphb',
      });
    });

    it('guesses no book for a feat neither the file nor the game data has', () => {
      expect(featGrant('Iron Lungs', ctx, '2014', 'FCTest')).toEqual({
        reason:
          'its feat (Iron Lungs) is in neither this file nor the game data, so it is kept as text',
      });
    });

    it("points at the file's own feat, whole, when the file has that feat", () => {
      const withFeat = withFeats(['Ember Adept', 'FCTest']);
      expect(featGrant('Ember Adept (Cleric)', withFeat, '2024', 'FCTest')).toEqual({
        key: 'ember adept|fctest',
      });
      expect(featGrant('Ember Adept', withFeat, '2024', 'FCTest')).toEqual({
        key: 'ember adept|fctest',
      });
    });

    it('finds a feat the file names with its group, in the background book first', () => {
      const marks = withFeats(
        ['Dragonmark, Mark of Embers', 'FCOne'],
        ['Dragonmark: Mark of Embers', 'FCTwo'],
        ['Ash Walker (Dark Gift)', 'FCOne'],
      );
      expect(featGrant('Mark of Embers', marks, '2024', 'FCTwo')).toEqual({
        key: 'dragonmark: mark of embers|fctwo',
      });
      expect(featGrant('Mark of Embers', marks, '2024', 'FCThree')).toEqual({
        key: 'dragonmark, mark of embers|fcone',
      });
      expect(featGrant('Ash Walker', marks, '2024', 'FCThree')).toEqual({
        key: 'ash walker (dark gift)|fcone',
      });
    });

    it('prefers a feat under its own name to one under its group', () => {
      const both = withFeats(['Dragonmark, Mark of Embers', 'FCOne'], ['Mark of Embers', 'FCTwo']);
      expect(featGrant('Mark of Embers', both, '2024', 'FCOne')).toEqual({
        key: 'mark of embers|fctwo',
      });
    });

    it('prefers the file feat to the installed one', () => {
      const both = fc5Context('test.xml', {
        featSources: withFeats(['Iron Lungs', 'FCTest']).featSources,
        officialFeat: () => 'iron lungs|phb',
      });
      expect(featGrant('Iron Lungs', both, '2014', 'FCTest')).toEqual({ key: 'iron lungs|fctest' });
    });

    it('grants the named feat of an either-or, and leaves a choice out', () => {
      const file = withFeats(['Survivor', 'FCOne']);
      expect(
        featGrant('Survivor or a Dark Gift feat of your choice', file, '2024', 'FCOne'),
      ).toEqual({
        key: 'survivor|fcone',
        reason: 'the choice of a Dark Gift feat in its place is kept as text',
      });
      expect(featGrant('Choose one Planar Pact feat', file, '2024', 'FCOne')).toEqual({
        reason: 'its feat choice (Choose one Planar Pact feat) is kept as text',
      });
      expect(
        featGrant(
          'A Dark Gift feat of your choice (Mist Walker is recommended)',
          file,
          '2024',
          'FCOne',
        ),
      ).toEqual({
        reason:
          'its feat choice (A Dark Gift feat of your choice (Mist Walker is recommended)) is kept as text',
      });
    });
  });

  describe('convertBackground', () => {
    it('reads the 2024 rules out of the trait names', () => {
      const result = done(
        convertBackground(
          parseXml(`<background>
            <name>Lamplighter [2024]</name>
            ${trait('Description', 'You kept the lamps lit.')}
            ${trait('Ability Scores: Intelligence, Wisdom, Charisma', 'Pick from these.')}
            ${trait('Feat: Ember Adept (Cleric)', 'You gain this feat.')}
            ${trait('Skill Proficiencies: Insight and Perception', 'You notice things.')}
            ${trait('Tool Proficiency: Choose one kind of Gaming Set', 'You play cards.')}
            ${trait('Languages: Common and one extra language of your choice', 'You talk.')}
          </background>`),
          withOfficial,
        ),
      );
      const from = ['int', 'wis', 'cha'];
      expect(result.kind).toBe('background');
      expect(result.name).toBe('Lamplighter');
      expect(result.edition).toBe('2024');
      expect(result.reasons).toEqual([]);
      expect(result.entity).toEqual({
        name: 'Lamplighter',
        source: 'FCTest',
        edition: 'one',
        ability: [
          { choose: { weighted: { from, weights: [2, 1] } } },
          { choose: { weighted: { from, weights: [1, 1, 1] } } },
        ],
        feats: [{ 'ember adept; cleric|xphb': true }],
        skillProficiencies: [{ insight: true, perception: true }],
        toolProficiencies: [{ anyGamingSet: 1 }],
        languageProficiencies: [{ common: true, anyStandard: 1 }],
        entries: [
          'You kept the lamps lit.',
          {
            type: 'entries',
            name: 'Ability Scores: Intelligence, Wisdom, Charisma',
            entries: ['Pick from these.'],
          },
          { type: 'entries', name: 'Feat: Ember Adept (Cleric)', entries: ['You gain this feat.'] },
          {
            type: 'entries',
            name: 'Skill Proficiencies: Insight and Perception',
            entries: ['You notice things.'],
          },
          {
            type: 'entries',
            name: 'Tool Proficiency: Choose one kind of Gaming Set',
            entries: ['You play cards.'],
          },
          {
            type: 'entries',
            name: 'Languages: Common and one extra language of your choice',
            entries: ['You talk.'],
          },
        ],
      });
    });

    it('lets the proficiency element win over a skill trait', () => {
      const result = done(
        convertBackground(
          parseXml(`<background>
            <name>Lamplighter</name>
            <proficiency>Insight, Thieves' Cant</proficiency>
            ${trait('Skill Proficiencies: Stealth', 'Quiet.')}
          </background>`),
          ctx,
        ),
      );
      expect(result.entity.skillProficiencies).toEqual([{ insight: true }]);
      expect(result.reasons).toEqual(["proficiency in Thieves' Cant is kept as text"]);
    });

    it('points a 2014 feat grant at the 2014 book', () => {
      const result = done(
        convertBackground(
          parseXml(
            `<background><name>Lamplighter</name>${trait('Feat: Iron Lungs', 'x')}</background>`,
          ),
          withOfficial,
        ),
      );
      expect(result.entity.feats).toEqual([{ 'iron lungs|phb': true }]);
    });

    it('reports the trait values it cannot read', () => {
      const result = done(
        convertBackground(
          parseXml(`<background>
            <name>Lamplighter</name>
            ${trait('Ability Scores: Strength or Dexterity', 'x')}
            ${trait('Tool Proficiency: Any one tool', 'x')}
            ${trait('Languages: Choose Ignan or Aquan', 'x')}
          </background>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toBeUndefined();
      expect(result.entity.toolProficiencies).toBeUndefined();
      expect(result.entity.languageProficiencies).toBeUndefined();
      expect(result.reasons).toEqual([
        'its ability scores are kept as text',
        'its tool choice is kept as text',
        'its language choice is kept as text',
      ]);
    });

    it('puts loose text first, and files the background under its book', () => {
      const result = done(
        convertBackground(
          parseXml(`<background>
            <name>Lamplighter</name>
            ${trait('Lamp Lore', 'You know lamps.', 'Source: Homebrew Codex (2024)')}
            <text>An old trade.</text>
          </background>`),
          ctx,
        ),
      );
      expect(result.edition).toBe('2024');
      expect(result.entity.source).toBe('FCHomebrewCodex2024');
      expect(result.entity.entries).toEqual([
        'An old trade.',
        { type: 'entries', name: 'Lamp Lore', entries: ['You know lamps.'] },
      ]);
    });

    it("reads a guild's spell table, and leaves a granted feat's spells to the feat", () => {
      const result = done(
        convertBackground(
          parseXml(`<background>
            <name>Lamplighter</name>
            ${trait(
              'Lamp Guild Spells',
              'For you, the spells on the Lamp Guild Spells table are added to the spell list of your spellcasting class.',
              'Cantrip — light, message',
              '1st — faerie fire',
            )}
            ${trait('Feat: Iron Lungs', 'You learn the Light cantrip.')}
          </background>`),
          withOfficial,
        ),
      );
      expect(result.entity.additionalSpells).toEqual([
        { expanded: { s0: ['light', 'message'], s1: ['faerie fire'] } },
      ]);
      expect(result.reasons).toEqual([]);
    });

    it('skips an entry with no name', () => {
      expect(convertBackground(parseXml('<background/>'), ctx)).toEqual({
        skip: 'it has no name',
      });
    });
  });
});

describe('races', () => {
  describe('raceAbility', () => {
    it('reads short and long ability lists', () => {
      expect(raceAbility('Str 2, Con 1')).toEqual({ str: 2, con: 1 });
      expect(raceAbility('Strength +2, Dexterity -1')).toEqual({ str: 2, dex: -1 });
      expect(raceAbility('Str 1, Str 1')).toEqual({ str: 2 });
    });

    it('gives up on anything else', () => {
      expect(raceAbility('Str 2, Luck 1')).toBeUndefined();
      expect(raceAbility('one of your choice')).toBeUndefined();
    });
  });

  describe('convertRace', () => {
    it('converts a race with its fields and traits', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Emberkin</name>
            <size>m</size>
            <speed>30</speed>
            <ability>Str 2, Con 1</ability>
            <proficiency>Perception</proficiency>
            <resist>fire, cold</resist>
            <immune>poison</immune>
            <languages>Common, Ignan</languages>
            ${trait('Description', 'Emberkin carry a spark of the forge.')}
            ${trait('Darkvision', 'Your eyes pierce darkness out to 60 feet.')}
            ${trait('Forge Blood', 'You shrug off heat.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.kind).toBe('race');
      expect(result.edition).toBe('2014');
      expect(result.reasons).toEqual([]);
      expect(result.entity).toEqual({
        name: 'Emberkin',
        source: 'FCTest',
        size: ['M'],
        speed: 30,
        ability: [{ str: 2, con: 1 }],
        skillProficiencies: [{ perception: true }],
        darkvision: 60,
        resist: ['fire', 'cold'],
        immune: ['poison'],
        languageProficiencies: [{ common: true, ignan: true }],
        entries: [
          'Emberkin carry a spark of the forge.',
          {
            type: 'entries',
            name: 'Darkvision',
            entries: ['Your eyes pierce darkness out to 60 feet.'],
          },
          { type: 'entries', name: 'Forge Blood', entries: ['You shrug off heat.'] },
        ],
      });
    });

    it('reads superior darkvision in feet abbreviated', () => {
      const result = done(
        convertRace(
          parseXml(
            `<race><name>Deepkin</name>${trait('Superior Darkvision', 'You see out to 120 ft. in darkness.')}</race>`,
          ),
          ctx,
        ),
      );
      expect(result.entity.darkvision).toBe(120);
    });

    it('leaves out a size or speed it does not know', () => {
      const result = done(
        convertRace(
          parseXml('<race><name>Oddkin</name><size>X</size><speed>fast</speed></race>'),
          ctx,
        ),
      );
      expect(result.entity.size).toBeUndefined();
      expect(result.entity.speed).toBeUndefined();
    });

    it('reports what it keeps as text', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Oddkin</name>
            <ability>Str 2, Luck 1</ability>
            <proficiency>Light Armor</proficiency>
            <resist>nonmagical bludgeoning</resist>
            <languages>Common and a tongue of your choice</languages>
            <spellability>Charisma</spellability>
            <conditionImmune>charmed, asleep</conditionImmune>
            <modifier category="bonus">initiative +1</modifier>
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.conditionImmune).toEqual(['charmed']);
      expect(result.entity.ability).toBeUndefined();
      expect(result.entity.resist).toBeUndefined();
      expect(result.entity.languageProficiencies).toBeUndefined();
      expect(result.reasons).toEqual([
        'its ability scores "Str 2, Luck 1" are kept as text',
        'proficiency in Light Armor is kept as text',
        'its resist "nonmagical bludgeoning" is kept as text',
        'its languages are kept as text',
        'its spells are kept as text',
        'its condition immunity to asleep is kept as text',
        'its modifiers are kept as text',
      ]);
    });

    it('reads the weapon, armor, tool and speed tags', () => {
      const result = done(
        convertRace(
          parseXml(
            `<race>
            <name>Oddkin</name>
            <speed>30</speed>
            <speedOther>swim 30 ft., Fly 50 ft.</speedOther>
            <weapons>Battleaxe, Handaxe</weapons>
            <armor>Light Armor, Medium Armor</armor>
            <tools>Artisan's tools of your choice: smith's tools, or mason's tools</tools>
            <conditionImmune>poisoned, diseases</conditionImmune>
            ${trait('Hulking', 'You count as one size larger.')}
          </race>`.replace('</trait>', '<special>Powerful Build</special></trait>'),
          ),
          ctx,
        ),
      );
      expect(result.entity.speed).toEqual({ walk: 30, swim: 30, fly: 50 });
      expect(result.entity.weaponProficiencies).toEqual([
        { 'battleaxe|phb': true, 'handaxe|phb': true },
      ]);
      expect(result.entity.armorProficiencies).toEqual([{ light: true, medium: true }]);
      expect(result.entity.toolProficiencies).toEqual([
        { choose: { from: ["smith's tools", "mason's tools"] } },
      ]);
      expect(result.entity.conditionImmune).toEqual(['poisoned', 'disease']);
      expect(result.entity.traitTags).toEqual(['Powerful Build']);
      expect(result.reasons).toEqual([]);
    });

    it("reads a trait's rules where the book's own words state them", () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Oddkin</name>
            <speed>30</speed>
            <ability>Cha 2</ability>
            ${trait('Ability Score Increase', 'Your Charisma score increases by 2. Two different ability scores of your choice increase by 1.')}
            ${trait('Keen Senses', 'You have proficiency in the Perception skill.')}
            ${trait('Skill Versatility', 'You gain proficiency in two skills of your choice.')}
            ${trait('Weapon Training', 'You have proficiency with the longsword, shortsword, shortbow, and longbow.')}
            ${trait('Armor Training', 'You have proficiency with light and medium armor.')}
            ${trait('Swimmer', 'You have a swimming speed of 30 feet.')}
            ${trait('Climber', 'You have a climbing speed equal to your walking speed.')}
            ${trait('Languages', 'You can speak, read, and write Common and Elvish. Elvish is fluid.')}
            ${trait('Extra Language', 'You can speak, read, and write one extra language of your choice.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toEqual([
        { cha: 2, choose: { from: ['str', 'dex', 'con', 'int', 'wis'], count: 2 } },
      ]);
      expect(result.entity.skillProficiencies).toEqual([{ perception: true, any: 2 }]);
      expect(result.entity.weaponProficiencies).toEqual([
        {
          'longsword|phb': true,
          'shortsword|phb': true,
          'shortbow|phb': true,
          'longbow|phb': true,
        },
      ]);
      expect(result.entity.armorProficiencies).toEqual([{ light: true, medium: true }]);
      expect(result.entity.speed).toEqual({ walk: 30, swim: 30, climb: true });
      expect(result.entity.languageProficiencies).toEqual([
        { common: true, elvish: true, anyStandard: 1 },
      ]);
    });

    it('reads a weighted choice of scores and a skill from a list', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Oddkin</name>
            ${trait('Ability Score Increase', 'One ability score of your choice increases by 2, and two other ability scores of your choice increase by 1 each.')}
            ${trait('Keen Senses', 'You have proficiency in the Insight, Perception, or Survival skill.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toEqual([
        {
          choose: {
            weighted: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], weights: [2, 1, 1] },
          },
        },
      ]);
      expect(result.entity.skillProficiencies).toEqual([
        { choose: { from: ['insight', 'perception', 'survival'] } },
      ]);
    });

    it('leaves a trait it cannot read in full to the text', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Oddkin</name>
            <speed>30</speed>
            ${trait('Ability Score Increase', 'Your Strength score increases by 2. Increase one ability score of your choice by 1, to a maximum of 20.')}
            ${trait('Training', 'You have proficiency with improvised weapons and the Intimidation skill.')}
            ${trait('Wings', 'For 1 minute, you have a flying speed of 30 feet.')}
            ${trait('Languages', 'You can speak Common and one racial language.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toBeUndefined();
      expect(result.entity.weaponProficiencies).toBeUndefined();
      expect(result.entity.skillProficiencies).toBeUndefined();
      expect(result.entity.speed).toBe(30);
      expect(result.entity.languageProficiencies).toBeUndefined();
    });

    it('adds the defenses a trait states for good to the tags', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Ashkin</name>
            <resist>fire</resist>
            ${trait('Celestial Resistance', 'You have resistance to necrotic damage and radiant damage.')}
            ${trait('Undying', 'You walk between life and death. This is represented by the following:', '• You have resistance to poison damage.', '• You are immune to the frightened condition.')}
            ${trait('Adaptation', 'Choose an environment to gain its traits.', 'Arctic:', '• You gain resistance to cold damage.')}
            ${trait('Fury', 'While raging, you have resistance to thunder damage.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.resist).toEqual(['fire', 'necrotic', 'radiant', 'poison']);
      expect(result.entity.conditionImmune).toEqual(['frightened']);
      expect(result.entity.immune).toBeUndefined();
    });

    it('grants a skill the tag picks from a trait’s choice once, as the choice', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Ashkin</name>
            <proficiency>Insight</proficiency>
            ${trait('Keen Senses', 'You have proficiency in the Insight, Perception, or Survival skill.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.skillProficiencies).toEqual([
        { choose: { from: ['insight', 'perception', 'survival'] } },
      ]);
    });

    it('reads no armor or weapons as tools from a tool trait', () => {
      const result = done(
        convertRace(
          parseXml(`<race>
            <name>Ashkin</name>
            ${trait('Tool Training', 'You have proficiency with light armor and simple weapons.')}
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.toolProficiencies).toBeUndefined();
    });

    it('reads a speed in any sentence of a trait, and none a condition governs', () => {
      const speedOf = (...traits: string[]) =>
        done(
          convertRace(
            parseXml(`<race><name>Oddkin</name><speed>30</speed>${traits.join('')}</race>`),
            ctx,
          ),
        ).entity.speed;
      expect(
        speedOf(
          trait(
            'Speed',
            'Your walking speed is 30 feet, and you have a swimming speed equal to your walking speed.',
          ),
        ),
      ).toEqual({ walk: 30, swim: true });
      expect(
        speedOf(
          trait(
            'Speed',
            'Your base walking speed is 30 feet. You also have a swimming speed of 40 feet.',
          ),
          trait(
            'Flight',
            "Because of your wings, you have a flying speed equal to your walking speed. You can't use this flying speed if you're wearing medium or heavy armor.",
          ),
          trait(
            'Climber',
            'Your base walking speed is 30 feet. You also have a climbing speed of 30 feet as long as you are not encumbered or wearing heavy armor.',
          ),
        ),
      ).toEqual({ walk: 30, swim: 40, fly: true, climb: 30 });
      for (const text of [
        'While in your beast form, you have a climbing speed of 30 feet.',
        'You have a flying speed of 30 feet until the end of your turn.',
        'As a bonus action, you can sprout wings. You have a flying speed of 30 feet.',
        'You have a swimming speed of 30 feet, and you can breathe air and water only while submerged.',
        'You have a climbing speed of 30 feet while you are raging.',
        // A lead sentence on a level, a time or a place sets terms over the rest.
        'At 5th level, your wings grow strong enough to carry you. You have a flying speed of 30 feet.',
        'Underwater, your gills open. You have a swimming speed of 40 feet.',
        // A form or state named in the lead.
        'Because of your beast form, you have a climbing speed of 30 feet.',
        // An option, or a speed that passes, in a later sentence.
        'Your wings are leathery. You have a flying speed of 30 feet. You can choose this trait in place of Infernal Legacy.',
        "You have a flying speed of 30 feet if you're not wearing heavy armor. This replaces the Infernal Legacy trait.",
        'You have a flying speed equal to your walking speed. This benefit works only in short bursts.',
      ]) {
        expect(speedOf(trait('Shift', text)), text).toBe(30);
      }
      // A standing clause beside the speed, and a later sentence about something else.
      expect(
        speedOf(
          trait(
            'Child of the Sea',
            'You have a swimming speed of 30 feet, and you can breathe air and water.',
          ),
        ),
      ).toEqual({ walk: 30, swim: 30 });
      expect(
        speedOf(
          trait(
            "Cat's Claws",
            'Because of your claws, you have a climbing speed of 20 feet. In addition, your claws are natural weapons, which deal slashing damage instead of the bludgeoning damage normal for an unarmed strike.',
          ),
        ),
      ).toEqual({ walk: 30, climb: 20 });
    });

    it('reads a speed after a first sentence that grants a proficiency', () => {
      expect(
        traitRules(
          'Climber',
          'You have proficiency in the Athletics skill. You also have a climbing speed of 30 feet.',
        ),
      ).toMatchObject({ speed: { climb: 30 } });
    });

    it('reads the edition from a Source line in a trait', () => {
      const result = done(
        convertRace(
          parseXml(
            `<race><name>Emberkin</name><text>A loose line.</text>${trait('Description', 'Sparks.', 'Source: Homebrew Codex (2024)')}</race>`,
          ),
          ctx,
        ),
      );
      expect(result.edition).toBe('2024');
      expect(result.entity.edition).toBe('one');
      expect(result.entity.source).toBe('FCHomebrewCodex2024');
      expect(result.entity.entries).toEqual(['A loose line.', 'Sparks.']);
    });

    it('skips an entry with no name', () => {
      expect(convertRace(parseXml('<race><size>M</size></race>'), ctx)).toEqual({
        skip: 'it has no name',
      });
    });
  });
});
