/**
 * The frame every Workshop editor sits in (board 3, the one editor shape): a
 * way back, the entry's name and where it stands, a button that shows it as
 * the file Save writes, a More menu, the Based on chip a copy shows, then the
 * editor (About it, Text, What it does, then Try it on). At the bottom of the
 * screen a Save bar stays: the problems Save would meet, what the last save
 * did with Undo beside it, and Saves to with Save.
 */
import {
  ArrowLeft,
  BadgeAlert,
  CircleAlert,
  Ellipsis,
  FileCode,
  GitFork,
  Layers,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Button, buttonClass } from '@/ui/Button';

const ICON = 'tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

export function BasedOnChip({ name }: { name: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-pill px-3 text-caption font-semibold text-ink-muted ring ring-line-strong ring-inset">
      <GitFork size={14} aria-hidden />
      Based on {name}
    </span>
  );
}

/** Something Save would meet, listed above it. */
export interface Problem {
  text: string;
  /** Save waits until it is fixed; else it is a note, and Save goes ahead. */
  blocks: boolean;
  /** Puts the keyboard where it can be fixed. */
  fix?: () => void;
}

function ProblemRow({ problem }: { problem: Problem }) {
  const Icon = problem.blocks ? CircleAlert : BadgeAlert;
  const body = (
    <>
      <Icon
        size={16}
        aria-hidden
        className={`mt-0.5 shrink-0 ${problem.blocks ? 'text-danger' : 'text-ink-muted'}`}
      />
      <span className="min-w-0 flex-1">{problem.text}</span>
    </>
  );
  const row = 'flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-caption';
  return problem.fix === undefined ? (
    <span className={row}>{body}</span>
  ) : (
    <button type="button" onClick={problem.fix} className={`${row} hover:bg-surface-raised`}>
      {body}
    </button>
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
  problems = [],
  savesTo,
  saved,
  failure,
  file,
  saveLabel = 'Save',
  saving,
  canSave,
  onSave,
}: {
  title: string;
  /** What it is and where it stands, under the title: "Item, your own. Not saved yet". */
  kind: string;
  onBack: () => void;
  onMore?: () => void;
  basedOn?: string;
  banner?: ReactNode;
  children: ReactNode;
  /** A line under the Save bar: what a copy's save will store. */
  footnote?: ReactNode;
  /** What Save would meet, the ones that hold it back first. */
  problems?: readonly Problem[];
  /** Where Save puts it, and a way to pick another place. */
  savesTo?: ReactNode;
  /** What the last save did, with a way to take it back. */
  saved?: { text: string; onUndo?: () => void; undoing?: boolean };
  /** Why the last Save or Undo did not happen, in the Save bar whatever is shown above. */
  failure?: string;
  /** The file view, shown in place of the form while `shown`. */
  file?: { shown: boolean; onToggle: () => void; view: ReactNode };
  saveLabel?: string;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
}) {
  const sorted = [...problems].sort((a, b) => Number(b.blocks) - Number(a.blocks));
  const saveButton = useRef<HTMLButtonElement>(null);
  // Undo takes its own row away: the keyboard goes on to Save, not the page.
  const undid = useRef(false);
  const undone = saved === undefined;
  useEffect(() => {
    if (!undone || !undid.current) return;
    undid.current = false;
    saveButton.current?.focus();
  }, [undone]);
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
          {file !== undefined && (
            <button
              type="button"
              aria-label="Show as a file"
              aria-pressed={file.shown}
              onClick={file.onToggle}
              className={`${ICON} aria-pressed:bg-surface-raised aria-pressed:text-ink`}
            >
              <FileCode size={20} aria-hidden />
            </button>
          )}
          {onMore !== undefined && (
            <button type="button" aria-label="More" onClick={onMore} className={`-mr-3 ${ICON}`}>
              <Ellipsis size={20} aria-hidden />
            </button>
          )}
        </header>
        {basedOn !== undefined && <BasedOnChip name={basedOn} />}
        {banner}
        {file?.shown === true ? file.view : children}
      </div>
      <footer className="sticky bottom-0 z-10 border-line border-t bg-bg">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div aria-live="polite" className="flex flex-col empty:hidden">
            {sorted.length > 0 && (
              <ul aria-label="Before you save" className="-mx-2 flex flex-col">
                {sorted.map((p) => (
                  <li key={p.text}>
                    <ProblemRow problem={p} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {failure !== undefined && (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-caption">
              {failure}
            </p>
          )}
          {saved !== undefined && (
            <div className="flex items-center gap-2 rounded-control bg-surface-raised px-3 py-1.5">
              <p className="min-w-0 flex-1 text-caption">{saved.text}</p>
              {saved.onUndo !== undefined && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-disabled={saved.undoing === true || undefined}
                  onClick={() => {
                    if (saved.undoing === true) return;
                    undid.current = true;
                    saved.onUndo?.();
                  }}
                >
                  Undo
                </Button>
              )}
            </div>
          )}
          {/* The Save button wraps under where it saves once a word there would not fit beside it. */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex min-w-min flex-1 items-center gap-1.5 text-caption text-ink-muted">
              <Layers size={16} aria-hidden className="shrink-0" />
              <div className="min-w-0 flex-1">{savesTo}</div>
            </div>
            {/* Not disabled while saving: a disabled button drops the keyboard to the page. */}
            <button
              ref={saveButton}
              type="button"
              disabled={!canSave}
              aria-disabled={saving || undefined}
              onClick={saving ? undefined : onSave}
              className={buttonClass({ variant: 'brand', size: 'lg' })}
            >
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
          {footnote !== undefined && <p className="text-caption text-ink-muted">{footnote}</p>}
        </div>
      </footer>
    </main>
  );
}
