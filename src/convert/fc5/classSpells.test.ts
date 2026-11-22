import { describe, expect, it } from 'vitest';
import { engineContextFor } from '../../data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '../../data5e/normalize';
import { STANDARD_SLOTS } from '../../engine/calc/slots';
import { deriveSheet } from '../../engine/derive';
import { newCharacterDoc } from '../../engine/types';
import type { ConvertOptions } from '../types';
import { parseXml } from '../xml';
import { giveNamedClassLists, namedClassList, readFeatureSpells } from './classSpells';
import { convertFc5Compendium } from './compendium';
import type { SpellIndex } from './spellGrants';
import { type Entry, readText } from './text';

/** The dash Fight Club writes between a level and its spells. */
const DASH = String.fromCharCode(0x2014);

const table = (head: string, rows: [string, string][], caption?: string): Entry => ({
  type: 'table',
  colLabels: [head, 'Spells'],
  rows,
  ...(caption !== undefined && { caption }),
});

const read = (level: number, entries: Entry[], tables = true, index?: SpellIndex) =>
  readFeatureSpells([{ level, entries }], { tables, ...(index !== undefined && { index }) });

describe('readFeatureSpells', () => {
  it("reads a 2014 domain's lines as prepared spells by cleric level", () => {
    const got = read(1, [
      'Life Domain Spells:',
      'At each indicated cleric level, you add the listed spells to your spells prepared.',
      `1st ${DASH} bless, cure wounds`,
      `3rd ${DASH} lesser restoration, spiritual weapon`,
    ]);
    expect(got).toEqual({
      blocks: [
        {
          prepared: {
            1: ['bless', 'cure wounds'],
            3: ['lesser restoration', 'spiritual weapon'],
          },
        },
      ],
      unread: false,
    });
  });

  it("reads a patron's expanded list by spell level, whatever its header says", () => {
    // The Undead in the community compendium heads spell levels `Warlock Level`.
    const got = read(1, [
      'The Undead lets you choose from an expanded list of spells when you learn a warlock spell. The following spells are added to the warlock spell list for you.',
      table('Warlock Level', [
        ['1st', 'bane, false life'],
        ['2nd', 'blindness/deafness, phantasmal force'],
        ['5th', 'antilife shell, cloudkill'],
      ]),
    ]);
    expect(got.blocks).toEqual([
      {
        expanded: {
          s1: ['bane', 'false life'],
          s2: ['blindness/deafness', 'phantasmal force'],
          s5: ['antilife shell', 'cloudkill'],
        },
      },
    ]);
  });

  it("reads a patron's expanded list by warlock level when its rows are odd levels past 5th", () => {
    const words =
      'The Ember Fool lets you choose from an expanded list of spells when you learn a warlock spell. The following spells are added to the warlock spell list for you.';
    const fool = read(1, [
      words,
      table('Warlock Level', [
        ['3', 'disguise self, rope trick, vicious mockery'],
        ['5', 'blink'],
        ['9', 'mislead'],
      ]),
    ]);
    expect(fool.blocks).toEqual([
      {
        expanded: {
          3: ['disguise self', 'rope trick', 'vicious mockery'],
          5: ['blink'],
          9: ['mislead'],
        },
      },
    ]);
    // A cantrip row stays a cantrip; a spell level table of 9th is by spell level.
    const goat = read(1, [
      words,
      `Cantrip ${DASH} light`,
      `1st ${DASH} bane`,
      `7th ${DASH} stoneskin`,
    ]);
    expect(goat.blocks).toEqual([{ expanded: { s0: ['light'], 1: ['bane'], 7: ['stoneskin'] } }]);
    const sphinx = read(1, [
      words,
      table('Spell Level', [
        ['1st', 'command'],
        ['3rd', 'slow'],
        ['9th', 'time stop'],
      ]),
    ]);
    expect(sphinx.blocks).toEqual([
      { expanded: { s1: ['command'], s3: ['slow'], s9: ['time stop'] } },
    ]);
    // Odd levels up to 5th are spell levels still.
    const low = read(1, [words, `1st ${DASH} bane`, `3rd ${DASH} slow`, `5th ${DASH} cloudkill`]);
    expect(low.blocks).toEqual([{ expanded: { s1: ['bane'], s3: ['slow'], s5: ['cloudkill'] } }]);
    // So are even ones past it, and none past 9th is a spell level.
    const study = read(1, [
      words,
      `2nd ${DASH} augury`,
      `6th ${DASH} contingency`,
      `9th ${DASH} weird`,
    ]);
    expect(study.blocks).toEqual([
      { expanded: { s2: ['augury'], s6: ['contingency'], s9: ['weird'] } },
    ]);
    const past = read(1, [
      words,
      table('Spell Level', [
        ['1st', 'bane'],
        ['11th', 'slow'],
      ]),
    ]);
    expect(past).toEqual({ unread: true });
  });

  it('reads a 2014 land as prepared by druid level, though it adds to the druid list', () => {
    const got = read(3, [
      "At each indicated level, add the listed spells to your druid spell list. These spells are always prepared and don't count against the number of spells you prepare each day.",
      `3rd ${DASH} hold person, spike growth`,
      `5th ${DASH} sleet storm, slow`,
    ]);
    expect(got.blocks).toEqual([
      { prepared: { 3: ['hold person', 'spike growth'], 5: ['sleet storm', 'slow'] } },
    ]);
  });

  it("reads a 2024 patron's table as prepared by warlock level", () => {
    const got = read(3, [
      'When you reach a Warlock level specified in the Fiend Spells table, you thereafter always have the listed spells prepared.',
      table(
        'Warlock Level',
        [
          ['3', 'Burning Hands, Command, Scorching Ray, Suggestion'],
          ['5', 'Fireball, Stinking Cloud'],
        ],
        'Fiend Spells',
      ),
    ]);
    expect(got.blocks).toEqual([
      {
        prepared: {
          3: ['burning hands', 'command', 'scorching ray', 'suggestion'],
          5: ['fireball', 'stinking cloud'],
        },
      },
    ]);
  });

  it("reads a ranger's or a sorcerer's table as learned, a cell's note left out", () => {
    const got = read(1, [
      'You learn additional spells when you reach certain levels in this class, as shown on the Psionic Spells table.',
      `1st ${DASH} arms of Hadar, dissonant whispers, mind sliver`,
      `7th ${DASH} Evard's black tentacles, summon aberration (a spell in chapter 3)`,
    ]);
    expect(got.blocks).toEqual([
      {
        known: {
          1: ['arms of hadar', 'dissonant whispers', 'mind sliver'],
          7: ["evard's black tentacles", 'summon aberration'],
        },
      },
    ]);
  });

  it('keeps a note that holds commas with its spell', () => {
    const got = read(1, [
      'The following spells are added to the warlock spell list for you.',
      table('Spell Level', [['3rd', 'conjure animals (bats, rats, or wolves only), gaseous form']]),
    ]);
    expect(got.blocks).toEqual([{ expanded: { s3: ['conjure animals', 'gaseous form'] } }]);
  });

  it("makes each captioned table one of a choice: the 2024 Circle of the Land's lands", () => {
    const got = read(3, [
      'Whenever you finish a Long Rest, choose one type of land. Consult the table below that corresponds to the chosen type; you have the spells listed for your Druid level and lower prepared.',
      table('Druid Level', [['3', 'Blur, Burning Hands, Fire Bolt']], 'Arid Land'),
      table('Druid Level', [['3', 'Fog Cloud, Hold Person, Ray of Frost']], 'Polar Land'),
    ]);
    expect(got.blocks).toEqual([
      { name: 'Arid Land', prepared: { 3: ['blur', 'burning hands', 'fire bolt'] } },
      { name: 'Polar Land', prepared: { 3: ['fog cloud', 'hold person', 'ray of frost'] } },
    ]);
  });

  it("reads a domain's table told only by its caption", () => {
    const got = read(1, [
      'The mind is a deep place.',
      table('Level', [['1st', 'dissonant whispers']], 'Mental Domain Spells'),
    ]);
    expect(got.blocks).toEqual([{ prepared: { 1: ['dissonant whispers'] } }]);
  });

  it('keeps as text a table it cannot place, and says so', () => {
    // A Strixhaven mage learns by spell level as the class rises.
    const byLevel = read(3, [
      'You learn additional spells when you reach certain levels in this class, as shown on the Lorehold Spells table.',
      table('Spell Level', [['1st', 'comprehend languages, identify']]),
    ]);
    expect(byLevel).toEqual({ unread: true });
    // A pick of two in a cell.
    const pick = read(3, [
      'You gain oath spells at the paladin levels listed.',
      table('Paladin Level', [['3rd', 'sanctuary or deathwatch']]),
    ]);
    expect(pick).toEqual({ unread: true });
  });

  it('keeps create or destroy water whole, a spell named with or', () => {
    const got = read(3, [
      'You gain oath spells at the paladin levels listed.',
      `3rd ${DASH} create or destroy water, expeditious retreat`,
    ]);
    expect(got.blocks).toEqual([
      { prepared: { 3: ['create or destroy water', 'expeditious retreat'] } },
    ]);
  });

  it('reads letters of any script', () => {
    const got = read(1, [
      'You gain domain spells at the cleric levels listed.',
      table('Cleric Level', [['9th', "Bakuryō's blessèd blizzard*, Magatsuchi's lantern*"]]),
    ]);
    expect(got.blocks).toEqual([
      { prepared: { 9: ["bakuryō's blessèd blizzard", "magatsuchi's lantern"] } },
    ]);
  });

  it("passes over a spellcasting table's counts and a table that names no spell", () => {
    const counts = read(1, [
      'You know three cantrips of your choice.',
      { type: 'table', colLabels: ['Level', 'Spells Known'], rows: [['1', '4']] },
    ]);
    expect(counts).toEqual({ unread: false });
    // A Channel Divinity's challenge ratings by level, told no spell word.
    const index: SpellIndex = { level: (n) => (n === 'bless' ? 1 : undefined) };
    const ratings = read(
      2,
      ['Starting at 2nd level, you can use your Channel Divinity.', `5th ${DASH} 1/2 or lower`],
      true,
      index,
    );
    expect(ratings).toEqual({ unread: false });
  });

  it('reads a spell a feature says is always prepared, at its level', () => {
    expect(read(1, ["You always have the Hunter's Mark spell prepared."], false).blocks).toEqual([
      { prepared: { 1: ["hunter's mark"] } },
    ]);
    expect(
      read(
        20,
        ['You therefore always have the Power Word Heal and Power Word Kill spells prepared.'],
        false,
      ).blocks,
    ).toEqual([{ prepared: { 20: ['power word heal', 'power word kill'] } }]);
    expect(
      read(2, [{ type: 'list', items: ['You have the guiding bolt spell prepared.'] }], false)
        .blocks,
    ).toEqual([{ prepared: { 2: ['guiding bolt'] } }]);
  });

  it('reads no spell from a sentence about having one', () => {
    expect(read(1, ['If you have the hex spell prepared, you can cast it.'], false)).toEqual({
      unread: false,
    });
    expect(read(1, ['You always have the listed spells prepared.'], false)).toEqual({
      unread: false,
    });
  });

  it('reads a cantrip a feature teaches, not a pick of two or a word before the name', () => {
    expect(read(1, ["You gain the light cantrip if you don't already know it."]).blocks).toEqual([
      { known: { 1: ['light#c'] } },
    ]);
    expect(read(1, ['You learn the sacred flame and light cantrips.']).blocks).toEqual([
      { known: { 1: ['sacred flame#c', 'light#c'] } },
    ]);
    expect(read(3, ['You learn the druidcraft or thaumaturgy cantrip.'])).toEqual({
      unread: false,
    });
    expect(read(1, ['You also know the special cantrip elemental surge.'])).toEqual({
      unread: false,
    });
  });

  it('keeps one of a cantrip a sentence and a table both name', () => {
    const got = read(3, [
      "At 3rd level, you learn the mage hand cantrip if you don't already know it.",
      'You also learn an additional spell of 1st level or higher when you reach certain levels in this class, as shown in the Swarmkeeper Spells table.',
      `3rd ${DASH} faerie fire, mage hand`,
    ]);
    expect(got.blocks).toEqual([{ known: { 3: ['mage hand#c', 'faerie fire'] } }]);
  });

  it('keeps as text a choice missing a table, so no branch of it always applies', () => {
    const got = read(3, [
      'You always have the spells listed prepared.',
      table('Druid Level', [['3', 'blur']], 'Arid Land'),
      table('Druid Level', [['3', 'fog cloud or sleet storm']], 'Polar Land'),
    ]);
    expect(got).toEqual({ unread: true });
  });

  it("keeps as text a second feature's choice, which would join the first as one pick", () => {
    const lands = (level: number, a: string, b: string) => ({
      level,
      entries: [
        'You have the spells listed prepared.',
        table('Druid Level', [[String(level), a]], `${a} Land`),
        table('Druid Level', [[String(level), b]], `${b} Land`),
      ],
    });
    const got = readFeatureSpells([lands(3, 'blur', 'bane'), lands(6, 'haste', 'slow')], {
      tables: true,
    });
    expect(got).toEqual({
      blocks: [
        { name: 'blur Land', prepared: { 3: ['blur'] } },
        { name: 'bane Land', prepared: { 3: ['bane'] } },
      ],
      unread: true,
    });
  });

  describe('a table with a column for each pick', () => {
    const columns = (labels: string[], rows: string[][], caption?: string): Entry => ({
      type: 'table',
      colLabels: labels,
      rows,
      ...(caption !== undefined && { caption }),
    });
    const known = new Set([
      'goodberry',
      'entangle',
      'inflict wounds',
      'plant growth',
      'blight',
      'chromatic orb',
      'feather fall',
      'shield',
      'color spray',
      'ray of sickness',
    ]);
    const index: SpellIndex = { level: (n) => (known.has(n) ? 1 : undefined) };
    const seasons = columns(
      ['Cleric Level', 'Sowing', 'Growing', 'Reaping'],
      [
        ['1st', 'Goodberry', 'Entangle', 'Inflict Wounds'],
        ['5th', 'Harvest Moonglow', 'Plant Growth', 'Culling Sickle'],
      ],
      'Harvest Domain Spells',
    );

    it("makes each column one of a choice, as the words before it pick one: a harvest's seasons", () => {
      const got = read(
        1,
        [
          'Whenever you finish a short or long rest, choose an aspect of the harvest cycle: Sowing, Growing, or Reaping. You gain domain spells listed in the table for your cycle.',
          seasons,
        ],
        true,
        index,
      );
      expect(got).toEqual({
        blocks: [
          { name: 'Sowing', prepared: { 1: ['goodberry'], 5: ['harvest moonglow'] } },
          { name: 'Growing', prepared: { 1: ['entangle'], 5: ['plant growth'] } },
          { name: 'Reaping', prepared: { 1: ['inflict wounds'], 5: ['culling sickle'] } },
        ],
        unread: false,
      });
    });

    it("gives every pick the first column when the words say so, a column's spells word left off its name", () => {
      const got = read(
        3,
        [
          'When you reach a Warlock level specified in the table, you thereafter always have the listed primordial spells prepared, along with the spells corresponding to your chosen element.',
          columns(
            ['Warlock Level', 'Primordial Spells', 'Air Spells', 'Earth Spells'],
            [
              ['3', 'Chromatic Orb', 'Feather Fall', 'Entangle'],
              ['7', 'Summon Elemental (the spirit matches your element)', '', 'Blight'],
            ],
          ),
        ],
        true,
        index,
      );
      expect(got).toEqual({
        blocks: [
          { prepared: { 3: ['chromatic orb'], 7: ['summon elemental'] } },
          { name: 'Air', prepared: { 3: ['feather fall'] } },
          { name: 'Earth', prepared: { 3: ['entangle'], 7: ['blight'] } },
        ],
        unread: false,
      });
    });

    it("joins a feature's tables of columns as one choice, and keeps as text two columns of one name", () => {
      const words =
        'When you finish a long rest, you can attune to your environment and gain the corresponding spells. You always have them prepared.';
      const lands = (a: string, b: string) =>
        columns(['Level', a, b], [['2nd', 'entangle', 'goodberry']], 'Localized Spells');
      const got = read(2, [words, lands('Arctic', 'Cave'), lands('Forest', 'Swamp')], true, index);
      expect(got.blocks?.map((b) => b.name)).toEqual(['Arctic', 'Cave', 'Forest', 'Swamp']);
      expect(got.unread).toBe(false);
      const twice = read(2, [words, lands('Arctic', 'Cave'), lands('Cave', 'Swamp')], true, index);
      expect(twice).toEqual({ unread: true });
    });

    it('keeps as text a table of columns the words before it pick none of: a lunar sorcerer learns them all', () => {
      const got = read(
        1,
        [
          'You learn additional spells when you reach certain levels in this class, as shown on the Lunar Spells table.',
          columns(
            ['Sorcerer Level', 'Full Moon Spells', 'New Moon Spells', 'Crescent Moon Spells'],
            [['1st', 'shield', 'ray of sickness', 'color spray']],
          ),
          'Whenever you finish a long rest, you can choose what lunar phase manifests its power through your magic.',
        ],
        true,
        index,
      );
      expect(got).toEqual({ unread: true });
    });

    it('keeps as text a column that names no spell the data has, or a pick in a cell', () => {
      const words = 'Choose an aspect. You gain domain spells listed in the table for your aspect.';
      const unknown = read(
        1,
        [
          words,
          columns(
            ['Cleric Level', 'Sowing', 'Growing'],
            [['1st', 'goodberry', 'harvest moonglow']],
          ),
        ],
        true,
        index,
      );
      expect(unknown).toEqual({ unread: true });
      const pick = read(
        1,
        [
          words,
          columns(
            ['Cleric Level', 'Sowing', 'Growing'],
            [['1st', 'goodberry', 'entangle or bane']],
          ),
        ],
        true,
        index,
      );
      expect(pick).toEqual({ unread: true });
    });

    it("keeps as text a second choice after a feature's columns", () => {
      const words = 'Choose an aspect. You gain domain spells listed in the table for your aspect.';
      const got = read(
        1,
        [
          words,
          seasons,
          table('Cleric Level', [['3', 'blight']], 'Arid Land'),
          table('Cleric Level', [['3', 'shield']], 'Polar Land'),
        ],
        true,
        index,
      );
      expect(got.blocks?.map((b) => b.name)).toEqual(['Sowing', 'Growing', 'Reaping']);
      expect(got.unread).toBe(true);
    });

    it("keeps as text a feature's columns after an earlier feature's choice", () => {
      const lands = {
        level: 1,
        entries: [
          'You have the spells listed prepared.',
          table('Cleric Level', [['1', 'blight']], 'Arid Land'),
          table('Cleric Level', [['1', 'shield']], 'Polar Land'),
        ],
      };
      const harvest = {
        level: 1,
        entries: [
          'Choose an aspect. You gain domain spells listed in the table for your aspect.',
          seasons,
        ],
      };
      const got = readFeatureSpells([lands, harvest], { tables: true, index });
      expect(got.blocks?.map((b) => b.name)).toEqual(['Arid Land', 'Polar Land']);
      expect(got.unread).toBe(true);
    });

    it('makes the first column a pick when the words give it to every pick only after the table', () => {
      const got = read(
        3,
        [
          'You always have the listed spells prepared for your chosen element.',
          columns(
            ['Warlock Level', 'Air Spells', 'Earth Spells'],
            [['3', 'feather fall', 'entangle']],
          ),
          'Along with the spells of your element, you gain a gift.',
        ],
        true,
        index,
      );
      expect(got.blocks?.map((b) => b.name)).toEqual(['Air', 'Earth']);
    });

    it('keeps as text a pick of one beside the column every pick has', () => {
      const got = read(
        3,
        [
          'You always have the listed spells prepared, along with the spells corresponding to your chosen element.',
          columns(
            ['Warlock Level', 'Primordial Spells', 'Air Spells'],
            [['3', 'chromatic orb', 'feather fall']],
          ),
        ],
        true,
        index,
      );
      expect(got).toEqual({ unread: true });
    });

    it('says a table of columns told no section is left as text when it names a spell the data has', () => {
      const got = read(
        1,
        [
          'The harvest turns.',
          columns(['Cleric Level', 'Sowing', 'Growing'], [['1st', 'harvest moonglow', 'entangle']]),
        ],
        true,
        index,
      );
      expect(got).toEqual({ unread: true });
    });

    it("passes over a caster's table of counts in columns, and a table of more than eight columns", () => {
      const counts = read(
        3,
        [
          'You learn two spells of your choice. Choose them from the wizard spell list.',
          columns(['Fighter Level', 'Cantrips Known', 'Spells Known'], [['3rd', '2', '3']]),
        ],
        true,
        index,
      );
      expect(counts).toEqual({ unread: false });
      const nine = Array.from({ length: 9 }, (_, i) => `Aspect ${i + 1}`);
      const wide = read(
        1,
        [
          'Choose an aspect. You gain domain spells listed in the table for your aspect.',
          columns(['Cleric Level', ...nine], [['1st', ...nine.map(() => 'goodberry')]]),
        ],
        true,
        index,
      );
      expect(wide).toEqual({ unread: false });
    });

    it('adds the first column of every table of columns to the one every pick has', () => {
      const words =
        'You always have the listed spells prepared, along with the spells corresponding to your chosen element.';
      const elements = (a: string, b: string, level: string, spells: string[]) =>
        columns(
          ['Warlock Level', 'Primordial Spells', `${a} Spells`, `${b} Spells`],
          [[level, ...spells]],
        );
      const got = read(
        3,
        [
          words,
          elements('Air', 'Earth', '3', ['chromatic orb', 'feather fall', 'entangle']),
          elements('Fire', 'Water', '5', ['blight', 'shield', 'goodberry']),
        ],
        true,
        index,
      );
      expect(got.blocks?.[0]).toEqual({ prepared: { 3: ['chromatic orb'], 5: ['blight'] } });
      expect(got.blocks?.slice(1).map((b) => b.name)).toEqual(['Air', 'Earth', 'Fire', 'Water']);
    });

    it("opens every column of a patron's table at the same levels, one blank past 5th or not", () => {
      const got = read(
        1,
        [
          'The following spells are added to the warlock spell list for you, along with the spells associated with your chosen affinity.',
          columns(
            ['Warlock Level', 'Fool Spells', 'Air Spells', 'Earth Spells'],
            [
              ['3', 'goodberry', 'feather fall', 'entangle'],
              ['5', 'blight', 'shield', 'plant growth'],
              ['7', 'color spray', '', 'inflict wounds'],
              ['8th', '-', '-', '-'],
            ],
          ),
        ],
        true,
        index,
      );
      expect(got.blocks).toEqual([
        { expanded: { 3: ['goodberry'], 5: ['blight'], 7: ['color spray'] } },
        { name: 'Air', expanded: { 3: ['feather fall'], 5: ['shield'] } },
        {
          name: 'Earth',
          expanded: { 3: ['entangle'], 5: ['plant growth'], 7: ['inflict wounds'] },
        },
      ]);
    });

    it('passes over a table of columns of names that are not spells, but not one its headers say holds spells', () => {
      const beasts = read(
        3,
        [
          'You always have the shield spell prepared. Choose a beast.',
          columns(['Druid Level', 'Beast', 'Terrain'], [['3rd', 'Wolf', 'Forest']]),
        ],
        true,
        index,
      );
      expect(beasts).toEqual({ blocks: [{ prepared: { 3: ['shield'] } }], unread: false });
      const unknown = read(
        1,
        [
          'The moon turns.',
          columns(
            ['Sorcerer Level', 'Fire Spells', 'Ice Spells'],
            [['1st', 'Ember Lash', 'Frost Lash']],
          ),
        ],
        true,
        index,
      );
      expect(unknown).toEqual({ unread: true });
    });

    it("reads no table of columns that holds more than spells' names: a companion's challenge ratings", () => {
      const got = read(
        3,
        [
          'You choose a companion. You gain domain spells listed in the table.',
          columns(['Level', 'Max. CR', 'Limitations'], [['3rd', '1/4', 'No flying speed']]),
        ],
        true,
        index,
      );
      expect(got).toEqual({ unread: false });
    });
  });

  it('reads no spell from words that only look like a name', () => {
    for (const text of [
      'You gain the ability to cast the light cantrip.',
      'You always have the domain spells prepared.',
      'Even when you have no spells prepared, you can cast it.',
      'You always have both spells prepared.',
      'You can cast it without a slot if you have the hex spell prepared.',
      'As long as you have the hex spell prepared, you can cast it.',
    ]) {
      expect(read(1, [text], false), text).toEqual({ unread: false });
    }
  });

  it("passes over a caster's own table of slots", () => {
    const got = read(3, [
      'You gain the ability to cast spells.',
      {
        type: 'table',
        colLabels: ['Warlock Level', 'Spell Slots', 'Slot Level'],
        rows: [['3rd', '2', '2nd']],
      },
    ]);
    expect(got).toEqual({ unread: false });
  });

  it('reads a cantrip row the text reader took for a lead-in', () => {
    const { entries } = readText([
      `The following spells are added to the warlock spell list for you.\nCantrip: light\n1st ${DASH} bless`,
    ]);
    expect(read(1, entries).blocks).toEqual([{ expanded: { s0: ['light'], s1: ['bless'] } }]);
    // A cantrip row in a table by class level has no class level to go at,
    // so the table stays as text.
    const domain = readText([`You gain domain spells.\nCantrip: light\n1st ${DASH} bless`]).entries;
    expect(read(1, domain)).toEqual({ unread: true });
    // A lead-in of prose stays prose, and its sentence is read.
    const prose = readText([
      `Cantrips: You learn the light cantrip.\nYou gain oath spells.\n3rd ${DASH} bless`,
    ]).entries;
    expect(read(3, prose)).toEqual({
      blocks: [{ known: { 3: ['light#c'] }, prepared: { 3: ['bless'] } }],
      unread: false,
    });
  });

  it('reads a table after long prose', () => {
    const got = read(1, [`You gain oath spells. ${'Lore. '.repeat(1500)}`, `3rd ${DASH} bless`]);
    expect(got.blocks).toEqual([{ prepared: { 3: ['bless'] } }]);
  });

  it('reads a cell of a long run of spaces in linear time', () => {
    // The text reader collapses spaces, but the reader takes any entries.
    const got = read(1, [
      'You gain oath spells.',
      table('Paladin Level', [['3rd', `${' '.repeat(400_000)}(x`]]),
    ]);
    expect(got).toEqual({ unread: true });
  });

  it("reads no table of a class's own", () => {
    const got = read(
      1,
      ['You gain domain spells at the cleric levels listed.', `1st ${DASH} bless, cure wounds`],
      false,
    );
    expect(got).toEqual({ unread: false });
  });
  describe('names checked against the index', () => {
    const levels: Record<string, number> = {
      'fire bolt': 0,
      light: 0,
      'feather fall': 1,
      bless: 1,
    };
    const known = (vouches: boolean): SpellIndex => ({
      level: (n) => (Object.hasOwn(levels, n) ? levels[n] : undefined),
      vouches: () => vouches,
    });

    it("grants a feature's cantrip as the index has it, and none it vouches is no spell", () => {
      const got = read(1, ['You learn the firebolt and zorblax cantrips.'], true, known(true));
      expect(got).toEqual({ blocks: [{ known: { 1: ['fire bolt#c'] } }], unread: true });
    });

    it('keeps a name the index lacks when it cannot vouch', () => {
      const got = read(1, ['You learn the zorblax cantrip.'], true, known(false));
      expect(got).toEqual({ blocks: [{ known: { 1: ['zorblax#c'] } }], unread: false });
    });

    it('drops a vouched-out name from spells always prepared', () => {
      const got = read(
        1,
        ['You always have the bless and zorblax spells prepared.'],
        true,
        known(true),
      );
      expect(got.unread).toBe(true);
      expect(JSON.stringify(got.blocks)).not.toContain('zorblax');
      expect(JSON.stringify(got.blocks)).toContain('bless');
    });

    it("resolves a table's names and keeps the ones the index lacks", () => {
      const got = read(
        1,
        [
          'At each indicated cleric level, you add the listed spells to your spells prepared.',
          `1st ${DASH} featherfall, zorblax`,
        ],
        true,
        known(true),
      );
      expect(got).toEqual({
        blocks: [{ prepared: { 1: ['feather fall', 'zorblax'] } }],
        unread: false,
      });
    });
  });
});

