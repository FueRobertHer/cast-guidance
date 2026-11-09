import { describe, expect, it } from 'vitest';
import { jsonFilename } from './download';

describe('jsonFilename', () => {
  it('appends .json when missing', () => {
    expect(jsonFilename('hero')).toBe('hero.json');
  });

  it('does not double the extension', () => {
    expect(jsonFilename('hero.json')).toBe('hero.json');
    expect(jsonFilename('Hero.JSON')).toBe('Hero.JSON');
  });

  it('replaces the .xml of a file converted from another app', () => {
    expect(jsonFilename('spells.xml')).toBe('spells.json');
    expect(jsonFilename('Spells.XML')).toBe('Spells.json');
    expect(jsonFilename('spells.xml.json')).toBe('spells.xml.json');
  });

  it('falls back to a default for empty/blank names', () => {
    expect(jsonFilename('')).toBe('download.json');
    expect(jsonFilename('   ')).toBe('download.json');
  });
});
