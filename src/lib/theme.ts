import { useSyncExternalStore } from 'react';
import { BUILT_IN_THEMES, type BuiltInThemeId, isBuiltInTheme } from '@/theme/builtins';

/**
 * The colour theme (DS-001). The player picks System or one of the built-in
 * themes (src/theme/builtins.ts) in Settings; the choice is a preference of
 * this device, not character data, so it lives in localStorage, where the
 * boot script can read it synchronously.
 *
 * `public/theme-boot.js` applies the stored choice before first paint, since
 * the app's own bundle runs too late to stop a flash of the wrong theme and
 * the enforced CSP allows no inline script (docs/security-headers.md). This
 * module applies a new choice, and keeps the page in step afterwards: a System
 * choice follows the device's setting as it changes, and a choice made in
 * another tab arrives through the `storage` event. `theme.test.ts` holds the
 * boot script and this module to the same answers.
 */

/** What the page is drawn in, as `data-theme` on <html>. */
export type Theme = BuiltInThemeId;

/** What the player chose: System follows the device between Dark and Light. */
export type ThemeChoice = 'system' | Theme;

export const THEME_KEY = 'cast-guidance:theme';

/** Settings' order: System first, since it is the one that needs no thought. */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  'system',
  ...BUILT_IN_THEMES.map((t) => t.id),
];

/** Each theme's page colour, for `<meta name="theme-color">` (builtins.ts). */
export const THEME_COLOR: Readonly<Record<Theme, string>> = Object.fromEntries(
  BUILT_IN_THEMES.map((t) => [t.id, t.pageColour]),
) as Record<Theme, string>;

/** Dark is the original, and stays the default for anyone who has not chosen. */
const DEFAULT_CHOICE: ThemeChoice = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || isBuiltInTheme(value);
}

/**
 * A choice this tab made that storage refused (blocked, or full). Without it
 * Settings would go on showing the stored choice under a page drawn in the new
 * one, and picking the stored one again would change nothing.
 */
let unstored: ThemeChoice | null = null;

/** The stored choice, or the default when there is none or storage is unavailable. */
export function readThemeChoice(): ThemeChoice {
  if (unstored !== null) return unstored;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isChoice(stored) ? stored : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function prefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches;
}

/** The theme a choice draws in, given whether the device asks for light. */
export function resolveTheme(choice: ThemeChoice, deviceLight: boolean = prefersLight()): Theme {
  if (choice === 'system') return deviceLight ? 'light' : 'dark';
  return choice;
}

/** Draws the page in `theme` and colours the browser's bars to match. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Stores and applies a new choice. */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
    unstored = null;
  } catch {
    // Unremembered: this tab keeps it until it closes, and the next visit
    // draws whatever was stored before.
    unstored = choice;
  }
  applyTheme(resolveTheme(choice));
  notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The stored choice, re-rendering when it changes here or in another tab. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readThemeChoice, () => DEFAULT_CHOICE);
}

/**
 * Keeps the page in the chosen theme for as long as the app runs: re-applies
 * a System choice when the device switches, and any choice another tab makes.
 * Returns the cleanup. Mounted once, by the app shell.
 */
export function installThemeSync(): () => void {
  const media = typeof matchMedia === 'function' ? matchMedia(LIGHT_QUERY) : undefined;
  const onDevice = () => {
    if (readThemeChoice() === 'system') applyTheme(resolveTheme('system'));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    // A choice another tab managed to store outranks this tab's unstored one.
    unstored = null;
    applyTheme(resolveTheme(readThemeChoice()));
    notify();
  };
  media?.addEventListener('change', onDevice);
  window.addEventListener('storage', onStorage);
  // The boot script ran before this module loaded; applying again here costs
  // nothing and covers a page whose boot script was blocked or failed.
  applyTheme(resolveTheme(readThemeChoice()));
  return () => {
    media?.removeEventListener('change', onDevice);
    window.removeEventListener('storage', onStorage);
  };
}