describe('subclass spells on the sheet', () => {
  /** A full caster with one subclass, these features at its first level, as a sheet at `levels`. */
  const sheetOf = (
    subclassFeatures: string,
    levels: number,
    choices: Record<string, string[]> = {},
    spells = '',
  ) => {
    const opt = ' optional="YES"';
    const f = (name: string, text: string, attrs = opt) =>
      `<feature${attrs}><name>${name}</name><text>${text}</text></feature>`;
    const rows = STANDARD_SLOTS.map(
      (row, i) =>
        `<autolevel level="${i + 1}"><slots>${[3, ...row].join(',')}</slots>${
          i === 0
            ? `${f('Otherworldly Patron', 'Choose a patron.', '')}${f('Otherworldly Patron: The Ember Fool', 'A patron.')}${subclassFeatures}`
            : ''
        }</autolevel>`,
    ).join('');
    const xml = `<compendium>${spells}<class><name>Ember Caller</name><hd>8</hd><spellAbility>Charisma</spellAbility>${rows}</class></compendium>`;
    const { json } = convertFc5Compendium(parseXml(xml), { fileName: 'Ember Homebrew.xml' });
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const [cls] = (json.class ?? []) as Record<string, unknown>[];
    const [sub] = (json.subclass ?? []) as Record<string, unknown>[];
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.classes = [
      {
        ref: { name: String(cls?.name), source: String(cls?.source) },
        subclass: { name: String(sub?.name), source: String(sub?.source) },
        levels,
        hp: Array<'avg'>(levels).fill('avg'),
      },
    ];
    doc.choices = choices;
    return deriveSheet(doc, engineContextFor(reg));
  };
  const expandedAt = (
    features: string,
    levels: number,
    choices?: Record<string, string[]>,
    spells?: string,
  ) =>
    sheetOf(features, levels, choices, spells)
      .spellcasting.flatMap((b) => b.expanded ?? [])
      .flatMap((x) => x.spells);

  it("opens a patron's spells at the warlock levels its table lists", () => {
    const table =
      '<feature optional="YES"><name>Expanded Spell List (The Ember Fool)</name><text>The Ember Fool lets you choose from an expanded list of spells when you learn a warlock spell. The following spells are added to the warlock spell list for you.</text><text>Fool Spells:</text><text>Warlock Level | Spells</text><text>3rd | disguise self, rope trick</text><text>5th | blink</text><text>9th | mislead</text></feature>';
    expect(expandedAt(table, 3)).toEqual(['disguise self', 'rope trick']);
    expect(expandedAt(table, 5)).toEqual(['disguise self', 'rope trick', 'blink']);
  });

  it("offers a patron's expanded list of the element picked, beside the one every element has", () => {
    const spell = (name: string) =>
      `<spell><name>${name}</name><level>1</level><school>EV</school><classes>Wizard</classes><text>A spell.</text></spell>`;
    const spells = ['Speak with Animals', 'Thunderwave', 'Longstrider'].map(spell).join('');
    const feature =
      '<feature optional="YES"><name>Expanded Spell List (The Ember Fool)</name><text>The Ember Fool lets you choose from an expanded list of spells when you learn a warlock spell. The table shows the spells that are added to the warlock spell list for you, along with the spells associated with the affinity of your patron: air or earth.</text><text>Spell Level | Fool Spells | Air Spells | Earth Spells</text><text>1st | speak with animals | thunderwave | longstrider</text><text>2nd | mark prey | gust of wind | pass without trace</text></feature>';
    const open = sheetOf(feature, 3, {}, spells);
    const pick = open.pending.find((p) => p.id.endsWith(':branch'));
    expect(pick?.options.map((o) => o.label)).toEqual(['Air', 'Earth']);
    expect(expandedAt(feature, 3, { [String(pick?.id)]: ['air'] }, spells)).toEqual([
      'speak with animals',
      'mark prey',
      'thunderwave',
      'gust of wind',
    ]);
  });
});

