import { describe, expect, it } from 'vitest';
import { hasThemeHash, MAX_THEME_BYTES, readThemeHash, themeHash, themeLink } from './link';

const FILE = {
  castGuidanceTheme: 1,
  name: 'Midnight ✦',
  base: 'dark',
  tokens: { bg: '#101418', 'font-display': 'alegreya', 'radius-card': '6px' },
};

async function deflated(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('a theme as a link', () => {
  it('round-trips a file, names in any script included', async () => {
    const hash = await themeHash(FILE);
    expect(hash).toMatch(/^theme=1\.[\w-]+$/);
    expect(await readThemeHash(`#${hash}`)).toEqual(FILE);
    expect(await readThemeHash(hash)).toEqual(FILE);
  });

  it('puts it on the Settings page, in the hash', async () => {
    const link = await themeLink(FILE, 'https://example.test');
    expect(link).toMatch(/^https:\/\/example\.test\/settings#theme=1\.[\w-]+$/);
    expect(hasThemeHash(new URL(link).hash)).toBe(true);
    expect(hasThemeHash('#section')).toBe(false);
  });

  it('keeps a full theme short enough to paste', async () => {
    const tokens = Object.fromEntries(
      Array.from({ length: 74 }, (_, i) => [
        `token-${i}`,
        `#${(i * 99991).toString(16).padStart(6, '0').slice(0, 6)}`,
      ]),
    );
    expect((await themeHash({ ...FILE, tokens })).length).toBeLessThan(2000);
  });

  it('reads nothing from junk, a wrong prefix or text that is not JSON', async () => {
    expect(await readThemeHash('#theme=')).toBeNull();
    expect(await readThemeHash('#theme=1.')).toBeNull();
    expect(await readThemeHash('#theme=1.not base64!')).toBeNull();
    expect(await readThemeHash('#theme=1.AAAA')).toBeNull();
    expect(await readThemeHash('#other=abc')).toBeNull();
    expect(await readThemeHash(`#theme=1.${await deflated('{"oops"')}`)).toBeNull();
    // An encoding this build does not know.
    expect(await readThemeHash(`#theme=2.${await deflated('{}')}`)).toBeNull();
  });

  it('stops inflating past the size limit, however small the link', async () => {
    const bomb = `#theme=1.${await deflated(' '.repeat(MAX_THEME_BYTES + 1))}`;
    expect(bomb.length).toBeLessThan(400);
    expect(await readThemeHash(bomb)).toBeNull();
  });
});
