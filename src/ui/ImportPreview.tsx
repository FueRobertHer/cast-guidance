/**
 * The parts both import previews are built from (IMP-002): the dialog they
 * open in, the headed lists inside it, and a status line that says its state
 * in words and with an icon, never by colour alone.
 *
 * Presentational only. The previews themselves are worked out by the pure
 * builders in `features/homebrew/importPreview.ts` and
 * `features/characters/importPreview.ts`; this only draws them. It is loaded
 * with the Homebrew page and, on the roster, only once an import starts, so
 * none of it is in the entry chunk.
 */
// Icons the app already ships elsewhere, so the preview adds no icon chunks.
import { Check, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { DialogFrame } from './dialogs';
import { Sheet } from './sheet';

/** 44px targets (A11Y-002's `tap`). */
const BUTTON = 'tap flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold';

/**
 * Puts focus back on what had it when the preview opened (the import button,
 * or the URL field), once the preview closes. The sheet has no trigger for
 * Radix to return focus to, so without this a keyboard or screen-reader user
 * is dropped at the top of the page after answering.
 */
function useReturnFocus(): void {
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(
    () => () => {
      if (opener?.isConnected === true) opener.focus({ preventScroll: true });
    },
    [opener],
  );
}

export interface PreviewAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/**
 * The preview dialog: a modal sheet named by `title`, its content scrolling
 * between the title and a row of actions that stays in reach. Dismissing it
 * (swipe, overlay, Escape) is the same as `onDismiss`, which is Cancel.
 */
export function ImportPreviewDialog({
  title,
  description,
  onDismiss,
  actions,
  children,
}: {
  title: string;
  /** One line under the title; the dialog's accessible description. */
  description: string;
  onDismiss: () => void;
  actions: PreviewAction[];
  children: ReactNode;
}) {
  useReturnFocus();
  return (
    <DialogFrame title={title} onDismiss={onDismiss}>
      <Sheet.Description className="-mt-2 mb-3 text-xs text-ink-muted">
        {description}
      </Sheet.Description>
      {/* Below the sheet's handle and title, so the actions stay on screen
          however long the preview runs. Focusable and named, so a keyboard
          can scroll it (Safari does not focus a scroll area on its own). */}
      <div className="flex max-h-[70dvh] flex-col">
        <section
          aria-label="Import details"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must take focus to be scrolled by keyboard.
          tabIndex={0}
          className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4"
        >
          <div className="flex flex-col gap-4 pb-3 text-sm">{children}</div>
        </section>
        <div className="flex shrink-0 gap-2 border-t border-surface-2 pt-3">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={`${BUTTON} ${a.primary === true ? 'bg-accent text-white' : 'bg-surface-2'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </DialogFrame>
  );
}

/** A headed part of the preview; the heading names the region for assistive tech. */
export function PreviewSection({ heading, children }: { heading: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {heading}
      </h3>
      {children}
    </section>
  );
}

/** A plain list inside a section: one entry per item, read as a list. */
export function PreviewList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-1.5">{children}</ul>;
}

export type Tone = 'good' | 'info' | 'warn' | 'new';

const TONE: Record<Tone, { Icon: typeof Check; className: string }> = {
  good: { Icon: Check, className: 'text-emerald-400' },
  new: { Icon: Plus, className: 'text-emerald-400' },
  info: { Icon: ChevronRight, className: 'text-ink-muted' },
  warn: { Icon: TriangleAlert, className: 'text-amber-300' },
};

/**
 * One line of the preview with its state. The icon is decoration (hidden from
 * assistive tech); `status` is the words that carry the state, so nothing
 * depends on telling the colours apart.
 */
export function StatusItem({
  tone,
  status,
  children,
}: {
  tone: Tone;
  /** The state in words, shown in bold before the detail. */
  status?: string;
  children?: ReactNode;
}) {
  const { Icon, className } = TONE[tone];
  return (
    <li className="flex items-start gap-2">
      <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${className}`} />
      <span className="min-w-0 break-words">
        {status !== undefined && <span className="font-semibold">{status}</span>}
        {status !== undefined && children !== undefined && ' '}
        {children}
      </span>
    </li>
  );
}

/** A definition list of short facts (contents, size, class). */
export function PreviewFacts({ facts }: { facts: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `48 KB`, `1.2 MB`: sizes as a person reads them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Size against the import limit, the one number that can refuse a file. */
export function sizeText(bytes: number, limitBytes: number): string {
  return `${formatBytes(bytes)} (the limit is ${formatBytes(limitBytes)})`;
}

/** `12 spell, 3 item` in the counts' own words, or a plain "nothing" line. */
export function countsText(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`);
  return parts.length > 0 ? parts.join(', ') : 'No entries the app recognizes';
}
