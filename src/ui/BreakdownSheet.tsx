import { type ReactNode, useState } from 'react';
import { Drawer } from 'vaul';
import type { DerivedValue } from '@/engine/types';

/** Bottom sheet showing how a derived number was computed, with optional override. */
export function BreakdownSheet({
  title,
  value,
  trigger,
  onOverride,
}: {
  title: string;
  value: DerivedValue;
  trigger: ReactNode;
  /** When provided, shows the manual-override editor. null clears. */
  onOverride?: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState('');

  return (
    <Drawer.Root>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-2 flex items-baseline justify-between text-base font-semibold">
            {title}
            <span className="text-2xl font-bold">{value.value}</span>
          </Drawer.Title>
          <dl className="flex flex-col gap-1 text-sm">
            {value.parts.map((p, i) => (
              <div key={`${p.label}-${String(i)}`} className="flex justify-between">
                <dt className="text-ink-muted">{p.label}</dt>
                <dd className="font-mono">
                  {p.amount >= 0 ? '+' : ''}
                  {p.amount}
                </dd>
              </div>
            ))}
            {value.overridden && (
              <div className="mt-1 flex justify-between border-t border-surface-2 pt-1 text-amber-300">
                <dt>Manual override (computed: {value.base})</dt>
                <dd className="font-mono">= {value.value}</dd>
              </div>
            )}
          </dl>
          {onOverride !== undefined && (
            <form
              className="mt-3 flex gap-1.5 border-t border-surface-2 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number.parseInt(draft, 10);
                if (!Number.isNaN(n)) {
                  onOverride(n);
                  setDraft('');
                }
              }}
            >
              <input
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Override (${value.base})`}
                className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
              />
              <button
                type="submit"
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
              >
                Set
              </button>
              {value.overridden && (
                <button
                  type="button"
                  onClick={() => onOverride(null)}
                  className="rounded-lg bg-surface-2 px-3 py-2 text-sm"
                >
                  Clear
                </button>
              )}
            </form>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
