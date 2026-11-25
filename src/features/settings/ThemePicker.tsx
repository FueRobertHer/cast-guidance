import { type CSSProperties, type ReactNode, useId } from 'react';
import {
  customChoice,
  type SavedTheme,
  setThemeChoice,
  THEME_CHOICES,
  type Theme,
  type ThemeChoice,
  useSavedThemes,
  useThemeChoice,
} from '@/lib/theme';
import { useThemeFonts } from '@/lib/useThemeFonts';
import { builtInTheme } from '@/theme/builtins';
import { themeAttrs, themeFontIds, themeVars } from '@/theme/file';

/** A bar in a miniature: a card, or the action blue when `brand`. */
function Bar({ brand = false }: { brand?: boolean }) {
  return (
    <span
      className={`block h-3.5 rounded-tick ${brand ? 'w-1/2 bg-brand' : 'bg-surface ring ring-line ring-inset'}`}
    />
  );
}

/**
 * A tiny sheet drawn in one theme: its title font, a card and its action
 * colour, at its own corners and edges. `data-theme` scopes a built-in's
 * tokens to it, which works because the utilities read the raw `--cg-*`
 * variables where they are used (`@theme inline` in app.css); a saved theme
 * is its base with its own values set on the same element.
 */
export function ThemeMini({
  theme,
  vars,
  attrs,
  fonts = [],
}: {
  theme: Theme;
  vars?: Record<string, string>;
  /** Its decor (decor.css), as `data-cg-*` attributes. */
  attrs?: Record<string, string>;
  /** The fonts it names, so a library font's faces are fetched for it. */
  fonts?: readonly unknown[];
}) {
  useThemeFonts(fonts);
  return (
    <span
      data-theme={theme}
      {...attrs}
      style={vars as CSSProperties | undefined}
      className="flex h-18 w-full flex-col justify-between overflow-hidden rounded-thumb bg-bg p-2 ring ring-line ring-inset"
    >
      {/* The option's name is the label's text; this is only the font. */}
      <span aria-hidden="true" className="font-display text-title-card leading-none text-ink">
        Aa
      </span>
      <span className="flex flex-col gap-1.25">
        <Bar />
        <Bar brand />
      </span>
    </span>
  );
}

function HalfMini({ theme }: { theme: Theme }) {
  return (
    <span data-theme={theme} className="flex flex-1 flex-col gap-1.25 bg-bg px-1.5 py-2">
      <Bar />
      <Bar />
      <Bar brand />
    </span>
  );
}

function Option({
  name,
  value,
  checked,
  label,
  note,
  children,
}: {
  name: string;
  value: ThemeChoice;
  checked: boolean;
  label: string;
  /** A line under the name, read after it. */
  note?: string;
  children: ReactNode;
}) {
  const noteId = useId();
  return (
    <label className="relative flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-control bg-surface px-2 pt-2 pb-3 text-center text-label text-ink ring ring-line ring-inset has-checked:ring-strong has-checked:ring-ink has-focus-visible:outline-2 has-focus-visible:outline-focus has-focus-visible:outline-offset-2">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => setThemeChoice(value)}
        aria-describedby={note === undefined ? undefined : noteId}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-control opacity-0"
      />
      {children}
      <span className="w-full break-words">{label}</span>
      {note !== undefined && (
        // Read as the radio's description, not as part of its name, which the
        // label around it would otherwise make it.
        <span id={noteId} aria-hidden="true" className="w-full text-caption text-ink-muted">
          {note}
        </span>
      )}
    </label>
  );
}

/** One of the player's own themes, which says so when its fonts are not on this device yet. */
function SavedOption({
  name,
  theme,
  checked,
}: {
  name: string;
  theme: SavedTheme;
  checked: boolean;
}) {
  const fonts = themeFontIds(theme.file);
  const missing = useThemeFonts(fonts) === 'missing';
  return (
    <Option
      name={name}
      value={customChoice(theme.id)}
      checked={checked}
      label={theme.file.name}
      note={missing ? 'Its fonts download when you’re online' : undefined}
    >
      <ThemeMini
        theme={theme.file.base}
        vars={themeVars(theme.file)}
        attrs={themeAttrs(theme.file)}
        fonts={fonts}
      />
    </Option>
  );
}

/**
 * System, a built-in theme (DS-001, src/theme/builtins.ts) or one of the
 * player's own (a theme file, saved here), each a radio card with the theme
 * drawn in it; System is split down the middle. The choice is a device
 * preference, not character data: `setThemeChoice` stores it and applies it
 * at once, and the boot script applies it before the next first paint.
 *
 * Native radios, so arrow keys move the choice and a screen reader hears
 * "Theme, radio group" without any ARIA of our own. Each lies transparent over
 * its whole card rather than shrunk to `sr-only`: the focused element's box is
 * what the browser scrolls clear of the tab bar, and a 1px one can leave the
 * card under it (WCAG 2.4.11). The card draws the selected border and the
 * focus ring for its input.
 */
export function ThemePicker() {
  const choice = useThemeChoice();
  const saved: readonly SavedTheme[] = useSavedThemes();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-2">
        {THEME_CHOICES.map((option) => (
          <Option
            key={option}
            name={name}
            value={option}
            checked={choice === option}
            label={option === 'system' ? 'System' : builtInTheme(option).label}
          >
            {option === 'system' ? (
              <span className="flex h-18 w-full overflow-hidden rounded-thumb ring ring-line ring-inset">
                <HalfMini theme="dark" />
                <HalfMini theme="light" />
              </span>
            ) : (
              <ThemeMini theme={option} />
            )}
          </Option>
        ))}
        {saved.map((theme) => (
          <SavedOption
            key={theme.id}
            name={name}
            theme={theme}
            checked={choice === customChoice(theme.id)}
          />
        ))}
      </div>
      <p className="text-caption text-ink-muted">
        System follows your device&rsquo;s light or dark setting.
      </p>
    </fieldset>
  );
}
