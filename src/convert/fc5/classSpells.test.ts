import { describe, expect, it } from 'vitest';
import { readFeatureSpells } from './classSpells';
import type { SpellIndex } from './spellGrants';
import type { Entry } from './text';

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
});
