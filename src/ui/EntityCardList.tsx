import { useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { SourceBadge } from '@/ui/SourceBadge';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

/** Preferred printing when the same name exists in several books (lower = better). */
const SOURCE_RANK = [
  'xphb',
  'phb',
  'mpmm',
  'tce',
  'vgm',
  'mtf',
  'xge',
  'ftd',
  'scag',
  'erlw',
  'egw',
  'aag',
  'wbtw',
  'mot',
  'vrgr',
  'ggr',
  'dmg',
];
const rankOf = (e: Entity) => {
  const i = SOURCE_RANK.indexOf(sourceOf(e).toLowerCase());
  return i === -1 ? 99 : i;
};

/** Playtest material, sidekicks, and named variants belong behind the fold. */
const isNiche = (e: Entity) =>
  sourceOf(e).toLowerCase().startsWith('ua') ||
  nameOf(e).toLowerCase().includes('sidekick') ||
  nameOf(e).includes(';');

/** Filterable pick-one card grid used by the wizard and the build editor. */
export function EntityCardList({
  entities,
  selectedUid,
  onSelect,
  onDeselect,
  dedupe = false,
}: {
  entities: readonly Entity[];
  selectedUid?: string;
  onSelect: (e: Entity) => void;
  /** When provided, tapping the selected card clears the pick (optional fields). */
  onDeselect?: () => void;
  /**
   * Curate the default view: one printing per name (best source first) with
   * UA / sidekicks / variants behind a "show everything" toggle. Filtering
   * always searches everything.
   */
  dedupe?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const { list, hiddenCount } = useMemo(() => {
    const sorted = [...entities].sort(
      (a, b) => nameOf(a).localeCompare(nameOf(b)) || rankOf(a) - rankOf(b),
    );
    const f = filter.trim().toLowerCase();
    if (f !== '') {
      // Searching means the user wants something specific — search everything.
      return { list: sorted.filter((e) => nameOf(e).toLowerCase().includes(f)), hiddenCount: 0 };
    }
    if (!dedupe || showAll) return { list: sorted, hiddenCount: 0 };
    const bestByName = new Map<string, Entity>();
    for (const e of sorted) {
      if (isNiche(e)) continue;
      const key = nameOf(e).toLowerCase();
      const cur = bestByName.get(key);
      if (cur === undefined || rankOf(e) < rankOf(cur)) bestByName.set(key, e);
    }
    const primary = sorted.filter(
      (e) =>
        bestByName.get(nameOf(e).toLowerCase()) === e ||
        // never hide the current selection
        uidOf(e) === selectedUid,
    );
    return { list: primary, hiddenCount: sorted.length - primary.length };
  }, [entities, filter, dedupe, showAll, selectedUid]);

  return (
    <div className="flex flex-col gap-2">
      {entities.length > 10 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
        />
      )}
      <div className="grid max-h-96 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {list.map((e) => (
          <button
            key={uidOf(e)}
            type="button"
            onClick={() => {
              if (selectedUid === uidOf(e) && onDeselect !== undefined) onDeselect();
              else onSelect(e);
            }}
            title={
              selectedUid === uidOf(e) && onDeselect !== undefined
                ? 'Tap again to unselect'
                : undefined
            }
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
              selectedUid === uidOf(e)
                ? 'border-accent bg-accent-deep/40 font-semibold'
                : 'border-surface-2 bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="truncate">
              {nameOf(e)}
              {selectedUid === uidOf(e) && onDeselect !== undefined && (
                <span className="ml-1.5 text-xs font-normal text-ink-muted">✕ unselect</span>
              )}
            </span>
            <SourceBadge source={sourceOf(e)} />
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-xs text-ink-muted hover:text-ink"
        >
          Show {hiddenCount} more — other printings, variants & playtest content
        </button>
      )}
      {showAll && dedupe && filter === '' && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-xs text-ink-muted hover:text-ink"
        >
          Show fewer — one printing per name
        </button>
      )}
    </div>
  );
}
