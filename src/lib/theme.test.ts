// @vitest-environment jsdom
// DS-001: the boot script draws the first frame and this module every frame
// after it, so the two must agree on every stored choice and device setting,
// or the page would change theme as the app loads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installThemeSync,
  readThemeChoice,
  resolveTheme,
  setThemeChoice,
  THEME_COLOR,
  THEME_KEY,
} from './theme';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BOOT = readFileSync(path.join(ROOT, 'public/theme-boot.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'src/styles/app.css'), 'utf8');

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
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme boot script (DS-001)', () => {
  for (const stored of [null, 'system', 'light', 'dark', 'sepia']) {
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

  it("colours the bars with each theme's page colour from app.css", () => {
    const bg = (selector: string) => {
      const block = CSS.slice(CSS.indexOf(selector));
      return /--cg-bg:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
    };
    expect(THEME_COLOR.dark).toBe(bg('[data-theme="dark"] {'));
    expect(THEME_COLOR.light).toBe(bg('[data-theme="light"] {'));
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
