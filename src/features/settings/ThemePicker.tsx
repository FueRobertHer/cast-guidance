import { useId } from 'react';
import {
  setThemeChoice,
  THEME_CHOICES,
  type Theme,
  type ThemeChoice,
  useThemeChoice,
} from '@/lib/theme';

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** A bar in a miniature: a card, or the action blue when `brand`. */
function Bar({ brand = false }: { brand?: boolean }) {
  return (
    <span
      className={`block h-3.5 rounded ${brand ? 'w-1/2 bg-brand' : 'bg-surface ring-1 ring-line ring-inset'}`}
    />
  );
}

/**
 * A tiny sheet drawn in one theme. `data-theme` scopes the theme's tokens to
 * it, which works because the colour utilities read the raw `--cg-*`
 * variables where they are used (`@theme inline` in app.css).
 */
function Mini({ theme, half = false }: { theme: Theme; half?: boolean }) {
  return (
    <span
      data-theme={theme}
      className={
        half
          ? 'flex flex-1 flex-col gap-1.25 bg-bg px-1.5 py-2'
          : 'flex h-18 w-full flex-col gap-1.25 overflow-hidden rounded-lg bg-bg p-2 ring-1 ring-line ring-inset'
      }
    >
      {!half && <Bar />}
      <Bar />
      <Bar brand />
    </span>
  );
}

/**
 * System, Light or Dark (DS-001), each a radio card with the theme drawn in
 * it; System is split down the middle. The choice is a device preference, not
 * character data: `setThemeChoice` stores it and applies it at once, and the
 * boot script applies it before the next first paint.
 *
 * Native radios, so arrow keys move the choice and a screen reader hears
 * "Theme, radio group" without any ARIA of our own. Each lies transparent over
 * its whole card rather than shrunk to `sr-only`: the focused element's box is
 * what the browser scrolls clear of the tab bar, and a 1px one can leave the
 * card under it (WCAG 2.4.11). The card draws the selected border (2px `ink`)
 * and the focus ring for its input.
 */
export function ThemePicker() {
  const choice = useThemeChoice();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-2">
        {THEME_CHOICES.map((option) => (
          <label
            key={option}
            className="relative flex cursor-pointer flex-col items-center gap-2 rounded-control bg-surface px-2 pt-2 pb-3 text-label text-ink ring-1 ring-line ring-inset has-checked:ring-2 has-checked:ring-ink has-focus-visible:outline-2 has-focus-visible:outline-focus has-focus-visible:outline-offset-2"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={choice === option}
              onChange={() => setThemeChoice(option)}
              className="absolute inset-0 size-full cursor-pointer appearance-none rounded-control opacity-0"
            />
            {option === 'system' ? (
              <span className="flex h-18 w-full overflow-hidden rounded-lg ring-1 ring-line ring-inset">
                <Mini theme="dark" half />
                <Mini theme="light" half />
              </span>
            ) : (
              <Mini theme={option} />
            )}
            {LABEL[option]}
          </label>
        ))}
      </div>
      <p className="text-caption text-ink-muted">
        System follows your device&rsquo;s light or dark setting.
      </p>
    </fieldset>
  );
}
