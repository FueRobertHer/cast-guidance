import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Button } from './Button';
import { focusSheetOnTouch, Sheet } from './sheet';
import { fieldClass } from './TextField';

/**
 * Themed, promise-based replacements for window.prompt/confirm. One DialogHost
 * (mounted in AppShell) renders whichever request is active as a bottom sheet:
 *
 *   const name = await askText({ title: 'Rename hero', initial: doc.name });
 *   if (name !== null) …
 */
type DialogRequest =
  | {
      kind: 'text';
      title: string;
      initial?: string;
      placeholder?: string;
      resolve: (v: string | null) => void;
    }
  | {
      kind: 'confirm';
      title: string;
      detail?: string;
      confirmLabel?: string;
      danger?: boolean;
      resolve: (v: boolean) => void;
    }
  | ({ kind: 'choice'; resolve: (v: string | null) => void } & ChoiceAsk);

/** One choice in an `askChoice` sheet. */
export interface ChoiceOption {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  /** A second line under the label: what choosing it does. It describes the choice, not names it. */
  line?: string;
  /** The heading it is listed under. Groups keep the order their first option comes in. */
  group?: string;
  /** More words a search finds it by, besides its label, line and group. */
  words?: string;
}

interface ChoiceAsk {
  title: string;
  detail?: string;
  options: ChoiceOption[];
  /** A search box over the options, with this name. Every word typed must be found. */
  search?: string;
  /** What a search that finds nothing says, and a choice to take instead. */
  noMatch?: (query: string) => { say: string; choice?: { id: string; label: string } };
}

const dialogStore = createStore<{ req: DialogRequest | null }>(() => ({ req: null }));

/**
 * Where focus was when a dialog opened. The sheets here have no trigger, and
 * Radix returns focus to the trigger on close, so without this a keyboard or
 * screen-reader user is dropped at the top of the page after every answer.
 * Kept across a chain of dialogs (one opening as another closes), so the
 * element restored is the one the first dialog was opened from.
 */
let returnFocus: HTMLElement | null = null;

const open = (req: DialogRequest) => {
  if (returnFocus === null && document.activeElement instanceof HTMLElement) {
    returnFocus = document.activeElement;
  }
  dialogStore.setState({ req });
};
const close = () => dialogStore.setState({ req: null });

export function askText(opts: {
  title: string;
  initial?: string;
  placeholder?: string;
}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'text', ...opts, resolve }));
}

export function askConfirm(opts: {
  title: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', ...opts, resolve }));
}

/**
 * Pick one of several options (or null on dismiss). Used for the cast-slot
 * chooser and for a row's action menu. Mark an option `danger` when choosing it
 * starts something destructive, so it does not sit in the list looking like the
 * three harmless choices above it. A long list can take a search box
 * (`search`), group headings and a second line per option (the Workshop's
 * Add an effect sheet).
 */
export function askChoice(opts: ChoiceAsk): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'choice', ...opts, resolve }));
}

/** Whether every word of `query` is in the option's label, line, group, hint or words. */
export function choiceMatches(o: ChoiceOption, query: string): boolean {
  const said = [o.label, o.line, o.group, o.hint, o.words].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((w) => said.includes(w));
}

function ChoiceButton({ o, pick }: { o: ChoiceOption; pick: (id: string) => void }) {
  const id = useId();
  // A second line describes the choice: it is not part of its name.
  const named =
    o.line === undefined
      ? {}
      : {
          'aria-labelledby': o.hint === undefined ? `${id}-label` : `${id}-label ${id}-hint`,
          'aria-describedby': `${id}-line`,
        };
  return (
    <button
      type="button"
      {...named}
      onClick={() => pick(o.id)}
      className={`flex min-h-tap items-center justify-between gap-2 rounded-control bg-surface-raised px-4 py-2.5 text-left text-body-strong transition-colors duration-120 hover:bg-surface-hover active:bg-surface-hover ${
        o.danger === true ? 'text-danger' : 'text-ink'
      }`}
    >
      {o.line === undefined ? (
        <span className="min-w-0">{o.label}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span id={`${id}-label`}>{o.label}</span>
          <span id={`${id}-line`} className="font-normal text-caption text-ink-muted">
            {o.line}
          </span>
        </span>
      )}
      {/* Wraps rather than running off a phone screen: cast hints
              carry cost, turn, and edition notes, the last one last. */}
      {o.hint !== undefined && (
        <span
          id={`${id}-hint`}
          className="min-w-0 text-right font-normal text-caption text-ink-muted"
        >
          {o.hint}
        </span>
      )}
    </button>
  );
}