describe('a subclass caster with no list of its own', () => {
  const opt = ' optional="YES"';
  const f = (name: string, text: string, attrs = opt) =>
    `<feature${attrs}><name>${name}</name><text>${text}</text></feature>`;
  /** A class whose subclasses cast by its optional slot rows, with these spells beside it. */
  const convert = (
    spells = '',
    spellcasting = 'You learn two cantrips of your choice from the wizard spell list.',
    opts: Partial<ConvertOptions> = {},
  ) => {
    const rows = Array.from(
      { length: 20 },
      (_, i) =>
        `<autolevel level="${i + 1}"><slots optional="YES">2,${i < 2 ? '0,0' : i < 6 ? '2,0' : '4,2'}</slots>${
          i === 2
            ? `${f('Ember Path', 'Choose a path.', '')}${f('Ember Path: Ash Mage', 'x')}${f('Spellcasting (Ash Mage)', spellcasting)}`
            : ''
        }</autolevel>`,
    ).join('');
    const xml = `<compendium>${spells}<class><name>Ember Knight</name><hd>10</hd><spellAbility>Intelligence</spellAbility>${rows}</class></compendium>`;
    return convertFc5Compendium(parseXml(xml), { fileName: 'Ember Homebrew.xml', ...opts }).json;
  };
  const subOf = (json: Record<string, unknown>) =>
    ((json.subclass ?? []) as Record<string, unknown>[])[0];

  it('casts from the class list its features name, on the sheet', () => {
    const json = convert();
    expect(subOf(json)?.additionalSpells).toEqual([{ expanded: { _: [{ all: 'class=Wizard' }] } }]);
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const cls = ((json.class ?? []) as Record<string, unknown>[])[0];
    const sub = subOf(json);
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.classes = [
      {
        ref: { name: String(cls?.name), source: String(cls?.source) },
        subclass: { name: String(sub?.name), source: String(sub?.source) },
        levels: 3,
        hp: ['avg', 'avg', 'avg'],
      },
    ];
    const blocks = deriveSheet(doc, engineContextFor(reg)).spellcasting;
    expect(blocks.flatMap((b) => b.expanded ?? []).flatMap((x) => x.filters)).toEqual([
      'class=Wizard',
    ]);
  });

  it("names the file's own class as the file names it, and adds the list to the spells it has", () => {
    const own = convert(
      '',
      'You learn spells from the ember knight spell list. You always have the shield spell prepared.',
    );
    expect(subOf(own)?.additionalSpells).toEqual([
      { prepared: { 3: ['shield'] }, expanded: { _: [{ all: 'class=Ember Knight' }] } },
    ]);
  });

  it('takes no class list when it has one of its own, or its features name two', () => {
    const own =
      '<spell><name>Ember Bolt</name><level>1</level><school>EV</school><classes>Ember Knight (Ash Mage)</classes><text>A bolt.</text></spell>';
    expect(subOf(convert(own))?.additionalSpells).toBeUndefined();
    expect(
      subOf(
        convert(
          '',
          'You learn cantrips from the wizard spell list and spells from the cleric spell list.',
        ),
      )?.additionalSpells,
    ).toBeUndefined();
    // An installed spell the file puts on it is a list of its own too.
    const installed = convert(
      '<spell><name>Shield</name><level>1</level><school>A</school><classes>Ember Knight (Ash Mage)</classes><text>A ward.</text></spell>',
      undefined,
      {
        isInstalled: (kind, name) => kind === 'spell' && name === 'Shield',
        installedSpellId: (name) => (name === 'Shield' ? 'shield|phb' : undefined),
      },
    );
    expect(subOf(installed)?.subclassSpells).toEqual(['shield|phb']);
    expect(subOf(installed)?.additionalSpells).toBeUndefined();
    // A list that is no class's names none.
    expect(
      subOf(convert('', 'You learn spells from the ember spell list.'))?.additionalSpells,
    ).toBeUndefined();
  });
});

