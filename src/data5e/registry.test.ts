import { describe, expect, it } from 'vitest';
import { computeRegistrySignature } from './registry';

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
