import { type ReactNode, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { headerFacts } from '@/features/library/fmt';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from './sheet';

/**
 * Full-description bottom sheet for a build option (race, subrace, background,
 * class, subclass, feat). Same in-place popup pattern as attacks/spells on the
 * Play tab, so a player choosing an option can read exactly what it does without
 * leaving the picker. Renders the type's header facts plus the entity's prose;
 * `entriesOverride` supplies text for entities that keep their description
 * elsewhere (a subclass's rules live in its features, not the entity itself).
 */
export interface EntityInfoSheetProps {
  type: string;
  entity: Entity;
  entriesOverride?: unknown;
  subtitle?: string;
  trigger: ReactNode;
}

/**
 * The trigger until the player asks about the option, then the sheet. The
 * pickers and the inventory render one per row, so the unopened case has to
 * stay cheap: `headerFacts` walks the entity, and a `Drawer.Root` brings a
 * `window` scroll listener with it (see {@link SheetStandIn}).
 */
export function EntityInfoSheet(props: EntityInfoSheetProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <SheetStandIn trigger={props.trigger} onArm={() => setArmed(true)} />;
  }
  return <EntityInfoSheetContent {...props} />;
}

function EntityInfoSheetContent({
  type,
  entity,
  entriesOverride,
  subtitle,
  trigger,
}: EntityInfoSheetProps) {
  const facts = headerFacts(type, entity);
  const entries = entriesOverride ?? entity.entries;
  const hasEntries = Array.isArray(entries) && entries.length > 0;

  // Mounted by the press that opens it; see `useSheetOpenOnMount`.
  const [open, setOpen] = useSheetOpenOnMount();

  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel className="flex max-h-[80dvh] flex-col">
          <Sheet.Heading>{String(entity.name ?? '?')}</Sheet.Heading>
          {subtitle !== undefined && (
            <p className="-mt-2 mb-3 shrink-0 text-caption text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {facts.length > 0 && (
              <div className="mb-3 flex flex-col gap-0.5 text-caption">
                {facts.map(([label, value]) => (
                  <div key={label} className="text-ink-muted">
                    <span className="font-semibold text-ink">{label}:</span> {value}
                  </div>
                ))}
              </div>
            )}
            {hasEntries ? (
              <EntriesView entries={entries} />
            ) : (
              // Only worth saying when there is nothing else on screen. Plenty
              // of entries carry no prose because the facts above are the whole
              // story (a battleaxe is its damage and weight), and announcing a
              // missing description over a full stat block reads as a failure.
              facts.length === 0 && (
                <p className="text-ink-muted">No description text in the data for this option.</p>
              )
            )}
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
