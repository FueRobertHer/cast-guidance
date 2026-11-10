// Files a player imports are untrusted. These inputs each took seconds to
// minutes, or crashed, before the converter bounded them; at these sizes a
// quadratic path runs past the test timeout rather than through a timing
// assertion.
import { describe, expect, it } from 'vitest';
import { convertXmlText } from './index';
import { looksLikeXml } from './sniff';

const spell = (inner: string) =>
  `<compendium><spell><name>Test</name><level>1</level>${inner}</spell></compendium>`;
const convert = (xml: string) => convertXmlText(xml, { fileName: 'hostile.xml' });
const firstSpell = (xml: string) => (convert(xml).json.spell as Record<string, unknown>[])[0];

describe('hostile input', () => {
  it('reads a line of unclosed emphasis tags in one pass', () => {
    const s = firstSpell(spell(`<text><![CDATA[${'<b>'.repeat(300_000)}]]></text>`));
    expect(s?.entries).toEqual(['']);
  });

  it('still turns closed emphasis into tags', () => {
    const s = firstSpell(spell('<text><![CDATA[<b>Hot</b> and <em>sharp</em>, <i>open]]></text>'));
    expect(s?.entries).toEqual(['{@b Hot} and {@i sharp}, open']);
  });

  it('keeps a header wider than any rules table as text, not a padded table', () => {
    const s = firstSpell(spell(`<text>${'a|'.repeat(50_000)}\n${'a|b\n'.repeat(25_000)}</text>`));
    const entries = s?.entries as unknown[];
    expect(
      entries.some((e) => typeof e === 'object' && (e as { type?: string }).type === 'table'),
    ).toBe(true);
    // The wide line is a paragraph; only the narrow rows became a table.
    expect(typeof entries[0]).toBe('string');
  });

  it('dedupes a very long class list in linear time', () => {
    const names = Array.from({ length: 200_000 }, (_, i) => `C${i % 1000}`);
    const s = firstSpell(spell(`<school>EV</school><classes>${names.join(',')}</classes>`));
    const classes = s?.classes as { fromClassList: unknown[] };
    expect(classes.fromClassList).toHaveLength(1000);
  });

  it('reads a very long list of option lists in linear time', () => {
    const lists = Array.from({ length: 200_000 }, (_, i) => `Order ${i % 1000}: Tricks [5.5e]`);
    const { json } = convert(spell(`<classes>${lists.join(',')}</classes>`));
    const [option] = json.optionalfeature as Record<string, unknown>[];
    expect(option?.featureType).toHaveLength(1000);
  });

  it('reads a very long Source line in linear time', () => {
    const books = Array.from({ length: 200_000 }, (_, i) => `Book ${i}`).join(', ');
    const item = `<item><name>Rope</name><type>G</type><text>Source: ${books}</text></item>`;
    const { json } = convert(`<compendium>${item}</compendium>`);
    const [rope] = json.item as Record<string, unknown>[];
    // A title past any real one is cut, with a hash to keep it apart from others.
    expect(String(rope?.source)).toMatch(/^FCBook0Book1\w{30}$/);
  });

  it('reads a Source line of spaces and dots in linear time', () => {
    const line = `Book${' .'.repeat(200_000)} p. 3${' '.repeat(200_000)}(Indie)`;
    const item = `<item><name>Rope</name><type>G</type><source>${line}</source></item>`;
    const { json } = convert(`<compendium>${item}</compendium>`);
    expect((json.item as Record<string, unknown>[] | undefined)?.length ?? 0).toBeLessThan(2);
  });

  it('reads a name ending in many brackets in linear time', () => {
    const s = firstSpell(
      spell('').replace('<name>Test</name>', `<name>Ember${'(a)'.repeat(200_000)}</name>`),
    );
    expect(String(s?.name).startsWith('Ember')).toBe(true);
  });

  it('looks for a very long name in the books it cites in linear time', () => {
    const name = `${'Ember, '.repeat(50_000)}Ash / Grey (Ash, ${'x'.repeat(50_000)}) +1`;
    const books = Array.from({ length: 30 }, () => "Player's Handbook p. 1").join(', ');
    const race = `<race><name>${name}</name><trait><name>T</name><text>Source: ${books}</text></trait></race>`;
    const { json } = convertXmlText(`<compendium>${race}</compendium>`, {
      fileName: 'hostile.xml',
      isInstalled: () => false,
      hasBook: () => true,
    });
    expect(json.race as unknown[]).toHaveLength(1);
  });

  it.each([
    'constructor',
    '__proto__',
  ])('treats a <%s> element as unknown, not a converter', (name) => {
    const { report } = convert(`<compendium><${name}><name>X</name></${name}></compendium>`);
    expect(report.warnings).toEqual([`1 <${name}> element left out: not part of this format.`]);
  });

  it.each(['constructor', '__proto__'])('does not read %s as a spell school', (school) => {
    const s = firstSpell(spell(`<school>${school}</school>`));
    expect(s?.school).toBeUndefined();
  });

  it.each(['constructor', '__proto__'])('names an option %s as itself in printingOf', (name) => {
    const { json } = convert(
      `<compendium><spell><name>${name}</name><level>0</level><classes>Monk (Way of the Four Elements)</classes><text>Source: Player's Handbook p. 1</text></spell></compendium>`,
    );
    const option = (json.optionalfeature as Record<string, unknown>[])[0];
    expect(option?.printingOf).toEqual([`${name}|PHB`]);
  });

  it('reads an option name of many level brackets in linear time', () => {
    const name = `Helm${' (Level 1)'.repeat(100_000)}`;
    const { json } = convert(
      `<compendium><spell><name>${name}</name><level>0</level><classes>Artificer Infusions</classes><text>Source: Tasha's Cauldron of Everything p. 1</text></spell></compendium>`,
    );
    const option = (json.optionalfeature as Record<string, unknown>[])[0];
    expect((option?.printingOf as string[])[0]?.endsWith(' (Level 1)|TCE')).toBe(true);
  });

  it('passes an unknown damage type code through, uppercased like every code', () => {
    const { json } = convert(
      '<compendium><item><name>Odd Blade</name><type>M</type><dmg1>1d8</dmg1><dmgType>constructor</dmgType></item></compendium>',
    );
    expect((json.item as Record<string, unknown>[])[0]?.dmgType).toBe('CONSTRUCTOR');
  });

  it('sniffs XML after any amount of leading space', () => {
    expect(looksLikeXml(`${' '.repeat(100_000)}<compendium/>`)).toBe(true);
    expect(looksLikeXml('﻿<compendium/>')).toBe(true);
    expect(looksLikeXml('  {"_meta":{}}')).toBe(false);
    expect(looksLikeXml('   ')).toBe(false);
  });
});

