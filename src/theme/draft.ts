import { BUILT_IN_THEMES, type BuiltInThemeId, builtInTheme, isBuiltInTheme } from './builtins';
import { ALIASES, derive, FOLLOWS, inferOwn, type Tokens } from './derive';
import {
  builtInFile,
  checkToken,
  cleanText,
  THEME_SCHEMA,
  type ThemeFile,
  type TokenValue,
} from './file';
import { TOKEN_NAMES } from './vocabulary';

/**
 * The theme editor's draft (docs/theming-plan.md, phase 4): the tokens the
 * person set by hand over a base built-in, everything else following or the
 * base's. Pure, apart from keeping the draft in localStorage, so the editor
 * page is only controls.
 */

export interface Draft {
  name: string;
  author: string;
  base: BuiltInThemeId;
  /** The tokens set by hand, each as a file holds it. */
  own: Readonly<Record<string, TokenValue>>;
}

/** Every built-in's tokens, read once from themes.css (builtInFile). */
export interface Tables {
  readonly byId: Readonly<Record<BuiltInThemeId, Tokens>>;
}

export function tablesFrom(css: string): Tables {
  return {
    byId: Object.fromEntries(
      BUILT_IN_THEMES.map((t) => [t.id, builtInFile(t.id, css).tokens]),
    ) as Record<BuiltInThemeId, Tokens>,
  };
}

function deriveFor(draft: Draft, tables: Tables, own: Tokens = draft.own) {
  return derive({
    own,
    base: tables.byId[draft.base],
    light: tables.byId.light,
    dark: tables.byId.dark,
  });
}

/** The tokens the draft writes: those set by hand and those following them. */
export function draftTokens(draft: Draft, tables: Tables): Record<string, TokenValue> {
  return { ...deriveFor(draft, tables), ...draft.own };
}

/** The draft as a theme file. */
export function draftFile(draft: Draft, tables: Tables): ThemeFile {
  const author = cleanText(draft.author);
  return {
    castGuidanceTheme: THEME_SCHEMA,
    name: cleanText(draft.name) || 'Untitled theme',
    ...(author === '' ? {} : { author }),
    base: draft.base,
    tokens: draftTokens(draft, tables),
  };
}

export interface Shown {
  value: TokenValue;
  /** Set by hand, following another token, or the base's own. */
  how: 'own' | 'follows' | 'base';
  /** The token it follows (`bg` for the page), when it follows one. */
  follows?: string;
}

/** A token as the editor shows it. */
export function shown(draft: Draft, tables: Tables, name: string): Shown {
  const own = draft.own[name];
  if (own !== undefined) return { value: own, how: 'own' };
  const alias = ALIASES[name];
  if (alias !== undefined)
    return { ...shown(draft, tables, alias), how: 'follows', follows: alias };
  const derived = deriveFor(draft, tables)[name];
  if (derived !== undefined) return { value: derived, how: 'follows', follows: FOLLOWS[name]?.[0] };
  return { value: tables.byId[draft.base][name] ?? '', how: 'base' };
}

export type Edit = { draft: Draft } | { error: string };

/**
 * Sets a token by hand, checked as a file's would be. The selected edge has to
 * stay wider than the resting one, or selection vanishes.
 */
export function setToken(draft: Draft, tables: Tables, name: string, raw: unknown): Edit {
  const checked = checkToken(name, raw);
  if ('error' in checked) return { error: checked.error };
  const own = { ...draft.own, [name]: checked.value };
  if (name === 'border' || name === 'border-strong') {
    const next = { ...draft, own };
    const px = (n: string) => Number.parseFloat(String(shown(next, tables, n).value));
    if (px('border-strong') <= px('border')) {
      return { error: 'The selected edge must be wider than the resting one.' };
    }
  }
  return { draft: { ...draft, own } };
}

/** Hands a token back to its base, or to what it follows. */
export function resetToken(draft: Draft, name: string): Draft {
  const { [name]: _gone, ...own } = draft.own;
  return { ...draft, own };
}

/** Starts from another built-in, keeping every token set by hand. */
export function setBase(draft: Draft, base: BuiltInThemeId): Draft {
  return { ...draft, base };
}

/**
 * A saved theme opened for editing: the tokens set by hand are the list saved
 * beside it, or, for a theme with none (an imported file), those whose value
 * is not what following would give.
 */
export function draftFromTheme(
  file: ThemeFile,
  tables: Tables,
  ownNames?: readonly string[],
): Draft {
  const names =
    ownNames?.filter((n) => n in file.tokens) ??
    inferOwn(file.tokens, {
      base: tables.byId[file.base],
      light: tables.byId.light,
      dark: tables.byId.dark,
    });
  return {
    name: file.name,
    author: file.author ?? '',
    base: file.base,
    own: Object.fromEntries(names.map((n) => [n, file.tokens[n] as TokenValue])),
  };
}

/** A new theme from a built-in: its name, a copy, nothing set yet. */
export function draftFromBuiltIn(id: BuiltInThemeId): Draft {
  return { name: `${builtInTheme(id).label} copy`, author: '', base: id, own: {} };
}

/** Whether two drafts would save the same theme. */
export function sameDraft(a: Draft, b: Draft): boolean {
  const key = (d: Draft) =>
    JSON.stringify([
      d.name,
      d.author,
      d.base,
      Object.keys(d.own)
        .sort()
        .map((k) => [k, d.own[k]]),
    ]);
  return key(a) === key(b);
}

// --- Undo -------------------------------------------------------------------

export interface History {
  past: readonly Draft[];
  present: Draft;
}

/** How many changes Undo keeps. */
const UNDO_DEPTH = 100;

export function startHistory(draft: Draft): History {
  return { past: [], present: draft };
}

export function commit(history: History, next: Draft): History {
  if (sameDraft(history.present, next)) return { ...history, present: next };
  return { past: [...history.past, history.present].slice(-UNDO_DEPTH), present: next };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  return previous === undefined ? history : { past: history.past.slice(0, -1), present: previous };
}

// --- Kept on the device while editing ---------------------------------------

export const DRAFT_KEY = 'cast-guidance:theme-draft';

interface Kept {
  v: 1;
  /** The saved theme being edited, or null for a new one. */
  target: string | null;
  draft: Draft;
}

/** Keeps the draft, so a tab the phone closed can pick up where it was. */
export function keepDraft(target: string | null, draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, target, draft } satisfies Kept));
  } catch {
    // Not kept: the editor still works, it just cannot be resumed.
  }
}

export function dropKeptDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to drop.
  }
}

/** The draft kept for `target`, every value checked again, or null. */
export function readKeptDraft(target: string | null): Draft | null {
  try {
    const kept = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Kept> | null;
    if (kept?.v !== 1 || kept.target !== target || typeof kept.draft !== 'object') return null;
    const d = kept.draft as Partial<Draft>;
    if (!isBuiltInTheme(d.base)) return null;
    const own: Record<string, TokenValue> = {};
    for (const [name, raw] of Object.entries(d.own ?? {})) {
      if (!TOKEN_NAMES.has(name)) continue;
      const checked = checkToken(name, raw);
      if ('value' in checked) own[name] = checked.value;
    }
    return {
      name: typeof d.name === 'string' ? d.name.slice(0, 200) : '',
      author: typeof d.author === 'string' ? d.author.slice(0, 200) : '',
      base: d.base,
      own,
    };
  } catch {
    return null;
  }
}
