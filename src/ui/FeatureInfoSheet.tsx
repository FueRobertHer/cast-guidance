import { type ReactNode, useState } from 'react';
import { EntriesView } from '@/data5e/entries/renderEntries';
import type { FeatureCard } from '@/engine/types';
import { stripTrailingParenthetical } from '@/lib/trailingParenthetical';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from './sheet';

/**
 * The rules text behind a derived mechanic (resource, action, …), located by
 * name inside the character's feature cards. Race cards hold their traits as
 * nested entries ("Breath Weapon" inside "Dragonborn"), so the walk recurses.
 */
export function findFeatureInfo(
  features: readonly FeatureCard[],
  label: string,
  origin?: string,
): { title: string; entries: unknown } | undefined {
  // "Sneak Attack (+1d6 once/turn)" → "sneak attack"
  const base = stripTrailingParenthetical(label).trim().toLowerCase();

  const findNamed = (node: unknown): { title: string; entries: unknown } | undefined => {
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findNamed(n);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    if (node !== null && typeof node === 'object') {
      const o = node as { name?: unknown; entries?: unknown; items?: unknown };
      if (typeof o.name === 'string' && o.name.trim().toLowerCase() === base) {
        return { title: o.name, entries: o.entries ?? [] };
      }
      return findNamed(o.entries) ?? findNamed(o.items);
    }
    return undefined;
  };

  for (const f of features) {
    if (f.name.trim().toLowerCase() === base) return { title: f.name, entries: f.entries };
  }
  for (const f of features) {
    const hit = findNamed(f.entries);
    if (hit !== undefined) return hit;
  }
  if (origin !== undefined) {
    const byOrigin = features.find((f) => f.name === origin || f.origin.label === origin);
    if (byOrigin !== undefined) return { title: byOrigin.name, entries: byOrigin.entries };
  }
  return undefined;
}

/**
 * Tap-to-explain bottom sheet: shows a feature's full rules text right where
 * the player is, instead of sending them hunting through the More tab.
 */
export interface FeatureInfoSheetProps {
  title: string;
  subtitle?: string;
  entries: unknown;
  trigger: ReactNode;
}

/**
 * The trigger until the player asks for the feature, then the sheet. The Play
 * tab renders one per feature row, and an unopened row should not be paying
 * for a `Drawer.Root` and the `window` scroll listener it brings (see
 * {@link SheetStandIn}).
 */
export function FeatureInfoSheet(props: FeatureInfoSheetProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <SheetStandIn trigger={props.trigger} onArm={() => setArmed(true)} />;
  }
  return <FeatureInfoSheetContent {...props} />;
}

function FeatureInfoSheetContent({ title, subtitle, entries, trigger }: FeatureInfoSheetProps) {
  // Mounted by the press that opens it; see `useSheetOpenOnMount`.
  const [open, setOpen] = useSheetOpenOnMount();

  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel className="flex max-h-[80dvh] flex-col">
          {/* The subtitle (where it comes from, what it costs) can run long,
              so it takes a line under the title rather than the heading's
              aside on its right. */}
          <Sheet.Heading>{title}</Sheet.Heading>
          {subtitle !== undefined && (
            <p className="-mt-2 mb-3 shrink-0 text-caption text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-body">
            <EntriesView entries={entries} />
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
