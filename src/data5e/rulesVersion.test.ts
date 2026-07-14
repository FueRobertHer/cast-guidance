import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import { pickForVersion } from './rulesVersion';

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
