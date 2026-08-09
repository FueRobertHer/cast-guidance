import { describe, expect, it } from 'vitest';
import { computeRegistrySignature, homebrewSourceNames } from './registry';

describe('computeRegistrySignature', () => {
  it('is stable regardless of input order', () => {
    const a = computeRegistrySignature(['b.json', 'a.json'], [{ id: '2' }, { id: '1' }]);
    const b = computeRegistrySignature(['a.json', 'b.json'], [{ id: '1' }, { id: '2' }]);
    expect(a).toBe(b);
  });

  it('changes when a homebrew file revision bumps (editable edit, same id)', () => {
    const before = computeRegistrySignature(['a.json'], [{ id: 'brew-1', rev: 0 }]);
    const after = computeRegistrySignature(['a.json'], [{ id: 'brew-1', rev: 1 }]);
    expect(after).not.toBe(before);
  });

  it('treats a missing rev as 0', () => {
    expect(computeRegistrySignature(['a.json'], [{ id: 'brew-1' }])).toBe(
      computeRegistrySignature(['a.json'], [{ id: 'brew-1', rev: 0 }]),
    );
  });

  it('changes when the cached file set changes', () => {
    const one = computeRegistrySignature(['a.json'], []);
    const two = computeRegistrySignature(['a.json', 'b.json'], []);
    expect(one).not.toBe(two);
  });

  it('changes when a homebrew file is added or removed', () => {
    const none = computeRegistrySignature(['a.json'], []);
    const one = computeRegistrySignature(['a.json'], [{ id: 'brew-1', rev: 3 }]);
    expect(none).not.toBe(one);
  });
});

const brew = (sources: unknown) => ({ json: { _meta: { sources } } });

describe('homebrewSourceNames', () => {
  it('reads the title a brew gives itself', () => {
    const names = homebrewSourceNames([
      brew([{ json: 'F', abbreviation: 'F', full: 'Flame Sword Homebrew' }]),
    ]);
    expect(names.get('F')).toBe('Flame Sword Homebrew');
  });

  it('collects every source in every file', () => {
    const names = homebrewSourceNames([
      brew([
        { json: 'A', full: 'Anna Brews' },
        { json: 'B', full: 'Bob Brews' },
      ]),
      brew([{ json: 'C', full: 'Cass Brews' }]),
    ]);
    expect([...names.entries()]).toEqual([
      ['A', 'Anna Brews'],
      ['B', 'Bob Brews'],
      ['C', 'Cass Brews'],
    ]);
  });

  it('falls back to the abbreviation when there is no full title', () => {
    expect(homebrewSourceNames([brew([{ json: 'HB', abbreviation: 'Bob' }])]).get('HB')).toBe(
      'Bob',
    );
  });

  it('skips titles that are just the code again', () => {
    // The common case for an in-app file: abbreviation and id are the same
    // string, and "F" expanding to "F" is not worth a lookup hit.
    expect(homebrewSourceNames([brew([{ json: 'F', abbreviation: 'F' }])]).size).toBe(0);
  });

  it('ignores files whose metadata is missing or malformed', () => {
    const names = homebrewSourceNames([
      { json: undefined },
      { json: 'not an object' },
      { json: {} },
      { json: { _meta: null } },
      { json: { _meta: { sources: 'nope' } } },
      brew([null, 42, { full: 'no code' }, { json: '', full: 'empty code' }]),
    ]);
    expect(names.size).toBe(0);
  });
});
