import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
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
  describe,
  infoType,
  infoEntries,
}: {
  entities: readonly Entity[];
  selectedUid?: string;
  onSelect: (e: Entity) => void;
  /** When provided, tapping the selected card clears the pick (optional fields). */
  onDeselect?: () => void;
  /**
   * Curate the default view: one printing per name (best source first) with
   * UA / sidekicks / variants behind a "show everything" toggle, core books
   * sorted before setting-specific ones. Filtering always searches everything.
   */
  dedupe?: boolean;
  /** One-line summary rendered under the name — decision support. */
  describe?: (e: Entity) => string | undefined;
  /**
   * Entity type (e.g. 'race', 'feat') — when set, each card gets an ⓘ button
   * opening the full description in a drawer, like attacks/spells on the sheet.
   */
  infoType?: string;
  /** Optional entries override for the info drawer (subclasses store text in features). */
  infoEntries?: (e: Entity) => unknown;
}) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const { list, hiddenCount } = useMemo(() => {
    // Curated view: core books first (PHB before setting books), then A→Z —
    // a new player should see Human before Aarakocra. Full lists stay A→Z.
    const sorted = [...entities].sort((a, b) =>
      dedupe
        ? rankOf(a) - rankOf(b) || nameOf(a).localeCompare(nameOf(b))
        : nameOf(a).localeCompare(nameOf(b)) || rankOf(a) - rankOf(b),
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
        {list.map((e) => {
          const blurb = describe?.(e);
          const selected = selectedUid === uidOf(e);
          return (
            <div
              key={uidOf(e)}
              className={`flex items-start rounded-lg border text-sm ${
                selected
                  ? 'border-accent bg-accent-deep/40'
                  : 'border-surface-2 bg-surface hover:bg-surface-2'
              }`}
            >
              <button
                type="button"
                aria-label={nameOf(e)}
                onClick={() => {
                  if (selected && onDeselect !== undefined) onDeselect();
                  else onSelect(e);
                }}
                title={selected && onDeselect !== undefined ? 'Tap again to unselect' : undefined}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
              >
                <span className={`truncate ${selected ? 'font-semibold' : ''}`}>
                  {nameOf(e)}
                  {selected && onDeselect !== undefined && (
                    <span className="ml-1.5 text-xs font-normal text-ink-muted">✕ unselect</span>
                  )}
                </span>
                {blurb !== undefined && (
                  <span className="text-xs leading-snug text-ink-muted">{blurb}</span>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1 py-2.5 pr-2">
                <SourceBadge source={sourceOf(e)} />
                {infoType !== undefined && (
                  <EntityInfoSheet
                    type={infoType}
                    entity={e}
                    entriesOverride={infoEntries?.(e)}
                    subtitle={`${nameOf(e)} · ${sourceOf(e)}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`${nameOf(e)} details`}
                        title="Full description"
                        className="rounded-full p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <Info size={16} />
                      </button>
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
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
