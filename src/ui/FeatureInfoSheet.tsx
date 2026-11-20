import { type ReactNode, useMemo, useState } from 'react';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import type { ChangedEntry, EntityRegistry } from '@/data5e/normalize';
import type { FeatureCard } from '@/engine/types';
import { stripTrailingParenthetical } from '@/lib/trailingParenthetical';
import { ChangedBadge, ChangedVersions, sameWords } from './EntityInfoSheet';
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

type Step = readonly ['entries' | 'items', number];

const isNode = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The steps from `node` to the part whose `entries` are `target`, by identity. */
function pathTo(node: unknown, target: unknown, depth = 0): Step[] | undefined {
  if (!isNode(node)) return undefined;
  if (node.entries === target) return [];
  if (depth >= 16) return undefined;
  for (const key of ['entries', 'items'] as const) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const rest = pathTo(list[i], target, depth + 1);
      if (rest !== undefined) return [[key, i], ...rest];
    }
  }
  return undefined;
}

/** The first part named `name` under `node`, through `entries` and `items`. */
function named(node: unknown, name: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!isNode(node) || depth > 16) return undefined;
  for (const key of ['entries', 'items'] as const) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (const part of list) {
      if (isNode(part) && part.name === name) return part;
      const deeper = named(part, name, depth + 1);
      if (deeper !== undefined) return deeper;
    }
  }
  return undefined;
}

function follow(node: unknown, path: readonly Step[]): unknown {
  let at = node;
  for (const [key, i] of path) {
    const list = isNode(at) ? at[key] : undefined;
    at = Array.isArray(list) ? list[i] : undefined;
  }
  return at;
}

/**
 * The change to the books whose rules text a feature card shows (ADR-002,
 * D2), and that text as the book has it. A card holds its entry's own
 * `entries` (a class feature's, a feat's, a race's), or a part of them found
 * by name (a race's trait), so the record is the one whose changed version
 * holds them. Text a card builds anew finds none, and shows no badge.
 */
export function changeHolding(
  registry: EntityRegistry | null,
  entries: unknown,
): { record: ChangedEntry; book: unknown } | undefined {
  if (registry === null || !Array.isArray(entries)) return undefined;
  for (const record of registry.changedEntries()) {
    if (record.placed === record.base) continue;
    const path = pathTo(record.placed, entries);
    if (path === undefined) continue;
    if (path.length === 0) return { record, book: record.base.entries ?? [] };
    // A part (a race's trait): the book's part of its name, wherever the
    // change moved it; none, and the change added it, so the book's whole
    // text is what lies below. A part the change left as the book has it is
    // not what changed, so its card is not marked.
    const mine = follow(record.placed, path);
    const theirs =
      isNode(mine) && mine.name !== undefined ? named(record.base, mine.name) : undefined;
    if (theirs === undefined) return { record, book: record.base.entries ?? [] };
    const book = theirs.entries ?? [];
    return sameWords(book, entries) ? undefined : { record, book };
  }
  return undefined;
}

/**
 * Tap-to-explain bottom sheet: shows a feature's full rules text right where
 * the player is, instead of sending them hunting through the Features tab.
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
  const registry = useRegistry();
  const change = useMemo(() => changeHolding(registry, entries), [registry, entries]);
  const [book, setBook] = useState(false);
  // Opened again, the sheet shows the version the sheet counts.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setBook(false);
  };

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel className="flex max-h-[80dvh] flex-col">
          {/* The subtitle (where it comes from, what it costs) can run long,
              so it takes a line under the title rather than the heading's
              aside on its right. */}
          <Sheet.Heading>
            {title}
            {change !== undefined && <ChangedBadge />}
          </Sheet.Heading>
          {subtitle !== undefined && (
            <p className="-mt-2 mb-3 shrink-0 text-caption text-ink-muted">{subtitle}</p>
          )}
          {registry !== null && change !== undefined && (
            <ChangedVersions
              registry={registry}
              record={change.record}
              book={book}
              same={sameWords(change.book, entries)}
              onFlip={() => setBook((b) => !b)}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-body">
            <EntriesView entries={book && change !== undefined ? change.book : entries} />
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
