import { downloadJson } from '@/lib/download';
import { resolveTheme, savedTheme, type ThemeChoice } from '@/lib/theme';
import {
  builtInFile,
  type ParseResult,
  parseThemeFile,
  parseThemeText,
  type ThemeFile,
} from '@/theme/file';
import { MAX_THEME_BYTES, readThemeHash, themeLink } from '@/theme/link';

/**
 * Getting a theme in and out of the app (docs/theme-format.md): a `.json`
 * file, or a link that carries the whole theme. Reading checks everything
 * (src/theme/file.ts) and decides nothing: the Settings page shows what came
 * in and asks before using it.
 */

/** A file someone picked. */
export async function readThemeFile(file: Blob): Promise<ParseResult> {
  if (file.size > MAX_THEME_BYTES) {
    return { ok: false, reason: 'This file is too large to be a theme.' };
  }
  return parseThemeText(await file.text());
}

/**
 * A theme link, whole or just its hash: what the address bar holds when one
 * is opened, or what someone pastes because the link opened in a browser
 * whose storage is not the installed app's.
 */
export async function readThemeLink(text: string): Promise<ParseResult> {
  const at = text.indexOf('#');
  const hash = at < 0 ? text.trim() : text.slice(at + 1).trim();
  const json = await readThemeHash(hash);
  return json === null
    ? { ok: false, reason: 'This link does not carry a theme. Copy the whole link and try again.' }
    : parseThemeFile(json);
}

/**
 * The theme a choice draws in, as a file: a saved theme's own, or a built-in
 * written out whole, which needs themes.css as text (loaded only now).
 */
export async function themeFileOf(choice: ThemeChoice): Promise<ThemeFile> {
  if (choice.startsWith('custom:')) {
    const theme = savedTheme(choice.slice('custom:'.length));
    if (theme !== undefined) return theme.file;
  }
  const css = (await import('@/styles/themes.css?raw')).default;
  return builtInFile(resolveTheme(choice), css);
}

/** Downloads `file` as `<name> theme.json`. */
export function downloadTheme(file: ThemeFile): void {
  downloadJson(`${file.name} theme`, file);
}

/**
 * Hands the theme's link to the share sheet where there is one, else copies
 * it. Says which, so the page can tell the person; `cancelled` when they
 * closed the share sheet.
 */
export async function shareTheme(file: ThemeFile): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = await themeLink(file);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `${file.name} theme`, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // No share target, or refused: copy instead.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
