import { describe, expect, it } from 'vitest';
import {
  childElements,
  childText,
  childTexts,
  decodeEntities,
  parseXml,
  textContent,
  XML_LIMITS,
  type XmlElement,
  XmlError,
  type XmlLimits,
} from './xml';

function only(el: XmlElement, name: string): XmlElement {
  const found = childElements(el, name);
  expect(found).toHaveLength(1);
  const [first] = found;
  if (first === undefined) throw new Error(`no <${name}>`);
  return first;
}

function limits(overrides: Partial<XmlLimits>): XmlLimits {
  return { ...XML_LIMITS, ...overrides };
}

describe('decodeEntities', () => {
  it('decodes the predefined entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      `a & b <c> "d" 'e'`,
    );
  });

  it('decodes decimal and hex character references', () => {
    expect(decodeEntities('&#65;&#x42;&#X43;')).toBe('ABC');
  });

  it('decodes the HTML extras hand-written files use, ignoring case', () => {
    expect(decodeEntities('&frac12; &times; &hellip; &AMP;')).toBe('½ × … &');
  });

  it('keeps a bare ampersand and unknown entities as written', () => {
    expect(decodeEntities('Salt & Ash &bogus; &toString;')).toBe('Salt & Ash &bogus; &toString;');
  });

  it('keeps references to invalid code points as written', () => {
    expect(decodeEntities('&#0; &#xD800; &#x110000;')).toBe('&#0; &#xD800; &#x110000;');
  });
});

