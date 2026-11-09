import { describe, expect, it } from 'vitest';
import { convertXmlChunks, convertXmlText, UnsupportedFormatError } from './index';
import { readXml, type XmlElement, XmlError, type XmlLimits } from './xml';
import { readXmlEntries } from './xmlStream';

const LIMITS: XmlLimits = { maxLength: 4_000_000, maxElements: 100_000, maxDepth: 64 };

async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

/** The root's children as the stream gives them, every one built. */
async function streamed(text: string, size: number, keep = (_: string) => true) {
  const entries: XmlElement[] = [];
  const { root, problems } = await readXmlEntries(chunked(text, size), {
    limits: LIMITS,
    keep,
    onEntry: (e) => entries.push(e),
  });
  return { root: root.name, entries, problems };
}

/** The same from the whole-file reader. */
function whole(text: string) {
  const { root, problems } = readXml(text, LIMITS);
  return {
    root: root.name,
    entries: root.children.filter((c): c is XmlElement => typeof c !== 'string'),
    problems,
  };
}

/** Files the whole-file reader recovers from in every way it can, and plain ones. */
const FILES = [
  '﻿<?xml version="1.0"?><compendium version="5"><spell><name>Ember &amp; Ash</name><text>A &lt; B &#x263A; &unknown; & </text></spell><item><name>Rope</name></item></compendium>',
  '<compendium>\n  <!-- a comment --><spell><name>Zap</name><text><![CDATA[<b>bold</b> & raw]]></text></spell>\n</compendium>',
  '<compendium><feat name=\'x\' flag other="y"><name>Alert</name><prereq/></feat><race/></compendium>',
  '<compendium><spell><name>Open</name><text>never closed</compendium>',
  '<compendium><spell><name>Bad</name></item></spell><item><name>Next</name></item>',
  '<compendium><spell><name>Cut</name><text>the file ends ins',
  '<compendium><spell><name>Cut</name><text>in a tag <b clas',
  '<compendium><spell><name>Cut</name><!-- in a comment',
  '<compendium><spell><name>AC < 15</name></spell></compendium><spell><name>After</name></spell>',
  '<compendium><monster><name>Wolf</name><trait><name>Pack</name><text>Hunts.</text></trait></monster><spell><name>Zap</name></spell></compendium>',
];

describe('readXmlEntries', () => {
  it('gives the entries and problems the whole-file reader does, at every chunk size', async () => {
    for (const file of FILES) {
      const expected = whole(file);
      for (let size = 1; size <= file.length; size += 1) {
        expect(await streamed(file, size), `${file} in chunks of ${size}`).toEqual(expected);
      }
    }
  });

  it('gives an entry of a kind not asked for as its name and attributes', async () => {
    const { entries } = await streamed(FILES[9] ?? '', 5, (name) => name === 'spell');
    expect(entries.map((e) => [e.name, e.children.length])).toEqual([
      ['monster', 0],
      ['spell', 1],
    ]);
  });

  it('refuses what the whole-file reader refuses', async () => {
    const read = (text: string, limits: XmlLimits = LIMITS) =>
      readXmlEntries(chunked(text, 3), { limits, keep: () => true, onEntry: () => {} });
    await expect(read('<!DOCTYPE x><compendium/>')).rejects.toThrow(/DOCTYPE/);
    await expect(read('just text')).rejects.toThrow('The file has no XML elements.');
    await expect(read('<a><b/><c/></a>', { ...LIMITS, maxElements: 2 })).rejects.toThrow(XmlError);
    await expect(read('<a><b><c/></b></a>', { ...LIMITS, maxDepth: 1 })).rejects.toThrow(
      'nested too deeply',
    );
    await expect(read(`<a>${'x'.repeat(20)}</a>`, { ...LIMITS, maxLength: 10 })).rejects.toThrow(
      'too large',
    );
  });

  it('stops reading when the root is refused', async () => {
    let read = 0;
    async function* chunks() {
      for (const chunk of ['<elements>', '<x/>', '<y/>', '</elements>']) {
        read += 1;
        yield chunk;
      }
    }
    await expect(
      readXmlEntries(chunks(), {
        limits: LIMITS,
        keep: () => true,
        onRoot: () => {
          throw new Error('not this one');
        },
        onEntry: () => {},
      }),
    ).rejects.toThrow('not this one');
    expect(read).toBe(1);
  });
});

