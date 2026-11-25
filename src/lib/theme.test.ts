// @vitest-environment jsdom
// DS-001: the boot script draws the first frame and this module every frame
// after it, so the two must agree on every stored choice and device setting,
// or the page would change theme as the app loads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_THEMES } from '@/theme/builtins';
import type { ThemeFile } from '@/theme/file';
import { themeTokens } from '../../tests-fixtures/themeCss';
import {
  APPLIED_KEY,
  customChoice,
  deleteTheme,
  endPreview,
  installThemeSync,
  keepPreview,
  previewTheme,
  readSavedThemes,
  readThemeChoice,
  resolveTheme,
  restoreTheme,
  saveTheme,
  setThemeChoice,
  THEME_COLOR,
  THEME_KEY,
  THEMES_KEY,
  updateTheme,
} from './theme';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BOOT = readFileSync(path.join(ROOT, 'public/theme-boot.js'), 'utf8');

/** A device that does or does not ask for light, with its change listeners. */
function device(light: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return light;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return {
    switchTo(next: boolean) {
      light = next;
      for (const fn of listeners) fn();
    },
  };
}

function runBoot(): void {
  // The file as shipped: a classic script, run once in the page's scope.
  new Function(BOOT)();
}

const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  delete document.documentElement.dataset.theme;
  document.documentElement.removeAttribute('style');
  localStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme boot script (DS-001)', () => {
  for (const stored of [null, 'system', ...BUILT_IN_THEMES.map((t) => t.id), 'sepia', 'toString']) {
    for (const light of [false, true]) {
      it(`draws what the app would for ${stored ?? 'nothing stored'} on a ${light ? 'light' : 'dark'} device`, () => {
        device(light);
        if (stored !== null) localStorage.setItem(THEME_KEY, stored);
        runBoot();
        const expected = resolveTheme(readThemeChoice(), light);
        expect(document.documentElement.dataset.theme).toBe(expected);
        expect(meta()).toBe(THEME_COLOR[expected]);
      });
    }
  }

  it('falls back to dark when storage throws', () => {
    device(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    runBoot();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(readThemeChoice()).toBe('dark');
  });

  it.each(
    BUILT_IN_THEMES.map((t) => t.id),
  )("colours the bars with %s's page colour from themes.css", (id) => {
    expect(THEME_COLOR[id]).toBe(themeTokens(id).bg);
    expect(BOOT).toContain(`${id}: '${themeTokens(id).bg}'`);
  });
});