describe('parseXml', () => {
  it('lowercases element and attribute names', () => {
    const root = parseXml(
      '<Compendium Version="5"><SPELL><Name>Ember Lance</Name></SPELL></Compendium>',
    );
    expect(root.name).toBe('compendium');
    expect(root.attrs).toEqual({ version: '5' });
    const spell = only(root, 'spell');
    expect(childText(spell, 'name')).toBe('Ember Lance');
  });

  it('skips a byte order mark, the XML declaration, comments and processing instructions', () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- top -->\n<compendium><!-- inner --><?pi x?><item/></compendium>',
    );
    expect(root.name).toBe('compendium');
    expect(childElements(root).map((c) => c.name)).toEqual(['item']);
  });

  it('merges text split by a comment into one node', () => {
    const root = parseXml('<text>Ember<!-- note --> Lance</text>');
    expect(root.children).toEqual(['Ember Lance']);
  });

  it('keeps CDATA verbatim, markup and ampersands included', () => {
    const root = parseXml('<text><![CDATA[Roll 1d6 & add <b>it</b> &amp;]]></text>');
    expect(textContent(root)).toBe('Roll 1d6 & add <b>it</b> &amp;');
  });

  it('decodes entities in text and attribute values', () => {
    const root = parseXml('<roll description="Fire &amp; Ice">Salt &amp; Ash &#169;</roll>');
    expect(root.attrs.description).toBe('Fire & Ice');
    expect(textContent(root)).toBe('Salt & Ash ©');
  });

  it('keeps a stray ampersand and a lone less-than sign as text', () => {
    const root = parseXml('<text>Salt & Ash, AC < 15 or 1<2</text>');
    expect(textContent(root)).toBe('Salt & Ash, AC < 15 or 1<2');
  });

  it('reads quoted, single-quoted, unquoted and valueless attributes', () => {
    const root = parseXml(`<roll Level='3' description="Fire Damage" bare=yes flag>4d6</roll>`);
    expect(root.attrs).toEqual({ level: '3', description: 'Fire Damage', bare: 'yes', flag: '' });
  });

  it('builds attributes without a prototype', () => {
    const root = parseXml('<item/>');
    expect(Object.getPrototypeOf(root.attrs)).toBeNull();
    expect('toString' in root.attrs).toBe(false);
  });

  it('treats a self-closing element as a sibling, not a parent', () => {
    const root = parseXml('<item><text/><name>Rope Coil</name></item>');
    expect(childElements(root).map((c) => c.name)).toEqual(['text', 'name']);
    expect(childText(root, 'name')).toBe('Rope Coil');
  });

  it('closes everything inside a closing tag that skips an unclosed element', () => {
    const root = parseXml(
      '<compendium><spell><name>Ember Lance</spell><spell><name>Frost Jab</name></spell></compendium>',
    );
    const spells = childElements(root, 'spell');
    expect(spells.map((s) => childText(s, 'name'))).toEqual(['Ember Lance', 'Frost Jab']);
  });

  it('ignores a closing tag that matches nothing open', () => {
    const root = parseXml('<compendium></item><item><name>Rope Coil</name></item></compendium>');
    expect(childElements(root).map((c) => c.name)).toEqual(['item']);
  });

  it('closes elements a file leaves open at the end', () => {
    const root = parseXml('<compendium><item><name>Rope Coil');
    expect(childText(only(root, 'item'), 'name')).toBe('Rope Coil');
  });

  it('drops a tag cut off at the end of the file', () => {
    const root = parseXml('<compendium><item><name>Rope Coil</name></item><ite');
    expect(childElements(root).map((c) => c.name)).toEqual(['item']);
  });

  it('refuses a DOCTYPE declaration', () => {
    expect(() => parseXml('<!DOCTYPE compendium><compendium/>')).toThrow(XmlError);
    expect(() => parseXml('<!DOCTYPE compendium><compendium/>')).toThrow(/DOCTYPE/);
  });

  it('refuses an entity declaration anywhere in the file', () => {
    expect(() => parseXml('<compendium><!ENTITY boom "x"></compendium>')).toThrow(XmlError);
  });

  it('throws when the file holds no element', () => {
    expect(() => parseXml('just some words')).toThrow(/no XML elements/);
    expect(() => parseXml('')).toThrow(XmlError);
    expect(() => parseXml('<!-- only a comment -->')).toThrow(XmlError);
  });

  it('throws XmlError instances named XmlError', () => {
    let caught: unknown;
    try {
      parseXml('nothing');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XmlError);
    expect((caught as Error).name).toBe('XmlError');
  });

  describe('limits', () => {
    it('refuses a text longer than the length limit', () => {
      expect(() => parseXml('<item/>', limits({ maxLength: 6 }))).toThrow(/too large/);
      expect(parseXml('<item/>', limits({ maxLength: 7 })).name).toBe('item');
    });

    it('refuses more elements than the element limit', () => {
      const text = '<a><b/><b/></a>';
      expect(() => parseXml(text, limits({ maxElements: 2 }))).toThrow(/too many elements/);
      expect(childElements(parseXml(text, limits({ maxElements: 3 })))).toHaveLength(2);
    });

    it('refuses nesting deeper than the depth limit', () => {
      const text = '<a><b><c></c></b></a>';
      expect(() => parseXml(text, limits({ maxDepth: 2 }))).toThrow(/nested too deeply/);
      expect(parseXml(text, limits({ maxDepth: 3 })).name).toBe('a');
    });

    it('does not count a self-closing element toward depth', () => {
      expect(parseXml('<a><b><c/></b></a>', limits({ maxDepth: 2 })).name).toBe('a');
    });

    it('applies the default depth limit', () => {
      const nest = (depth: number) => `${'<x>'.repeat(depth)}${'</x>'.repeat(depth)}`;
      expect(parseXml(nest(XML_LIMITS.maxDepth)).name).toBe('x');
      expect(() => parseXml(nest(XML_LIMITS.maxDepth + 1))).toThrow(XmlError);
    });
  });
});

describe('tree helpers', () => {
  const item = parseXml(
    '<item><name>  Rope Coil  </name><detail>   </detail><text>One</text><text/><text>Roll <b>2d6</b> now</text></item>',
  );

  it('lists all child elements or those of one name', () => {
    expect(childElements(item).map((c) => c.name)).toEqual([
      'name',
      'detail',
      'text',
      'text',
      'text',
    ]);
    expect(childElements(item, 'text')).toHaveLength(3);
    expect(childElements(item, 'value')).toEqual([]);
  });

  it('collects nested text in document order', () => {
    expect(textContent(item)).toBe('  Rope Coil     OneRoll 2d6 now');
  });

  it('gives the trimmed text of the first child, or undefined when absent or blank', () => {
    expect(childText(item, 'name')).toBe('Rope Coil');
    expect(childText(item, 'detail')).toBeUndefined();
    expect(childText(item, 'value')).toBeUndefined();
    expect(childText(item, 'text')).toBe('One');
  });

  it('gives the text of every child of a name, blank ones as empty strings', () => {
    expect(childTexts(item, 'text')).toEqual(['One', '', 'Roll 2d6 now']);
  });
});
