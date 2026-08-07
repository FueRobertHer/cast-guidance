import { describe, expect, it } from 'vitest';
import { jsonByteSize } from './byteSize';

describe('jsonByteSize', () => {
  it('measures the JSON form of a value', () => {
    expect(jsonByteSize({ a: 1 })).toBe('{"a":1}'.length);
    expect(jsonByteSize([])).toBe(2);
  });

  it('measures strings as-is rather than re-quoting them', () => {
    // Search indexes are stored already-serialized; double-encoding them would
    // overstate their size by the added quotes and escapes.
    expect(jsonByteSize('{"a":1}')).toBe(7);
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // "é" is one JS char but two UTF-8 bytes; plus the two quote characters.
    expect(jsonByteSize('é')).toBe(2);
    expect(jsonByteSize('🎲')).toBe(4);
  });

  it('returns 0 for values with no JSON form', () => {
    expect(jsonByteSize(undefined)).toBe(0);
    expect(jsonByteSize(() => 1)).toBe(0);
  });
});