describe('convertXmlChunks', () => {
  const FILE = `<compendium>
    <spell><name>Ember Lance</name><level>1</level><school>EV</school><classes>Wizard</classes><text>A lance.\nSource: Ember Codex p. 3</text></spell>
    <spell><name>Ember Lance</name><classes>Cleric (Forge)</classes></spell>
    <feat><name>Ember Fear (Strength)</name><text>Roar.</text></feat>
    <feat><name>Ember Fear (Charisma)</name><text>Roar.</text></feat>
    <background><name>Ember Herald</name><proficiency>Arcana</proficiency><trait><name>Feat</name><text>You gain the Ember Fear feat.</text></trait></background>
    <monster><name>Wolf</name></monster>
    <class><name>Ember Knight</name></class>
    <oddity/>
  </compendium>`;

  it('converts as the whole-file converter does', async () => {
    const opts = { fileName: 'ember.xml' };
    const expected = convertXmlText(FILE, opts);
    for (const size of [1, 7, 64, FILE.length]) {
      expect(await convertXmlChunks(() => chunked(FILE, size), opts)).toEqual(expected);
    }
  });

  it('refuses a web page or another app`s file before reading it all', async () => {
    const opts = { fileName: 'page.xml' };
    await expect(
      convertXmlChunks(() => chunked('   <!doctype html><html><body/></html>', 4), opts),
    ).rejects.toThrow(/web page/);
    await expect(
      convertXmlChunks(() => chunked('<elements><element/></elements>', 4), opts),
    ).rejects.toThrow(UnsupportedFormatError);
  });

  it('finds the start of a file past spaces that run over many chunks', async () => {
    const opts = { fileName: 'page.xml' };
    const spaces = ' \n\t'.repeat(10);
    for (const size of [1, 3, 7]) {
      await expect(
        convertXmlChunks(() => chunked(`${spaces}<!doctype html><html><body/></html>`, size), opts),
      ).rejects.toThrow(/web page/);
      expect(await convertXmlChunks(() => chunked(spaces + FILE, size), opts)).toEqual(
        convertXmlText(spaces + FILE, opts),
      );
    }
  });
});

describe('hostile input, streamed', () => {
  it('reads spaces before the first tag, over thousands of chunks, in linear time', async () => {
    const file = `<compendium><spell><name>Zap</name><level>1</level><school>EV</school><classes>Wizard</classes><text>Zap.</text></spell></compendium>`;
    const opts = { fileName: 'zap.xml' };
    const spaced = await convertXmlChunks(() => chunked(' '.repeat(8_000_000) + file, 1024), opts);
    expect(spaced).toEqual(await convertXmlChunks(() => chunked(file, 1024), opts));
    expect(spaced.report.converted).toEqual({ spell: 1 });
  });

  it('reads a comment cut by every chunk boundary in linear time', async () => {
    const file = `<compendium><!--${'x'.repeat(1_000_000)}--><spell><name>Zap</name></spell></compendium>`;
    const { entries } = await streamed(file, 1);
    expect(entries.map((e) => e.name)).toEqual(['spell']);
  });

  it('reads a long run of text, and a long tag, a character at a time in linear time', async () => {
    const text = 'a'.repeat(1_000_000);
    const file = `<compendium><spell ${'b="c" '.repeat(30_000)}><name>${text}</name></spell></compendium>`;
    const { entries } = await streamed(file, 1);
    expect(entries[0]?.children[0]).toEqual({
      name: 'name',
      attrs: expect.anything(),
      children: [text],
    });
  });
});
