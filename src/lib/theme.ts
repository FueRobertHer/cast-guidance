import { useSyncExternalStore } from 'react';
import { BUILT_IN_THEMES, type BuiltInThemeId, isBuiltInTheme } from '@/theme/builtins';
import {
  parseThemeFile,
  type ThemeFile,
  themeKey,
  themePageColour,
  themeScheme,
  themeVars,
} from '@/theme/file';

/**
 * The colour theme (DS-001, docs/theming-plan.md). The player picks System,
 * one of the built-in themes (src/theme/builtins.ts) or a theme of their own
 * (a theme file, src/theme/file.ts) in Settings; the choice is a preference of
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
 *
 * A theme of one's own draws as its base built-in (`data-theme`) with each of
 * its tokens set inline on <html>. The boot script cannot read theme files,
 * so this module keeps what it needs in `APPLIED_KEY`, rebuilt from the saved
 * file at every start.
 */

/** What the page is drawn in, as `data-theme` on <html>: a built-in theme. */
export type Theme = BuiltInThemeId;

/** A saved theme's choice. */
export type CustomChoice = `custom:${string}`;

/** What the player chose: System follows the device between Dark and Light. */
export type ThemeChoice = 'system' | Theme | CustomChoice;

export const THEME_KEY = 'cast-guidance:theme';
/** The saved themes: `[{ id, file }]`. */
export const THEMES_KEY = 'cast-guidance:themes';
/** The active saved theme, as the boot script draws it (`AppliedTheme`). */
export const APPLIED_KEY = 'cast-guidance:theme-applied';

/** Settings' order: System first, since it is the one that needs no thought. */
export const THEME_CHOICES: readonly ('system' | Theme)[] = [
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

export interface SavedTheme {
  readonly id: string;
  readonly file: ThemeFile;
}

/**
 * What the boot script reads to draw a saved theme before first paint. `v`
 * is this shape's version; `attrs` waits for decor (phase 5).
 */
export interface AppliedTheme {
  v: 1;
  id: string;
  base: Theme;
  scheme: 'light' | 'dark';
  pageColour: string;
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

export function customChoice(id: string): CustomChoice {
  return `custom:${id}`;
}

function customId(choice: ThemeChoice): string | null {
  return choice.startsWith('custom:') ? choice.slice('custom:'.length) : null;
}

// --- The saved themes -------------------------------------------------------

/** The list as last read, kept while storage holds the same text. */
let saved: { raw: string | null; list: readonly SavedTheme[] } = { raw: null, list: [] };
/** A list this tab saved that storage refused; it lasts until the tab closes. */
let unstoredThemes: readonly SavedTheme[] | null = null;

/**
 * The saved themes, each read again as a theme file, so a file saved by an
 * older build meets this one's bounds and migrations.
 */
export function readSavedThemes(): readonly SavedTheme[] {
  if (unstoredThemes !== null) return unstoredThemes;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(THEMES_KEY);
  } catch {
    return saved.list;
  }
  if (raw === saved.raw) return saved.list;
  const list: SavedTheme[] = [];
  try {
    const entries: unknown = raw === null ? [] : JSON.parse(raw);
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = (entry as { id?: unknown })?.id;
      if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || list.some((t) => t.id === id)) {
        continue;
      }
      const result = parseThemeFile((entry as { file?: unknown }).file);
      if (result.ok) list.push({ id, file: result.theme.file });
    }
  } catch {
    // Unreadable: as if none were saved.
  }
  saved = { raw, list };
  return list;
}

