import { describe, expect, it } from 'vitest';
import { isCompatibleTag, parseTagVersion } from './config';

describe('parseTagVersion', () => {
  it('parses v-prefixed and bare semver tags', () => {
    expect(parseTagVersion('v2.32.0')).toEqual({ major: 2, minor: 32, patch: 0 });
    expect(parseTagVersion('2.9.1')).toEqual({ major: 2, minor: 9, patch: 1 });
    expect(parseTagVersion('  v3.0.0  ')).toEqual({ major: 3, minor: 0, patch: 0 });
  });

  it('rejects malformed tags', () => {
    for (const bad of ['', 'latest', 'v2', 'v2.32', 'v2.32.0-rc1', 'twenty']) {
      expect(parseTagVersion(bad)).toBeNull();
    }
  });
});

describe('isCompatibleTag', () => {
  const base = 'v2.32.0';

  it('accepts same-major tags regardless of minor/patch', () => {
    expect(isCompatibleTag('v2.32.0', base)).toBe(true);
    expect(isCompatibleTag('v2.40.5', base)).toBe(true);
    expect(isCompatibleTag('v2.0.0', base)).toBe(true);
  });

  it('rejects a different major', () => {
    expect(isCompatibleTag('v3.0.0', base)).toBe(false);
    expect(isCompatibleTag('v1.9.9', base)).toBe(false);
  });

  it('rejects malformed tags', () => {
    expect(isCompatibleTag('latest', base)).toBe(false);
    expect(isCompatibleTag('', base)).toBe(false);
  });
});