describe('more input that once scanned to the end per character', () => {
  it.each([
    ['unclosed 5etools tags', spell(`<text>${'{@'.repeat(200_000)}</text>`)],
    ['unclosed HTML tags', spell(`<text><![CDATA[${'<a '.repeat(200_000)}]]></text>`)],
    ['a class name of open parentheses', spell(`<classes>${'('.repeat(200_000)}</classes>`)],
    [
      'a long run of spaces in a casting time',
      spell(`<time>1 action${' '.repeat(200_000)}x</time>`),
    ],
    [
      'a long run of spaces in a modifier',
      `<compendium><item><name>I</name><type>W</type><modifier category="bonus">ac${' '.repeat(200_000)}x</modifier></item></compendium>`,
    ],
    [
      'many class-list stubs for one spell',
      `<compendium><spell><name>Test</name><level>1</level></spell>${'<spell><name>Test</name><classes>Wizard</classes></spell>'.repeat(50_000)}</compendium>`,
    ],
  ])('converts %s', (_label, xml) => {
    expect(convert(xml).report.converted).not.toEqual({});
  });
});

describe('a file that is not well formed', () => {
  it('says when the file is cut off', () => {
    const { report } = convert(
      '<compendium><spell><name>A</name><level>1</level></spell><spell><name>B</name><text>cut',
    );
    expect(report.warnings[0]).toBe(
      'The file ends before its <compendium> element is closed, so it may be cut off: entries near the end can be missing or incomplete.',
    );
  });

  it('says when an attribute quote is never closed', () => {
    const { report } = convert(
      '<compendium><spell><name>A</name><level>1</level></spell><spell x="y><name>B</name></spell></compendium>',
    );
    expect(report.warnings[0]).toBe(
      'The file ends inside a tag, so it may be cut off: entries near the end can be missing or incomplete.',
    );
  });

  it('counts closing tags that do not match', () => {
    const { report } = convert(
      '<compendium><spell><name>A</name><level>1</level></level></spell></compendium>',
    );
    expect(report.warnings).toEqual([
      '1 closing tag does not match the tag it closes, so some entries may be read wrong.',
    ]);
  });

  it('says nothing about a well-formed file', () => {
    expect(convert(spell('<text>Fine.</text>')).report.warnings).toEqual([]);
  });

  it('names a web page as one', () => {
    expect(() => convert('\n<!DOCTYPE html><html><body>Index of /</body></html>')).toThrow(
      /^This is a web page, not a file the app can import\./,
    );
  });
});

describe('choices read from prose', () => {
  const race = (text: string, count: number) =>
    `<compendium>${`<race><name>R</name><trait><name>T</name><text>${text}</text></trait></race>`.repeat(count)}</compendium>`;

  it.each([
    [
      'sentences of lead-ins',
      race(`${'thanks to a gift, '.repeat(2000)}you gain proficiency in arcana. `.repeat(5), 40),
    ],
    [
      'clauses joined to clauses',
      race('you gain proficiency in arcana, and you '.repeat(3000), 40),
    ],
    [
      'picks of many items',
      race(`You gain ${'one skill proficiency, '.repeat(3000)}of your choice. `, 100),
    ],
    [
      'resistance lists',
      race(
        `You have resistance to one of the following damage types: ${'fire, '.repeat(20_000)}or cold.`,
        50,
      ),
    ],
    [
      'ancestry tables',
      race(
        `Dragon | Damage Type\n${'Red | Fire\n'.repeat(2000)}You have resistance to the damage type associated with your draconic ancestry.`,
        100,
      ),
    ],
    [
      'background skill picks',
      `<compendium>${`<background><name>B</name><trait><name>Skill Proficiencies: History, plus one from among ${'Arcana, '.repeat(20_000)}and Religion</name><text>x</text></trait></background>`.repeat(10)}</compendium>`,
    ],
    [
      'background tool picks',
      `<compendium>${`<background><name>B</name><trait><name>Tool Proficiencies: Choose two from among ${'one musical instrument, '.repeat(20_000)}and thieves' tools</name><text>x</text></trait></background>`.repeat(10)}</compendium>`,
    ],
  ])('reads %s in linear time', (_label, xml) => {
    expect(convert(xml).report.converted).not.toEqual({});
  });
});
