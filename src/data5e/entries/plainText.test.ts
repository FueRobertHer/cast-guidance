import { describe, expect, it } from 'vitest';
import { plainEntryText } from './plainText';

describe('plainEntryText', () => {
  it('leaves text with no tags as it is', () => {
    expect(plainEntryText('simple')).toBe('simple');
    expect(plainEntryText('a {curly} b')).toBe('a {curly} b');
  });

  it('reads a reference by its display text, or its name when it has none', () => {
    expect(plainEntryText('{@item hand crossbow|phb|hand crossbows}')).toBe('hand crossbows');
    expect(plainEntryText("{@item thieves' tools|PHB}")).toBe("thieves' tools");
  });

  it('keeps the words around a tag', () => {
    expect(
      plainEntryText('three {@item musical instrument|PHB|musical instruments} of your choice'),
    ).toBe('three musical instruments of your choice');
    expect(plainEntryText('{@item a|x} or {@item b|x}')).toBe('a or b');
  });

  it('finds the display text where a tag not laid out as name|source|display has it', () => {
    expect(plainEntryText('{@filter Light|items|type=martial weapon|property=light}')).toBe(
      'Light',
    );
    expect(plainEntryText('{@classFeature Rage|Barbarian||1||raging}')).toBe('raging');
  });

  it('reads any other tag by its body', () => {
    expect(plainEntryText('{@b bold} and {@dice 1d6}')).toBe('bold and 1d6');
    expect(plainEntryText('{@unknownTag words|more}')).toBe('words');
    expect(plainEntryText('a{@h}b')).toBe('ab');
  });

  it('reads a tag that holds only a number with the words the renderer shows', () => {
    expect(plainEntryText('a {@dc 15} Testing saving throw')).toBe('a DC 15 Testing saving throw');
    expect(plainEntryText('(save {@dc 8} plus your bonus)')).toBe('(save DC 8 plus your bonus)');
    expect(plainEntryText('a {@chance 10} chance')).toBe('a 10 percent chance');
    expect(plainEntryText('{@chance 25|||It fails!|It works}')).toBe('25 percent');
  });

  it('reads a tag inside a tag', () => {
    expect(plainEntryText('{@note see {@item longsword|phb|longswords}}')).toBe('see longswords');
  });

  it('leaves a tag that never closes as text', () => {
    expect(plainEntryText('broken {@item longsword|phb')).toBe('broken {@item longsword|phb');
  });

  it('gives up on nesting past any real text rather than overflow the stack', () => {
    const levels = 100_000;
    const deep = `${'{@b '.repeat(levels)}x${'}'.repeat(levels)}`;
    expect(plainEntryText(deep)).toContain('{@b ');
  });
});