describe('theme choice (DS-001)', () => {
  it('stores and applies a choice at once', () => {
    device(false);
    setThemeChoice('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(meta()).toBe(THEME_COLOR.light);
  });

  it('follows the device while the choice is System, and only then', () => {
    const screen = device(false);
    const stop = installThemeSync();
    setThemeChoice('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    screen.switchTo(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    setThemeChoice('dark');
    screen.switchTo(false);
    screen.switchTo(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
  });

  it('takes a choice made in another tab', () => {
    device(false);
    const stop = installThemeSync();
    localStorage.setItem(THEME_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
  });

  it('keeps a choice storage refused for as long as the tab is open', () => {
    const screen = device(false);
    const stop = installThemeSync();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    setThemeChoice('system');
    // Settings shows the choice the page is drawn in, so Dark can be picked again.
    expect(readThemeChoice()).toBe('system');
    screen.switchTo(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    vi.restoreAllMocks();
    localStorage.setItem(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
    expect(readThemeChoice()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
  });
});

const MIDNIGHT: ThemeFile = {
  castGuidanceTheme: 1,
  name: 'Midnight',
  base: 'dark',
  tokens: { bg: '#f4f0e8', ink: '#101418', 'font-display': 'alegreya', 'radius-pill': 'full' },
};

/** The page as drawn: its theme, its inline values, its scheme and its bar colour. */
function drawn() {
  const root = document.documentElement;
  const vars = Object.fromEntries(
    [...root.style]
      .filter((n) => n.startsWith('--cg-'))
      .map((n) => [n, root.style.getPropertyValue(n)]),
  );
  const decor = Object.fromEntries(
    [...root.attributes].filter((a) => a.name.startsWith('data-cg-')).map((a) => [a.name, a.value]),
  );
  return {
    theme: root.dataset.theme,
    vars,
    scheme: root.style.getPropertyValue('color-scheme'),
    bar: meta(),
    ...(Object.keys(decor).length === 0 ? {} : { decor }),
  };
}

function clearPage(): void {
  const root = document.documentElement;
  delete root.dataset.theme;
  root.removeAttribute('style');
  for (const { name } of [...root.attributes])
    if (name.startsWith('data-cg-')) root.removeAttribute(name);
}

describe("themes of one's own", () => {
  it('saves a copy when asked, even of a theme with the same content', () => {
    const first = saveTheme(MIDNIGHT).theme;
    const copy = saveTheme({ ...MIDNIGHT, name: 'Midnight 2' }, undefined, { copy: true });
    expect(copy).toMatchObject({ existing: false, stored: true });
    expect(copy.theme.id).not.toBe(first.id);
    expect(readSavedThemes()).toHaveLength(2);
  });

  it('saves a theme once, however often it is imported', () => {
    const first = saveTheme(MIDNIGHT);
    expect(first).toMatchObject({ stored: true, existing: false });
    const again = saveTheme({ ...MIDNIGHT, name: 'Midnight (copy)' });
    expect(again).toMatchObject({ stored: true, existing: true, theme: first.theme });
    expect(readSavedThemes()).toEqual([first.theme]);
  });

  it('draws a chosen theme as its base with its values on top, scheme and bar from its own page', () => {
    device(false);
    const { theme } = saveTheme(MIDNIGHT);
    setThemeChoice(customChoice(theme.id));
    expect(drawn()).toEqual({
      theme: 'dark',
      vars: {
        '--cg-bg': '#f4f0e8',
        '--cg-ink': '#101418',
        '--cg-font-display': '"Alegreya", "Literata", Georgia, serif',
        '--cg-radius-pill': 'calc(infinity * 1px)',
      },
      scheme: 'light',
      bar: '#f4f0e8',
    });
    // Back to a built-in, nothing of it is left on the page.
    setThemeChoice('light');
    expect(drawn()).toEqual({ theme: 'light', vars: {}, scheme: '', bar: THEME_COLOR.light });
    expect(localStorage.getItem(APPLIED_KEY)).toBeNull();
  });

  it('is drawn by the boot script before first paint, exactly as the app draws it', () => {
    device(false);
    const { theme } = saveTheme(MIDNIGHT);
    setThemeChoice(customChoice(theme.id));
    const app = drawn();
    clearPage();
    runBoot();
    expect(drawn()).toEqual(app);
  });

  it('draws Dark at first paint rather than a stale copy of another theme', () => {
    device(false);
    const a = saveTheme(MIDNIGHT).theme;
    const b = saveTheme({ ...MIDNIGHT, tokens: { bg: '#203040' } }).theme;
    setThemeChoice(customChoice(a.id));
    // Another tab, or a write storage refused, left the choice on B with A's copy.
    localStorage.setItem(THEME_KEY, customChoice(b.id));
    clearPage();
    runBoot();
    expect(drawn()).toEqual({ theme: 'dark', vars: {}, scheme: '', bar: THEME_COLOR.dark });
    // The app then draws B, and leaves the boot script B's copy.
    installThemeSync()();
    expect(drawn().vars['--cg-bg']).toBe('#203040');
    expect(JSON.parse(localStorage.getItem(APPLIED_KEY) ?? 'null')).toMatchObject({ id: b.id });
  });

  it('refuses a copy whose values could be anything but theme values', () => {
    device(false);
    const { theme } = saveTheme(MIDNIGHT);
    setThemeChoice(customChoice(theme.id));
    const applied = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '{}');
    for (const vars of [
      { '--cg-bg': 'red;}body{display:none' },
      { color: 'red' },
      { '--cg-bg': 7 },
    ]) {
      localStorage.setItem(APPLIED_KEY, JSON.stringify({ ...applied, vars }));
      clearPage();
      runBoot();
      expect(drawn(), JSON.stringify(vars)).toEqual({
        theme: 'dark',
        vars: {},
        scheme: '',
        bar: THEME_COLOR.dark,
      });
    }
  });

  it('falls back to Dark when the chosen theme is gone, and to its base when deleted here', () => {
    device(false);
    const { theme } = saveTheme(MIDNIGHT);
    setThemeChoice(customChoice(theme.id));
    const removed = deleteTheme(theme.id);
    expect(removed).toMatchObject({ wasChosen: true, index: 0 });
    expect(readThemeChoice()).toBe('dark');
    expect(drawn().vars).toEqual({});
    // Undo puts it back, chosen again.
    if (removed !== null) restoreTheme(removed);
    expect(readThemeChoice()).toBe(customChoice(theme.id));
    expect(drawn().vars['--cg-bg']).toBe('#f4f0e8');
    // Gone from storage by other means: the default.
    localStorage.setItem(THEMES_KEY, '[]');
    expect(readThemeChoice()).toBe('dark');
    expect(resolveTheme(customChoice(theme.id))).toBe('dark');
  });

  it('reads each saved theme again, dropping what this build does not accept', () => {
    localStorage.setItem(
      THEMES_KEY,
      JSON.stringify([
        { id: 'a', file: { ...MIDNIGHT, tokens: { bg: '#123456', 'radius-card': '99px' } } },
        { id: 'a', file: MIDNIGHT },
        { id: '../x', file: MIDNIGHT },
        { id: 'b', file: { castGuidanceTheme: 9 } },
        'junk',
      ]),
    );
    expect(readSavedThemes()).toEqual([
      { id: 'a', file: { ...MIDNIGHT, tokens: { bg: '#123456' } } },
    ]);
    localStorage.setItem(THEMES_KEY, '{not json');
    expect(readSavedThemes()).toEqual([]);
  });

  it('tries a theme in this tab only, until Keep stores it', () => {
    device(false);
    setThemeChoice('light');
    const { theme } = saveTheme(MIDNIGHT);
    previewTheme(theme);
    expect(drawn().vars['--cg-bg']).toBe('#f4f0e8');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    // A reload meanwhile draws the stored choice.
    clearPage();
    runBoot();
    expect(drawn().theme).toBe('light');
    previewTheme(theme);
    endPreview();
    expect(drawn()).toEqual({ theme: 'light', vars: {}, scheme: '', bar: THEME_COLOR.light });
    previewTheme(theme);
    keepPreview();
    expect(localStorage.getItem(THEME_KEY)).toBe(customChoice(theme.id));
    expect(drawn().vars['--cg-bg']).toBe('#f4f0e8');
  });
});

describe('a theme edited in place', () => {
  it('keeps its id, its place and its hand-set list, and draws again if in use', () => {
    device(false);
    const first = saveTheme(MIDNIGHT, ['bg']).theme;
    const second = saveTheme({ ...MIDNIGHT, tokens: { bg: '#203040' } }).theme;
    setThemeChoice(customChoice(first.id));
    const edited = { ...MIDNIGHT, name: 'Midnight II', tokens: { bg: '#334455' } };
    expect(updateTheme(first.id, edited, ['bg'])).toBe(true);
    expect(readSavedThemes()).toEqual([{ id: first.id, file: edited, own: ['bg'] }, second]);
    expect(drawn().vars['--cg-bg']).toBe('#334455');
    expect(updateTheme('nope', edited)).toBeNull();
  });

  it('reads a hand-set list back, keeping only names the file sets', () => {
    localStorage.setItem(
      THEMES_KEY,
      JSON.stringify([{ id: 'a', file: MIDNIGHT, own: ['bg', 'glow', 7] }]),
    );
    expect(readSavedThemes()[0]?.own).toEqual(['bg']);
  });
});

describe('deleting the theme being tried', () => {
  it('goes back to the stored choice, not stuck in a theme nothing names', () => {
    device(false);
    setThemeChoice('dark');
    const { theme } = saveTheme(MIDNIGHT);
    previewTheme(theme);
    expect(drawn().vars['--cg-bg']).toBe('#f4f0e8');
    deleteTheme(theme.id);
    expect(drawn()).toEqual({ theme: 'dark', vars: {}, scheme: '', bar: THEME_COLOR.dark });
    expect(readThemeChoice()).toBe('dark');
  });
});

describe('decor', () => {
  const DECORATED: ThemeFile = {
    ...MIDNIGHT,
    tokens: { ...MIDNIGHT.tokens, texture: 'grain', frame: 'stitched' },
  };

  it('draws a theme’s choices as attributes, never as values, the boot script as the app does', () => {
    device(false);
    const { theme } = saveTheme(DECORATED);
    setThemeChoice(customChoice(theme.id));
    const app = drawn();
    expect(app.decor).toEqual({ 'data-cg-texture': 'grain', 'data-cg-frame': 'stitched' });
    expect(Object.keys(app.vars).some((n) => n.includes('texture') || n.includes('frame'))).toBe(
      false,
    );
    clearPage();
    runBoot();
    expect(drawn()).toEqual(app);
    // Back to a built-in, they go.
    setThemeChoice('parchment');
    expect(drawn().decor).toBeUndefined();
  });

  it('refuses a copy whose decor could be anything but a named look', () => {
    device(false);
    const { theme } = saveTheme(DECORATED);
    setThemeChoice(customChoice(theme.id));
    const applied = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '{}');
    for (const attrs of [
      { onclick: 'x' },
      { 'data-cg-texture': 'url(x)' },
      { 'data-cg-frame': 7 },
    ]) {
      localStorage.setItem(APPLIED_KEY, JSON.stringify({ ...applied, attrs }));
      clearPage();
      runBoot();
      expect(drawn(), JSON.stringify(attrs)).toEqual({
        theme: 'dark',
        vars: {},
        scheme: '',
        bar: THEME_COLOR.dark,
      });
    }
  });
});

describe('?theme=reset', () => {
  it('goes back to Dark before first paint, and comes off the address', () => {
    device(true);
    const { theme } = saveTheme(MIDNIGHT);
    setThemeChoice(customChoice(theme.id));
    history.replaceState(null, '', '/c/abc/spells?theme=reset&x=1#top');
    clearPage();
    runBoot();
    expect(drawn()).toEqual({ theme: 'dark', vars: {}, scheme: '', bar: THEME_COLOR.dark });
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(localStorage.getItem(APPLIED_KEY)).toBeNull();
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/c/abc/spells?x=1#top');
    // The saved theme itself is kept, to pick again.
    expect(readSavedThemes()).toHaveLength(1);
  });
});
