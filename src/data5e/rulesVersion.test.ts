import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import type { EntityType } from './normalize';
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
  const targets = (reprintedAs: unknown, holderType?: EntityType) =>
    reprintTargets({ name: 'A', source: 'PHB', reprintedAs } as Entity, holderType);

  it('reads both the string and the { uid } forms', () => {
    expect(targets(['Fighter|XPHB'])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets([{ uid: 'Fighter|XPHB' }])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets(['A|X', { uid: 'B|Y' }])).toEqual([
      { name: 'A', source: 'X' },
      { name: 'B', source: 'Y' },
    ]);
  });

  it('keeps only the name and source of an ordinary uid', () => {
    expect(targets(['Elf|XPHB|anything'])).toEqual([{ name: 'Elf', source: 'XPHB' }]);
  });

  it('reads a subclass uid by its shortName and its last segment', () => {
    // ShortName|ClassName|ClassSource|SubclassSource. Taking the first two
    // segments would put the class name ("Cleric") in the source slot and look
    // up a subclass that does not exist.
    expect(targets(['Life|Cleric|XPHB|XPHB'], 'subclass')).toEqual([
      { name: 'Life', shortName: 'Life', source: 'XPHB', type: 'subclass' },
    ]);
    // The subclass source is not always the class source.
    expect(targets(['Knowledge|Cleric|XPHB|FRHoF'], 'subclass')).toEqual([
      { name: 'Knowledge', shortName: 'Knowledge', source: 'FRHoF', type: 'subclass' },
    ]);
  });

  it('sends a subrace reprint to the race bucket, since 2024 folds them in', () => {
    expect(targets(['Elf|XPHB'], 'subrace')).toEqual([
      { name: 'Elf', source: 'XPHB', type: 'race' },
    ]);
  });

  it('lets an entry tag override where the target is looked for', () => {
    expect(targets([{ uid: 'Mark of Warding|EFA', tag: 'feat' }], 'subrace')).toEqual([
      { name: 'Mark of Warding', source: 'EFA', type: 'feat' },
    ]);
    // An unrecognised tag falls back rather than inventing a bucket.
    expect(targets([{ uid: 'Elf|XPHB', tag: 'nonsense' }], 'race')).toEqual([
      { name: 'Elf', source: 'XPHB', type: 'race' },
    ]);
  });

  it('ignores entries it cannot read rather than inventing a target', () => {
    // A half-written uid would otherwise become a lookup for the empty source,
    // which matches nothing and reads as "no reprint" for the wrong reason.
    expect(targets(['NoSource'])).toEqual([]);
    expect(targets(['|XPHB'])).toEqual([]);
    expect(targets(['Elf|'])).toEqual([]);
    // A subclass uid that stops short has no source segment to read.
    expect(targets(['Life|Cleric|XPHB'], 'subclass')).toEqual([]);
    expect(targets(['Life|Cleric|XPHB|'], 'subclass')).toEqual([]);
    expect(targets([42, null, {}, { uid: 7 }])).toEqual([]);
    expect(targets(undefined)).toEqual([]);
    expect(targets('Fighter|XPHB')).toEqual([]); // not an array
  });
});
