import { ChevronDown, Heart, HeartCrack, Pencil, Shield, Skull, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import { type ThemeFile, themeScheme, themeVars } from '@/theme/file';
import { D20Icon } from '@/ui/D20Icon';

/**
 * The draft, drawn (docs/theming-plan.md, phase 4): a small sheet in the
 * theme being made, built from its file as a saved theme is (its base's
 * `data-theme`, its values set on the same element), so it is exactly what
 * saving would draw. The page around it stays in the theme in use: nothing
 * here can make the editor's own controls, or a dialog over them, unreadable.
 *
 * Folded, it keeps a strip of the page, a card and the action, so it can stay
 * on screen while the controls scroll.
 */
export function ThemeSample({
  file,
  folded,
  onFold,
}: {
  file: ThemeFile;
  folded: boolean;
  onFold: () => void;
}) {
  const style = { ...themeVars(file), colorScheme: themeScheme(file) } as CSSProperties;
  return (
    <section
      aria-label="Preview"
      data-theme={file.base}
      data-theme-sample=""
      style={style}
      className="overflow-hidden rounded-card bg-bg font-sans text-ink shadow-overlay ring ring-line ring-inset"
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="min-w-0 flex-1 truncate font-display text-title-card">Vela Quill</span>
        <span className="rounded-pill bg-arcane-soft px-2 text-label text-arcane">Sorcerer 13</span>
        <button
          type="button"
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={folded ? 'Show the whole preview' : 'Fold the preview'}
          className="tap -mr-2 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <ChevronDown size={20} aria-hidden="true" className={folded ? '' : 'rotate-180'} />
        </button>
      </div>
      {folded ? (
        <div className="flex items-center gap-2 px-3 pb-3">
          <span className="h-6 flex-1 rounded-control bg-surface ring ring-line ring-inset" />
          <span className="h-6 w-16 rounded-control bg-brand" />
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          <div className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-card ring ring-line ring-inset">
            <div className="flex items-center justify-between">
              <span className="text-overline text-ink-muted uppercase">Hit points</span>
              <span className="inline-flex items-center gap-1 rounded-pill bg-ward-soft px-2 text-label text-ward">
                <Shield size={14} aria-hidden="true" />5
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-stat tabular-nums">42</span>
              <span className="text-body text-ink-muted tabular-nums">/ 64</span>
              <span className="ml-auto inline-flex items-center gap-1 text-caption text-danger">
                <HeartCrack size={14} aria-hidden="true" />
                −7
              </span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-pill bg-track">
              <span className="h-full w-[58%] bg-heal" />
              <span className="h-full w-[10%] bg-(--cg-hp-trail)" />
              <span className="h-full w-[8%] rounded-r-pill bg-ward-soft ring ring-ward ring-inset" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <span className="flex min-h-10 items-center justify-center gap-1.5 rounded-control bg-danger-soft text-body-strong text-danger">
                <Heart size={16} aria-hidden="true" />
                Damage
              </span>
              <span className="flex min-h-10 items-center justify-center gap-1.5 rounded-control bg-heal-soft text-body-strong text-heal">
                <Sparkles size={16} aria-hidden="true" />
                Heal
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-brand px-3 text-body-strong text-on-brand">
              <D20Icon size={16} />
              Roll
            </span>
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-body-strong text-ink ring ring-line-strong ring-inset">
              <Pencil size={16} aria-hidden="true" />
              Edit
            </span>
            <span className="inline-flex min-h-8 items-center rounded-pill bg-(--cg-cx-poisoned-soft) px-2.5 text-label text-(--cg-cx-poisoned) ring ring-(--cg-cx-poisoned) ring-inset">
              Poisoned
            </span>
            <span className="inline-flex min-h-8 items-center gap-1 rounded-chip bg-surface-raised px-2 text-label text-ink">
              <Skull size={14} aria-hidden="true" />2
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-control bg-surface px-3 py-2 ring-strong ring-ink ring-inset">
            <span className="size-3 rounded-full bg-guide" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-strong">Fireball</span>
              <span className="block text-caption text-ink-muted">3rd level · 8d6 fire</span>
            </span>
            <span className="text-caption text-ink-faint">Chosen</span>
          </div>
        </div>
      )}
    </section>
  );
}
