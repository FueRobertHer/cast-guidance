// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no font loading API: a stand-in that loads or fails on command.
class FakeFace {
  static fail = new Set<string>();
  status: 'unloaded' | 'loaded' | 'error' = 'unloaded';
  readonly family: string;
  readonly source: string;
  readonly descriptors: { weight?: string; display?: string };
  constructor(family: string, source: string, descriptors: { weight?: string; display?: string }) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  load(): Promise<this> {
    if (FakeFace.fail.has(this.family)) {
      this.status = 'error';
      return Promise.reject(new Error('NetworkError'));
    }
    this.status = 'loaded';
    return Promise.resolve(this);
  }
}

let fonts: Set<FakeFace>;

async function loader() {
  vi.resetModules();
  return import('./libraryFonts');
}

beforeEach(() => {
  FakeFace.fail = new Set();
  fonts = new Set();
  vi.stubGlobal('FontFace', FakeFace);
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

describe('library fonts on demand', () => {
  it('adds nothing for the app’s own fonts, the device’s, or names it does not know', async () => {
    const { loadThemeFonts } = await loader();
    expect(await loadThemeFonts(['literata', 'system', 'papyrus', 42, undefined])).toBe(true);
    expect(fonts.size).toBe(0);
  });

  it('adds a library font’s faces once, by family and weight, and loads them', async () => {
    const { loadThemeFonts } = await loader();
    expect(await loadThemeFonts(['eb-garamond', 'cinzel', 'eb-garamond'])).toBe(true);
    const added = [...fonts].map((f) => `${f.family} ${f.descriptors.weight}`);
    expect(added).toEqual([
      'EB Garamond 400',
      'EB Garamond 600',
      'EB Garamond 700',
      'Cinzel 400',
      'Cinzel 600',
      'Cinzel 700',
    ]);
    expect([...fonts].every((f) => f.status === 'loaded' && f.descriptors.display === 'swap')).toBe(
      true,
    );
    expect([...fonts].every((f) => /^url\(".+\.woff2"\) format\("woff2"\)$/.test(f.source))).toBe(
      true,
    );
    await loadThemeFonts(['cinzel']);
    expect(fonts.size).toBe(6);
  });

  it('says when a face could not be fetched, and tries it afresh next time', async () => {
    const { loadThemeFonts } = await loader();
    FakeFace.fail.add('Lexend');
    expect(await loadThemeFonts(['lexend'])).toBe(false);
    const failed = [...fonts];
    expect(failed.every((f) => f.status === 'error')).toBe(true);

    FakeFace.fail.clear();
    expect(await loadThemeFonts(['lexend'])).toBe(true);
    expect([...fonts].some((f) => failed.includes(f))).toBe(false);
    expect(fonts.size).toBe(3);
  });

  it('does nothing where the browser has no font loading API', async () => {
    vi.stubGlobal('FontFace', undefined);
    const { loadThemeFonts } = await loader();
    expect(await loadThemeFonts(['fraunces'])).toBe(true);
    expect(fonts.size).toBe(0);
  });
});
