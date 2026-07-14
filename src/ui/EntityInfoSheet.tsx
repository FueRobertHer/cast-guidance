import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { headerFacts } from '@/features/library/fmt';

/**
 * Full-description bottom sheet for a build option (race, subrace, background,
 * class, subclass, feat). Same in-place popup pattern as attacks/spells on the
 * Play tab, so a player choosing an option can read exactly what it does without
 * leaving the picker. Renders the type's header facts plus the entity's prose;
 * `entriesOverride` supplies text for entities that keep their description
 * elsewhere (a subclass's rules live in its features, not the entity itself).
 */
export function EntityInfoSheet({
  type,
  entity,
  entriesOverride,
  subtitle,
  trigger,
}: {
  type: string;
  entity: Entity;
  entriesOverride?: unknown;
  subtitle?: string;
  trigger: ReactNode;
}) {
  const facts = headerFacts(type, entity);
  const entries = entriesOverride ?? entity.entries;
  const hasEntries = Array.isArray(entries) && entries.length > 0;

  return (
    <Drawer.Root>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-1 shrink-0 text-base font-semibold">
            {String(entity.name ?? '?')}
          </Drawer.Title>
          {subtitle !== undefined && (
            <p className="mb-2 shrink-0 text-xs text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-sm">
            {facts.length > 0 && (
              <div className="mb-3 flex flex-col gap-0.5 text-xs">
                {facts.map(([label, value]) => (
                  <div key={label} className="text-ink-muted">
                    <span className="font-medium text-ink">{label}:</span> {value}
                  </div>
                ))}
              </div>
            )}
            {hasEntries ? (
              <EntriesView entries={entries} />
            ) : (
              <p className="text-ink-muted">No description text in the data for this option.</p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
