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

  it('falls back to a default for empty/blank names', () => {
    expect(jsonFilename('')).toBe('download.json');
    expect(jsonFilename('   ')).toBe('download.json');
  });
});
