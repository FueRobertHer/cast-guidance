import { describe, expect, it } from 'vitest';
import {
  abilityKey,
  entryName,
  inlineText,
  lastGroup,
  leadIn,
  markerEdition,
  own,
  plainText,
  readLanguages,
  readProficiencies,
  readText,
  sourceLineEdition,
  splitList,
  splitName,
  stripBookTags,
} from './text';

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

  it('gives up on any other kind of choice or wording', () => {
    expect(readLanguages('Choose Ignan or Aquan')).toBeUndefined();
    expect(readLanguages('Any two languages')).toBeUndefined();
    expect(readLanguages('Common, 3 more')).toBeUndefined();
    expect(readLanguages('')).toBeUndefined();
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

  it('reads pipe lines as a table captioned by the line before', () => {
    const read = readText(['Ember Table:', 'd4 | Effect', '1 | Smoke', '2 | Sparks 1d6 fire']);
    expect(read.entries).toEqual([
      {
        type: 'table',
        caption: 'Ember Table',
        colLabels: ['d4', 'Effect'],
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
