import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

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
      kind: 'number';
      title: string;
      initial?: number;
      min?: number;
      max?: number;
      hint?: string;
      resolve: (v: number | null) => void;
    }
  | {
      kind: 'confirm';
      title: string;
      detail?: string;
      confirmLabel?: string;
      danger?: boolean;
      resolve: (v: boolean) => void;
    }
  | {
      kind: 'choice';
      title: string;
      detail?: string;
      options: Array<{ id: string; label: string; hint?: string }>;
      resolve: (v: string | null) => void;
    };

const dialogStore = createStore<{ req: DialogRequest | null }>(() => ({ req: null }));

const open = (req: DialogRequest) => dialogStore.setState({ req });
const close = () => dialogStore.setState({ req: null });

export function askText(opts: {
  title: string;
  initial?: string;
  placeholder?: string;
}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'text', ...opts, resolve }));
}

export function askNumber(opts: {
  title: string;
  initial?: number;
  min?: number;
  max?: number;
  hint?: string;
}): Promise<number | null> {
  return new Promise((resolve) => open({ kind: 'number', ...opts, resolve }));
}

export function askConfirm(opts: {
  title: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', ...opts, resolve }));
}

/** Pick one of several options (or null on dismiss). Used for the cast-slot chooser. */
export function askChoice(opts: {
  title: string;
  detail?: string;
  options: Array<{ id: string; label: string; hint?: string }>;
}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'choice', ...opts, resolve }));
}

function InputForm({ req }: { req: Extract<DialogRequest, { kind: 'text' | 'number' }> }) {
  const [draft, setDraft] = useState(
    req.kind === 'number' ? String(req.initial ?? '') : (req.initial ?? ''),
  );
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
    if (req.kind === 'number') {
      const n = Number.parseInt(draft, 10);
      if (Number.isNaN(n)) return;
      const clamped = Math.max(req.min ?? -Infinity, Math.min(req.max ?? Infinity, n));
      req.resolve(clamped);
    } else {
      req.resolve(draft);
    }
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
        inputMode={req.kind === 'number' ? 'numeric' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={req.kind === 'text' ? req.placeholder : undefined}
        className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
      >
        OK
      </button>
    </form>
  );
}

/** Mount once (AppShell). Renders the active ask* request as a bottom sheet. */
export function DialogHost() {
  const req = useStore(dialogStore, (s) => s.req);
  if (req === null) return null;

  const dismiss = () => {
    if (req.kind === 'confirm') req.resolve(false);
    else req.resolve(null);
    close();
  };

  return (
    <Drawer.Root
      open
      onOpenChange={(o) => {
        if (!o) dismiss();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-3 text-base font-semibold">{req.title}</Drawer.Title>
          {req.kind === 'confirm' ? (
            <div className="flex flex-col gap-3">
              {req.detail !== undefined && <p className="text-sm text-ink-muted">{req.detail}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={dismiss}
                  className="flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    req.resolve(true);
                    close();
                  }}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white ${
                    req.danger === true ? 'bg-accent-deep' : 'bg-accent'
                  }`}
                >
                  {req.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          ) : req.kind === 'choice' ? (
            <div className="flex flex-col gap-2">
              {req.detail !== undefined && <p className="text-sm text-ink-muted">{req.detail}</p>}
              <div className="flex flex-col gap-1.5">
                {req.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      req.resolve(o.id);
                      close();
                    }}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-2/70"
                  >
                    <span>{o.label}</span>
                    {o.hint !== undefined && (
                      <span className="shrink-0 text-xs font-normal text-ink-muted">{o.hint}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {req.kind === 'number' && req.hint !== undefined && (
                <p className="text-xs text-ink-muted">{req.hint}</p>
              )}
              <InputForm key={req.title} req={req} />
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
