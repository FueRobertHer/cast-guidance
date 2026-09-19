import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import { pickForVersion, reprintTargets } from './rulesVersion';

const exhaustion2014: Entity = { name: 'Exhaustion', source: 'PHB', entries: ['2014 table'] };
const exhaustion2024: Entity = { name: 'Exhaustion', source: 'XPHB', entries: ['2024 linear'] };

describe('pickForVersion', () => {
  it('picks the printing matching the character rules version', () => {
    const both = [exhaustion2014, exhaustion2024];
    expect(pickForVersion(both, '2014')?.source).toBe('PHB');
    expect(pickForVersion(both, '2024')?.source).toBe('XPHB');
    // Order-independent.
    expect(pickForVersion([exhaustion2024, exhaustion2014], '2014')?.source).toBe('PHB');
  });

  it('falls back to any printing when the exact edition is absent', () => {
    expect(pickForVersion([exhaustion2014], '2024')?.source).toBe('PHB');
    expect(pickForVersion([], '2024')).toBeUndefined();
  });

  it('honors an explicit edition tag over the source heuristic', () => {
    const tagged: Entity = { name: 'Foo', source: 'HOMEBREW', edition: 'one' };
    expect(pickForVersion([tagged], '2024')?.name).toBe('Foo');
    expect(pickForVersion([tagged], '2014')?.name).toBe('Foo'); // fallback
  });
});

describe('reprintTargets', () => {
  const targets = (reprintedAs: unknown) =>
    reprintTargets({ name: 'A', source: 'PHB', reprintedAs } as Entity);

  it('reads both the string and the { uid } forms', () => {
    expect(targets(['Fighter|XPHB'])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets([{ uid: 'Fighter|XPHB' }])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets(['A|X', { uid: 'B|Y' }])).toEqual([
      { name: 'A', source: 'X' },
      { name: 'B', source: 'Y' },
    ]);
  });

  it('keeps only the name and source when a uid carries display text', () => {
    expect(targets(['Elf|XPHB|Elf (2024)'])).toEqual([{ name: 'Elf', source: 'XPHB' }]);
  });

  it('ignores entries it cannot read rather than inventing a target', () => {
    // A half-written uid would otherwise become a lookup for the empty source,
    // which matches nothing and reads as "no reprint" for the wrong reason.
    expect(targets(['NoSource'])).toEqual([]);
    expect(targets(['|XPHB'])).toEqual([]);
    expect(targets([42, null, {}, { uid: 7 }])).toEqual([]);
    expect(targets(undefined)).toEqual([]);
    expect(targets('Fighter|XPHB')).toEqual([]); // not an array
  });
});
