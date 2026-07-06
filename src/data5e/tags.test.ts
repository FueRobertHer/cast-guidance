import { describe, expect, it } from 'vitest';
import { parseEntityRef, splitArgs, tokenizeEntryText } from './tags';

describe('tokenizeEntryText', () => {
  it('passes plain text through', () => {
    expect(tokenizeEntryText('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });

  it('tokenizes a simple dice tag with surrounding text', () => {
    expect(tokenizeEntryText('take {@dice 1d6} damage')).toEqual([
      { kind: 'text', text: 'take ' },
      { kind: 'tag', tag: 'dice', args: ['1d6'] },
      { kind: 'text', text: ' damage' },
    ]);
  });

  it('splits piped args', () => {
    expect(tokenizeEntryText('{@spell fireball|phb|a fireball}')).toEqual([
      { kind: 'tag', tag: 'spell', args: ['fireball', 'phb', 'a fireball'] },
    ]);
  });

  it('keeps empty middle args (classFeature refs)', () => {
    expect(tokenizeEntryText('{@classFeature Rage|Barbarian||1}')).toEqual([
      { kind: 'tag', tag: 'classFeature', args: ['Rage', 'Barbarian', '', '1'] },
    ]);
  });

  it('handles nested tags without splitting on inner pipes', () => {
    const [tok] = tokenizeEntryText('{@note see {@spell fireball|phb} for details}');
    expect(tok).toEqual({
      kind: 'tag',
      tag: 'note',
      args: ['see {@spell fireball|phb} for details'],
    });
  });

  it('handles multiple tags in one string', () => {
    const toks = tokenizeEntryText('{@b Hit:} {@damage 2d6} slashing');
    expect(toks).toEqual([
      { kind: 'tag', tag: 'b', args: ['Hit:'] },
      { kind: 'text', text: ' ' },
      { kind: 'tag', tag: 'damage', args: ['2d6'] },
      { kind: 'text', text: ' slashing' },
    ]);
  });

  it('treats unbalanced braces as text', () => {
    expect(tokenizeEntryText('broken {@dice 1d6')).toEqual([
      { kind: 'text', text: 'broken {@dice 1d6' },
    ]);
  });

  it('handles tag with no args', () => {
    expect(tokenizeEntryText('{@hitYourAC}')).toEqual([
      { kind: 'tag', tag: 'hitYourAC', args: [] },
    ]);
  });

  it('ignores plain braces that are not tags', () => {
    expect(tokenizeEntryText('a {curly} b')).toEqual([{ kind: 'text', text: 'a {curly} b' }]);
  });
});

describe('splitArgs', () => {
  it('returns [] for empty string', () => {
    expect(splitArgs('')).toEqual([]);
  });
  it('splits at depth 0 only', () => {
    expect(splitArgs('a|{@x b|c}|d')).toEqual(['a', '{@x b|c}', 'd']);
  });
  it('keeps trailing empty args', () => {
    expect(splitArgs('Rage|Barbarian||1')).toEqual(['Rage', 'Barbarian', '', '1']);
  });
});

describe('parseEntityRef', () => {
  it('name only', () => {
    expect(parseEntityRef(['longsword'])).toEqual({
      name: 'longsword',
      source: undefined,
      display: 'longsword',
    });
  });
  it('name + source', () => {
    expect(parseEntityRef(['fireball', 'phb'])).toEqual({
      name: 'fireball',
      source: 'phb',
      display: 'fireball',
    });
  });
  it('name + source + display', () => {
    expect(parseEntityRef(['fireball', 'phb', 'a big boom'])).toEqual({
      name: 'fireball',
      source: 'phb',
      display: 'a big boom',
    });
  });
  it('empty source falls back to undefined, display still honored', () => {
    expect(parseEntityRef(['prone', '', 'knocked prone'])).toEqual({
      name: 'prone',
      source: undefined,
      display: 'knocked prone',
    });
  });
});