/** The options of a choice sheet: under their group headings, and found by its search when it has one. */
function ChoiceList({
  req,
  pick,
}: {
  req: Extract<DialogRequest, { kind: 'choice' }>;
  pick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const shown = q === '' ? req.options : req.options.filter((o) => choiceMatches(o, q));
  const groups: Array<[string | undefined, ChoiceOption[]]> = [];
  for (const o of shown) {
    const at = groups.find(([g]) => g === o.group);
    if (at === undefined) groups.push([o.group, [o]]);
    else at[1].push(o);
  }
  const nothing = shown.length === 0 && q !== '';
  const none = nothing ? req.noMatch?.(q) : undefined;
  const instead = none?.choice;
  const list = (
    <>
      {groups.map(([group, options], g) =>
        group === undefined ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: options with no group, in their place
          <div key={`none ${g}`} className="flex flex-col gap-1.5">
            {options.map((o) => (
              <ChoiceButton key={o.id} o={o} pick={pick} />
            ))}
          </div>
        ) : (
          <div key={group} className="flex flex-col gap-1.5">
            <h3 className="mt-1 text-label text-ink-muted">{group}</h3>
            {options.map((o) => (
              <ChoiceButton key={o.id} o={o} pick={pick} />
            ))}
          </div>
        ),
      )}
    </>
  );
  if (req.search === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {req.detail !== undefined && <p className="text-body text-ink-muted">{req.detail}</p>}
        {list}
      </div>
    );
  }
  // A list long enough to search scrolls under its box, which stays in view.
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {req.detail !== undefined && (
        <p className="shrink-0 text-body text-ink-muted">{req.detail}</p>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={req.search}
        placeholder={req.search}
        className={`${fieldClass} shrink-0`}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1">
        {list}
        {/* There from the start, so a search that finds nothing is announced. */}
        <p role="status" className={nothing ? 'text-body text-ink-muted' : 'sr-only'}>
          {nothing ? (none?.say ?? `Nothing matches "${q}".`) : ''}
        </p>
        {instead !== undefined && (
          <Button className="self-start" onClick={() => pick(instead.id)}>
            {instead.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function InputForm({ req }: { req: Extract<DialogRequest, { kind: 'text' }> }) {
  const [draft, setDraft] = useState(req.initial ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus after the drawer's open animation so the keyboard doesn't fight it.
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 250);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    req.resolve(draft);
    close();
  };

  return (
    <form
      className="flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={req.title}
        placeholder={req.placeholder}
        className={`${fieldClass} min-w-0 flex-1`}
      />
      <Button type="submit" variant="brand" className="min-h-12">
        OK
      </Button>
    </form>
  );
}

/** Mount once (AppShell). Renders the active ask* request as a bottom sheet. */
export function DialogHost() {
  const req = useStore(dialogStore, (s) => s.req);
  useEffect(() => {
    if (req !== null) return;
    const target = returnFocus;
    returnFocus = null;
    // vaul restores the page's scroll position itself; don't scroll first.
    if (target?.isConnected === true) target.focus({ preventScroll: true });
  }, [req]);
  if (req === null) return null;

  const dismiss = () => {
    if (req.kind === 'confirm') req.resolve(false);
    else req.resolve(null);
    close();
  };

  return (
    <DialogFrame
      title={req.title}
      onDismiss={dismiss}
      searches={req.kind === 'choice' && req.search !== undefined}
    >
      {req.kind === 'confirm' ? (
        <div className="flex flex-col gap-3">
          {req.detail !== undefined && <p className="text-body text-ink-muted">{req.detail}</p>}
          {/* The confirm is the sheet's one primary action, or its one
              destructive one: `danger` says that this cannot be undone. */}
          <div className="flex gap-2">
            <Button size="lg" onClick={dismiss} className="flex-1">
              Cancel
            </Button>
            <Button
              size="lg"
              variant={req.danger === true ? 'danger' : 'brand'}
              onClick={() => {
                req.resolve(true);
                close();
              }}
              className="flex-1"
            >
              {req.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </div>
      ) : req.kind === 'choice' ? (
        <ChoiceList
          key={req.title}
          req={req}
          pick={(id) => {
            req.resolve(id);
            close();
          }}
        />
      ) : (
        <InputForm key={req.title} req={req} />
      )}
    </DialogFrame>
  );
}

/**
 * The frame every dialog here is drawn in: a modal bottom sheet named by its
 * title, with focus moved to its first control when it opens. Exported so a
 * dialog with content of its own (the import previews) is the same dialog as
 * the ask* ones, not a lookalike. Focus return stays with the caller:
 * DialogHost keeps the first opener across a chain of dialogs, which a
 * one-off dialog does not need.
 *
 * The sheet keeps to the screen however much it holds: under the title, what
 * is in it scrolls (`Sheet.Body`), so a long list, or text at 200% on a small
 * phone, never pushes the top of it off the screen.
 */
export function DialogFrame({
  title,
  onDismiss,
  searches = false,
  scrollsItself = false,
  children,
}: {
  title: ReactNode;
  onDismiss: () => void;
  /**
   * Its first control is a search box over a long list, which scrolls under
   * it (so the content scrolls itself, as below), and on a touch screen the
   * sheet takes focus itself rather than pop the keyboard (A11Y-003).
   */
  searches?: boolean;
  /**
   * What is in it brings its own scrolling part, between parts that stay in
   * view (the import previews' actions): it is laid out in the sheet as it
   * is, rather than scrolling as a whole.
   */
  scrollsItself?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet.Root
      open
      // Sheet.Root moves focus to the first control as it opens: Cancel, the
      // first option, or the input.
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel
          className="flex max-h-[85dvh] flex-col"
          {...(searches ? { onOpenAutoFocus: focusSheetOnTouch } : {})}
        >
          <Sheet.Heading>{title}</Sheet.Heading>
          {searches || scrollsItself ? children : <Sheet.Body>{children}</Sheet.Body>}
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
