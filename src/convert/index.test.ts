import { describe, expect, it } from 'vitest';
import { convertXmlText, UnsupportedFormatError, XmlError } from './index';
import { looksLikeXml } from './sniff';

const opts = { fileName: 'ember_codex.xml' };

function unsupported(text: string): UnsupportedFormatError {
  try {
    convertXmlText(text, opts);
  } catch (error) {
    if (error instanceof UnsupportedFormatError) return error;
    throw error;
  }
  throw new Error('expected an UnsupportedFormatError');
}

describe('looksLikeXml', () => {
  it('accepts text that opens with a tag, after a byte order mark or whitespace', () => {
    expect(looksLikeXml('<compendium/>')).toBe(true);
    expect(looksLikeXml('﻿  \n<?xml version="1.0"?><compendium/>')).toBe(true);
  });

  it('rejects JSON, prose and empty text', () => {
    expect(looksLikeXml('{"spell":[]}')).toBe(false);
    expect(looksLikeXml('notes <compendium/>')).toBe(false);
    expect(looksLikeXml('')).toBe(false);
  });

  it('decides on the first character that is not space, however far in it is', () => {
    expect(looksLikeXml(`${'\r\n'.repeat(5000)}\t<compendium/>`)).toBe(true);
    expect(looksLikeXml(' \t\r\n')).toBe(false);
  });
});

describe('convertXmlText', () => {
  it('converts a Fight Club compendium', () => {
    const { json, report } = convertXmlText(
      '<compendium><item><name>Rope Coil</name><type>G</type></item></compendium>',
      opts,
    );
    expect(report.format).toBe('fc5-compendium');
    expect(report.formatName).toBe('Fight Club 5e');
    expect(report.converted).toEqual({ item: 1 });
    expect(json.item).toEqual([
      { name: 'Rope Coil', source: 'FCEmberCodex', type: 'G', rarity: 'none' },
    ]);
  });

  it('reads the root name in any case', () => {
    const { report } = convertXmlText('<COMPENDIUM></COMPENDIUM>', opts);
    expect(report.converted).toEqual({});
  });

  it('lets an XmlError through', () => {
    expect(() => convertXmlText('<!DOCTYPE compendium><compendium/>', opts)).toThrow(XmlError);
    expect(() => convertXmlText('plain words', opts)).toThrow(XmlError);
  });

  it('names Aurora Builder content', () => {
    const error = unsupported('<Elements><element/></Elements>');
    expect(error.name).toBe('UnsupportedFormatError');
    expect(error.message).toMatch(/Aurora Builder/);
    expect(error.message).toMatch(/can be imported/);
  });

  it('names a Fight Club collection list', () => {
    expect(unsupported('<source><file>a.xml</file></source>').message).toMatch(/collection list/);
    expect(unsupported('<collection><doc/></collection>').message).toMatch(/collection list/);
  });

  it('names a character file', () => {
    for (const root of ['pc', 'character', 'characters']) {
      expect(unsupported(`<${root}/>`).message).toMatch(/character from another app/);
    }
  });

  it('names the root of any other XML file', () => {
    const error = unsupported('<widgets><widget/></widgets>');
    expect(error.message).toMatch(/<widgets>/);
    expect(error.message).toMatch(/not a format the app knows/);
  });
});
