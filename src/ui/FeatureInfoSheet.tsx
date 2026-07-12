import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { EntriesView } from '@/data5e/entries/renderEntries';
import type { FeatureCard } from '@/engine/types';

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
  const base = label
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase();

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
export function FeatureInfoSheet({
  title,
  subtitle,
  entries,
  trigger,
}: {
  title: string;
  subtitle?: string;
  entries: unknown;
  trigger: ReactNode;
}) {
  return (
    <Drawer.Root>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-1 shrink-0 text-base font-semibold">{title}</Drawer.Title>
          {subtitle !== undefined && (
            <p className="mb-2 shrink-0 text-xs text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-sm">
            <EntriesView entries={entries} />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