describe('namedClassList', () => {
  const classes: Record<string, string> = {
    'ember knight': 'Ember Knight',
    knight: 'Knight',
    wizard: 'Wizard',
  };
  const named = (name: string) => (Object.hasOwn(classes, name) ? classes[name] : undefined);

  it('takes the longest class name before the words, and one class only', () => {
    expect(namedClassList(['Spells of the Ember Knight spell list.'], named)).toBe('Ember Knight');
    expect(namedClassList(['The spells of the wizard spell list.'], named)).toBe('Wizard');
    expect(
      namedClassList(['The wizard spell list.', 'The knight spell list.'], named),
    ).toBeUndefined();
    expect(namedClassList(['Your expanded spell list.'], named)).toBeUndefined();
  });

  it('takes no class from a list of several', () => {
    for (const text of [
      'You learn spells from the wizard or ember knight spell list.',
      'You learn spells from the ember knight and wizard spell list.',
      'Choose from the cleric, wizard spell list.',
    ])
      expect(namedClassList([text], named)).toBeUndefined();
  });
});

describe('giveNamedClassLists', () => {
  const out = (sub: Record<string, unknown>) => ({
    spell: [],
    subclass: [
      { name: 'Ash Mage', shortName: 'Ash Mage', source: 'X', className: 'Ember Knight', ...sub },
    ] as Record<string, unknown>[],
    subclassFeature: [
      {
        className: 'Ember Knight',
        subclassShortName: 'Ash Mage',
        subclassSource: 'X',
        entries: ['You learn spells from the Wizard spell list.'],
      },
    ],
  });
  const named = (name: string) => (name === 'wizard' ? 'Wizard' : undefined);

  it('keeps what the expanded list already opens at once', () => {
    const o = out({ casterProgression: '1/3', additionalSpells: [{ expanded: { _: ['light'] } }] });
    giveNamedClassLists(o, named);
    expect(o.subclass[0]?.additionalSpells).toEqual([
      { expanded: { _: ['light', { all: 'class=Wizard' }] } },
    ]);
  });

  it('gives none to a printing of an official subclass, or a subclass that casts nothing', () => {
    const printing = out({ casterProgression: '1/3', printingOf: 'eldritch knight|phb' });
    giveNamedClassLists(printing, named);
    expect(printing.subclass[0]?.additionalSpells).toBeUndefined();
    const plain = out({});
    giveNamedClassLists(plain, named);
    expect(plain.subclass[0]?.additionalSpells).toBeUndefined();
  });
});
