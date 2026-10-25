import { describe, expect, it } from 'vitest';
import { checkHomebrewUrl, HOMEBREW_FETCH_ORIGINS, REFUSED_HOST_REASON } from './homebrewUrl';

const ok = (url: string) => ({ ok: true, url });

describe('checkHomebrewUrl', () => {
  it('accepts each allowed origin as typed', () => {
    for (const origin of HOMEBREW_FETCH_ORIGINS) {
      expect(checkHomebrewUrl(`${origin}/a/b/brew.json`)).toEqual(ok(`${origin}/a/b/brew.json`));
    }
  });

  it('rewrites a github.com blob page to the raw file', () => {
    expect(checkHomebrewUrl('https://github.com/me/brews/blob/main/dir/my%20brew.json')).toEqual(
      ok('https://raw.githubusercontent.com/me/brews/main/dir/my%20brew.json'),
    );
  });

  it('rewrites a github.com raw link to the raw file', () => {
    expect(checkHomebrewUrl('https://github.com/me/brews/raw/v1.2/brew.json')).toEqual(
      ok('https://raw.githubusercontent.com/me/brews/v1.2/brew.json'),
    );
  });

  it('rewrites a gist.github.com raw link to the gist content host', () => {
    expect(checkHomebrewUrl('https://gist.github.com/me/abc123/raw/def456/brew.json')).toEqual(
      ok('https://gist.githubusercontent.com/me/abc123/raw/def456/brew.json'),
    );
  });

  it('refuses github.com pages that do not name a file', () => {
    for (const url of [
      'https://github.com/me/brews',
      'https://github.com/me/brews/tree/main/dir',
      'https://github.com/me/brews/blob/main',
      'https://gist.github.com/me/abc123',
    ]) {
      expect(checkHomebrewUrl(url)).toEqual({ ok: false, reason: REFUSED_HOST_REASON });
    }
  });

  it('refuses any other host', () => {
    expect(checkHomebrewUrl('https://example.com/brew.json')).toEqual({
      ok: false,
      reason: REFUSED_HOST_REASON,
    });
  });

  it('compares whole origins, not host prefixes or substrings', () => {
    for (const url of [
      'https://raw.githubusercontent.com.example.com/x.json',
      'https://evilraw.githubusercontent.com/x.json',
      'https://raw.githubusercontent.com:8443/x.json',
      'https://example.com/https://raw.githubusercontent.com/x.json',
    ]) {
      expect(checkHomebrewUrl(url).ok, url).toBe(false);
    }
  });

  it('refuses plain http, even to an allowed host', () => {
    expect(checkHomebrewUrl('http://raw.githubusercontent.com/a/b/main/x.json')).toEqual({
      ok: false,
      reason: 'Only https URLs are fetched.',
    });
  });

  it('refuses credentials in the URL', () => {
    for (const url of [
      'https://user@raw.githubusercontent.com/a/b/main/x.json',
      'https://user:pw@raw.githubusercontent.com/a/b/main/x.json',
      'https://raw.githubusercontent.com@example.com/x.json',
    ]) {
      expect(checkHomebrewUrl(url).ok, url).toBe(false);
    }
  });

  it('refuses text that is not a URL', () => {
    expect(checkHomebrewUrl('raw.githubusercontent.com/a/b/main/x.json').ok).toBe(false);
    expect(checkHomebrewUrl('').ok).toBe(false);
  });
});
