import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import type { DerivedValue } from '@/engine/types';

/** Bottom sheet showing how a derived number was computed. */
export function BreakdownSheet({
  title,
  value,
  trigger,
}: {
  title: string;
  value: DerivedValue;
  trigger: ReactNode;
}) {
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
              <div key={`${p.label}-${i}`} className="flex justify-between">
                <dt className="text-ink-muted">{p.label}</dt>
                <dd className="font-mono">
                  {p.amount >= 0 ? '+' : ''}
                  {p.amount}
                </dd>
              </div>
            ))}
            {value.overridden && (
              <div className="mt-1 flex justify-between border-t border-surface-2 pt-1 text-amber-300">
                <dt>Manual override</dt>
                <dd className="font-mono">= {value.value}</dd>
              </div>
            )}
          </dl>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
