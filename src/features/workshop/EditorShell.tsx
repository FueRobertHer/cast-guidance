/**
 * The frame every Workshop editor sits in (the canvas's Subclass and Spell
 * boards): a way back, the entry's name and kind, a More menu, the Based on
 * chip a copy shows, then the editor, then a Save bar that stays at the
 * bottom of the screen with a line on what Save will store.
 */
import { ArrowLeft, Ellipsis, GitFork } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/ui/Button';

const ICON = 'tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

export function BasedOnChip({ name }: { name: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-full px-3 text-caption font-semibold text-ink-muted ring-1 ring-line-strong ring-inset">
      <GitFork size={14} aria-hidden />
      Based on {name}
    </span>
  );
}

export function EditorShell({
  title,
  kind,
  onBack,
  onMore,
  basedOn,
  banner,
  children,
  footnote,
  saveLabel = 'Save',
  saving,
  canSave,
  onSave,
}: {
  title: string;
  /** What it is, under the title: "Feat, a copy". */
  kind: string;
  onBack: () => void;
  onMore?: () => void;
  basedOn?: string;
  banner?: ReactNode;
  children: ReactNode;
  /** The Save bar's line: what Save will store, or why it cannot. */
  footnote: ReactNode;
  saveLabel?: string;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-3 pb-6">
        <header className="flex items-start gap-1">
          <button type="button" aria-label="Back" onClick={onBack} className={`-ml-3 ${ICON}`}>
            <ArrowLeft size={20} aria-hidden />
          </button>
          <div className="min-w-0 flex-1 pt-1.5">
            <h1 className="font-display text-title-page break-words">{title}</h1>
            <p className="text-caption text-ink-muted">{kind}</p>
          </div>
          {onMore !== undefined && (
            <button type="button" aria-label="More" onClick={onMore} className={`-mr-3 ${ICON}`}>
              <Ellipsis size={20} aria-hidden />
            </button>
          )}
        </header>
        {basedOn !== undefined && <BasedOnChip name={basedOn} />}
        {banner}
        {children}
      </div>
      <footer className="sticky bottom-0 z-10 border-line border-t bg-bg">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <p className="min-w-0 flex-1 text-caption text-ink-muted" aria-live="polite">
            {footnote}
          </p>
          <Button variant="brand" size="lg" disabled={!canSave || saving} onClick={onSave}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </footer>
    </main>
  );
}
