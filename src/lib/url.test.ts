import { describe, expect, it } from 'vitest';
import { safeExternalHref } from './url';

describe('safeExternalHref', () => {
  it('allows plain http(s) URLs and normalizes them', () => {
    expect(safeExternalHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeExternalHref('http://example.com')).toBe('http://example.com/');
    expect(safeExternalHref('HTTPS://Example.com/A')).toBe('https://example.com/A');
  });

  it('rejects dangerous protocols', () => {
    expect(safeExternalHref('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeExternalHref('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeExternalHref('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects protocols obfuscated with control/zero-width characters', () => {
    const zwsp = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0x00);
    expect(safeExternalHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeExternalHref('java\nscript:alert(1)')).toBeUndefined();
    expect(safeExternalHref(' javascript:alert(1)')).toBeUndefined();
    expect(safeExternalHref(`java${zwsp}script:alert(1)`)).toBeUndefined();
    expect(safeExternalHref(`java${nul}script:alert(1)`)).toBeUndefined();
    expect(safeExternalHref('\t\n javascript:alert(1)')).toBeUndefined();
  });

  it('strips ignored chars from within an otherwise-safe URL', () => {
    const zwsp = String.fromCharCode(0x200b);
    // Zero-width space inside a legitimate https URL is dropped, link still works.
    expect(safeExternalHref(`https://exa${zwsp}mple.com/`)).toBe('https://example.com/');
  });

  it('rejects malformed, relative, and empty values', () => {
    expect(safeExternalHref('')).toBeUndefined();
    expect(safeExternalHref('   ')).toBeUndefined();
    expect(safeExternalHref('not a url')).toBeUndefined();
    expect(safeExternalHref('/relative/path')).toBeUndefined();
    expect(safeExternalHref('example.com')).toBeUndefined();
    expect(safeExternalHref(undefined)).toBeUndefined();
  });
});