function writeSavedThemes(list: readonly SavedTheme[]): boolean {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(list));
    unstoredThemes = null;
    return true;
  } catch {
    unstoredThemes = list;
    return false;
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Saves `file` to Your themes and returns it, or the theme already saved with
 * the same content (a file imported twice is one theme). `stored` is false
 * when storage refused it: it lasts until this tab closes.
 */
export function saveTheme(file: ThemeFile): {
  theme: SavedTheme;
  stored: boolean;
  existing: boolean;
} {
  const list = readSavedThemes();
  const key = themeKey(file);
  const same = list.find((t) => themeKey(t.file) === key);
  if (same !== undefined) return { theme: same, stored: unstoredThemes === null, existing: true };
  const theme: SavedTheme = { id: newId(), file };
  const stored = writeSavedThemes([...list, theme]);
  notify();
  return { theme, stored, existing: false };
}

/**
 * Removes a saved theme. If it was the theme in use, the page falls back to
 * its base. Returns what it removed, for Undo (`restoreTheme`).
 */
export function deleteTheme(
  id: string,
): { theme: SavedTheme; index: number; wasChosen: boolean } | null {
  const list = readSavedThemes();
  const index = list.findIndex((t) => t.id === id);
  const theme = list[index];
  if (theme === undefined) return null;
  const wasChosen = readThemeChoice() === customChoice(id);
  const wasTried = preview?.id === id;
  writeSavedThemes(list.filter((t) => t.id !== id));
  if (wasChosen) setThemeChoice(theme.file.base);
  else {
    // Deleting the theme being tried ends the try: the page goes back to the
    // stored choice, or it would stay drawn in a theme nothing names.
    if (wasTried) {
      preview = null;
      applyChoice(readThemeChoice());
    }
    notify();
  }
  return { theme, index, wasChosen };
}

/** Puts a deleted theme back where it was, chosen again if it was. */
export function restoreTheme(removed: {
  theme: SavedTheme;
  index: number;
  wasChosen: boolean;
}): void {
  const list = [...readSavedThemes()];
  if (!list.some((t) => t.id === removed.theme.id)) {
    list.splice(Math.min(removed.index, list.length), 0, removed.theme);
    writeSavedThemes(list);
  }
  if (removed.wasChosen) setThemeChoice(customChoice(removed.theme.id));
  else notify();
}

export function savedTheme(id: string): SavedTheme | undefined {
  return readSavedThemes().find((t) => t.id === id);
}

// --- The choice -------------------------------------------------------------

function isChoice(value: unknown): value is ThemeChoice {
  if (value === 'system' || isBuiltInTheme(value)) return true;
  if (typeof value !== 'string') return false;
  const id = customId(value as ThemeChoice);
  return id !== null && savedTheme(id) !== undefined;
}

/**
 * A choice this tab made that storage refused (blocked, or full). Without it
 * Settings would go on showing the stored choice under a page drawn in the new
 * one, and picking the stored one again would change nothing.
 */
let unstored: ThemeChoice | null = null;

/**
 * The stored choice, or the default when there is none, storage is
 * unavailable, or it names a saved theme that is gone.
 */
export function readThemeChoice(): ThemeChoice {
  if (unstored !== null && isChoice(unstored)) return unstored;
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

/** The built-in a choice draws as, given whether the device asks for light. */
export function resolveTheme(choice: ThemeChoice, deviceLight: boolean = prefersLight()): Theme {
  if (choice === 'system') return deviceLight ? 'light' : 'dark';
  const id = customId(choice);
  if (id === null) return choice as Theme;
  return savedTheme(id)?.file.base ?? 'dark';
}

/** What the boot script needs to draw `theme` before first paint. */
export function appliedTheme(theme: SavedTheme): AppliedTheme {
  return {
    v: 1,
    id: theme.id,
    base: theme.file.base,
    scheme: themeScheme(theme.file),
    pageColour: themePageColour(theme.file),
    vars: themeVars(theme.file),
    attrs: {},
  };
}

/** Takes every inline `--cg-*` and colour scheme off <html>. */
function clearInline(root: HTMLElement): void {
  for (const name of [...root.style]) {
    if (name.startsWith('--cg-')) root.style.removeProperty(name);
  }
  root.style.removeProperty('color-scheme');
}

/** Draws the page in a built-in theme and colours the browser's bars to match. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  clearInline(root);
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

/** Draws the page in a saved theme: its base, with its own values set over it. */
function applySaved(theme: SavedTheme): AppliedTheme {
  const applied = appliedTheme(theme);
  const root = document.documentElement;
  clearInline(root);
  root.dataset.theme = applied.base;
  for (const [name, value] of Object.entries(applied.vars)) root.style.setProperty(name, value);
  root.style.setProperty('color-scheme', applied.scheme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', applied.pageColour);
  return applied;
}

/**
 * Draws `choice`, and keeps the boot script's copy of a saved theme in step
 * with it (or drops it for a built-in), so the next first paint matches.
 */
function applyChoice(choice: ThemeChoice): void {
  const id = customId(choice);
  const theme = id === null ? undefined : savedTheme(id);
  try {
    if (theme === undefined) {
      applyTheme(resolveTheme(choice));
      localStorage.removeItem(APPLIED_KEY);
    } else {
      localStorage.setItem(APPLIED_KEY, JSON.stringify(applySaved(theme)));
    }
  } catch {
    // Unstored: the boot script draws the base until it can be written.
  }
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Stores and applies a new choice, ending any preview. */
export function setThemeChoice(choice: ThemeChoice): void {
  preview = null;
  try {
    localStorage.setItem(THEME_KEY, choice);
    unstored = null;
  } catch {
    // Unremembered: this tab keeps it until it closes, and the next visit
    // draws whatever was stored before.
    unstored = choice;
  }
  applyChoice(choice);
  notify();
}

// --- Trying a theme before keeping it -------------------------------------

/** How long a theme being tried lasts before it goes back by itself (ThemeKeepBanner). */
export const TRY_SECONDS = 30;

/** A saved theme drawn in this tab only, until Keep stores it or it reverts. */
let preview: SavedTheme | null = null;

/**
 * Draws `theme` in this tab without storing the choice, so a reload, or
 * `endPreview`, goes back to the stored one. `keepPreview` stores it.
 */
export function previewTheme(theme: SavedTheme): void {
  preview = theme;
  applySaved(theme);
  notify();
}

export function keepPreview(): void {
  if (preview !== null) setThemeChoice(customChoice(preview.id));
}

export function endPreview(): void {
  if (preview === null) return;
  preview = null;
  applyChoice(readThemeChoice());
  notify();
}

export function readPreview(): SavedTheme | null {
  return preview;
}

// --- React ------------------------------------------------------------------

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The choice the page is drawn in (a preview's, while one runs), re-rendering as it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => (preview === null ? readThemeChoice() : customChoice(preview.id)),
    () => DEFAULT_CHOICE,
  );
}

const NONE: readonly SavedTheme[] = [];

/** The saved themes, re-rendering as they change here or in another tab. */
export function useSavedThemes(): readonly SavedTheme[] {
  return useSyncExternalStore(subscribe, readSavedThemes, () => NONE);
}

/** The theme being tried, or null. */
export function usePreview(): SavedTheme | null {
  return useSyncExternalStore(subscribe, readPreview, () => null);
}

/**
 * Keeps the page in the chosen theme for as long as the app runs: re-applies
 * a System choice when the device switches, and any choice or saved theme
 * another tab changes. Rebuilds the boot script's copy of a saved theme from
 * its file, so a migration or a retuned base reaches the next first paint.
 * Returns the cleanup. Mounted once, by the app shell.
 */
export function installThemeSync(): () => void {
  const media = typeof matchMedia === 'function' ? matchMedia(LIGHT_QUERY) : undefined;
  const onDevice = () => {
    if (preview === null && readThemeChoice() === 'system') applyTheme(resolveTheme('system'));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== THEMES_KEY && event.key !== null) return;
    // A choice or list another tab managed to store outranks this tab's unstored one.
    unstored = null;
    unstoredThemes = null;
    if (preview !== null && savedTheme(preview.id) === undefined) preview = null;
    if (preview === null) applyChoice(readThemeChoice());
    notify();
  };
  media?.addEventListener('change', onDevice);
  window.addEventListener('storage', onStorage);
  // The boot script ran before this module loaded; applying again here costs
  // nothing, covers a page whose boot script was blocked or failed, and
  // rebuilds its copy of a saved theme.
  applyChoice(readThemeChoice());
  return () => {
    media?.removeEventListener('change', onDevice);
    window.removeEventListener('storage', onStorage);
  };
}
