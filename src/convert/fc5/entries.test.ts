import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import { backgroundAbility, convertBackground, featGrant, readTools } from './background';
import { fc5Context } from './compendium';
import type { Fc5Context, Fc5Result } from './context';
import { abilityFromProse, convertFeat, featCategory, readPrerequisite } from './feat';
import { convertRace, raceAbility } from './race';

const ctx: Fc5Context = fc5Context('test.xml');

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

    it('gives up when the text also offers a split increase', () => {
      expect(
        abilityFromProse(
          'Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1.',
        ),
      ).toBeUndefined();
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
    it('builds the grant key, an option included', () => {
      expect(featGrant('Ember Adept (Cleric)', ctx, '2024')).toBe('ember adept; cleric|xphb');
      expect(featGrant('Iron Lungs', ctx, '2014')).toBe('iron lungs|phb');
      expect(featGrant('Iron Lungs [2024]', ctx, '2024')).toBe('iron lungs|xphb');
    });

    it("points at the file's own feat, whole, when the file has that feat", () => {
      const withFeat = fc5Context('test.xml', {
        featSources: new Map([['ember adept', 'FCTest']]),
      });
      expect(featGrant('Ember Adept (Cleric)', withFeat, '2024')).toBe('ember adept|fctest');
      expect(featGrant('Ember Adept', withFeat, '2024')).toBe('ember adept|fctest');
    });
  });

  describe('readTools', () => {
    it('reads a choice of one kind of tool', () => {
      expect(readTools('Choose one kind of Gaming Set')).toEqual({ anyGamingSet: 1 });
      expect(readTools("One type of Artisan's Tools")).toEqual({ anyArtisansTool: 1 });
      expect(readTools('Choose one kind of Artisan’s Tools')).toEqual({ anyArtisansTool: 1 });
      expect(readTools('one kind of Musical Instrument')).toEqual({ anyMusicalInstrument: 1 });
    });

    it('reads named tools', () => {
      expect(readTools('Lantern Kit, Ember Tongs')).toEqual({
        'lantern kit': true,
        'ember tongs': true,
      });
    });

    it('gives up on any other choice', () => {
      expect(readTools('Any one tool')).toBeUndefined();
      expect(readTools('Choose a kit')).toBeUndefined();
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
          ctx,
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
          ctx,
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
            <conditionImmune>charmed</conditionImmune>
            <modifier category="bonus">initiative +1</modifier>
          </race>`),
          ctx,
        ),
      );
      expect(result.entity.ability).toBeUndefined();
      expect(result.entity.resist).toBeUndefined();
      expect(result.entity.languageProficiencies).toBeUndefined();
      expect(result.reasons).toEqual([
        'its ability scores "Str 2, Luck 1" are kept as text',
        'proficiency in Light Armor is kept as text',
        'its resist "nonmagical bludgeoning" is kept as text',
        'its languages are kept as text',
        'its innate spells are kept as text',
        'its condition immunities are kept as text',
        'its modifiers are kept as text',
      ]);
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
