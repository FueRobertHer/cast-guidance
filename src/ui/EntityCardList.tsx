import { Check, Info, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import {
  applySourcePolicy,
  backToSourcesLabel,
  hiddenSourcesLabel,
  policyAllows,
} from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import { buttonClass } from '@/ui/Button';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
import { OutsideSourcesChip } from '@/ui/OutsideSourcesChip';
import { SourceBadge } from '@/ui/SourceBadge';
import { fieldClass } from '@/ui/TextField';

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

/**
 * A way to show more or fewer of the list: a small outline button, the full
 * width of the list, its label wrapping when long.
 */
const MORE = buttonClass({ variant: 'outline', size: 'sm' });

/**
 * Filterable pick-one card grid used by the wizard and the build editor.
 *
 * Each card is the design's option card (DS-001): `surface` with a `line`
 * edge, the name in `title-card`, the blurb in `caption`, the source badge on
 * the right. The pick is `ink`, never a hue: a 2px `ink` edge and a filled
 * check, with `aria-pressed` saying it to a screen reader.
 */
export function EntityCardList({
  entities,
  selectedUid,
  onSelect,
  onDeselect,
  dedupe = false,
  describe,
  infoType,
  infoEntries,
  fill = false,
  sources,
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
  /**
   * Let the list run at its natural height and scroll with the page, instead of
   * capping it at 24rem behind its own scrollbar.
   *
   * The cap suits the build page, where the list is one of several accordions
   * and a section that grew to 2000px would bury the ones below it. It does
   * not suit a wizard step whose whole job is this list: the cap ended the
   * step 24rem down and left the rest of the screen empty above the step nav,
   * with the remaining entries behind a second, nested scroll.
   */
  fill?: boolean;
  /**
   * The character's own `allowedSources`. A non-empty list replaces this
   * device's source settings for this list; empty or absent leaves them in
   * charge. Omit it outside a character (nothing to narrow by).
   */
  sources?: readonly string[];
}) {
  const [filter, setFilter] = useState('');
  const blurbId = useId();
  const [showAll, setShowAll] = useState(false);
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const { policy, scope } = usePickSourcePolicy(sources);

  const { list, hiddenCount, sourceHiddenCount } = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matchesText = (e: Entity) => f === '' || nameOf(e).toLowerCase().includes(f);
    const isCurrentPick = (e: Entity) => uidOf(e) === selectedUid;

    // The player's source settings come off the top: everything below here,
    // including the text filter, works on books they said they wanted. The
    // current pick is exempt: a character holding it must keep seeing it.
    const allowed = showHiddenSources
      ? [...entities]
      : applySourcePolicy(entities, policy, sourceOf, isCurrentPick);

    // Counted over what the text filter would have shown, not over everything:
    // offering "190 hidden" next to a search for "elf" promises matches that
    // revealing them would not produce.
    const sourceHiddenCount = showHiddenSources
      ? 0
      : entities.filter(
          (e) => matchesText(e) && !policyAllows(policy, sourceOf(e)) && !isCurrentPick(e),
        ).length;

    // Curated view: core books first (PHB before setting books), then A→Z —
    // a new player should see Human before Aarakocra. Full lists stay A→Z.
    const sorted = allowed.sort((a, b) =>
      dedupe
        ? rankOf(a) - rankOf(b) || nameOf(a).localeCompare(nameOf(b))
        : nameOf(a).localeCompare(nameOf(b)) || rankOf(a) - rankOf(b),
    );
    if (f !== '') {
      // Searching means the user wants something specific — search everything.
      return { list: sorted.filter(matchesText), hiddenCount: 0, sourceHiddenCount };
    }
    if (!dedupe || showAll) return { list: sorted, hiddenCount: 0, sourceHiddenCount };
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
    return { list: primary, hiddenCount: sorted.length - primary.length, sourceHiddenCount };
  }, [entities, filter, dedupe, showAll, selectedUid, policy, showHiddenSources]);

  return (
    <div className="flex flex-col gap-2">
      {entities.length > 10 && (
        <div className="relative">
          <Search
            size={20}
            aria-hidden="true"
            className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter the list"
            placeholder="Filter…"
            className={`${fieldClass} pl-10.5`}
          />
        </div>
      )}
      <div
        className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${fill ? '' : 'max-h-96 overflow-y-auto'}`}
      >
        {list.map((e, i) => {
          const blurb = describe?.(e);
          const selected = selectedUid === uidOf(e);
          const outside = scope === 'character' && !policyAllows(policy, sourceOf(e));
          // The aria-label hides the blurb and the out-of-sources cue from the
          // name, so they are the description.
          const blurbFor = blurb !== undefined ? `${blurbId}-${i}` : undefined;
          const outsideFor = outside ? `${blurbId}-${i}-outside` : undefined;
          const describedBy =
            [blurbFor, outsideFor].filter((id) => id !== undefined).join(' ') || undefined;
          return (
            // Under 12rem wide (large text on a phone), the name takes the
            // card's width and the check, badge and info button go under it,
            // at the right, wrapping where even they do not fit (A11Y-003).
            // The card is the query container.
            <div
              key={uidOf(e)}
              className={`@container flex flex-wrap items-start rounded-control bg-surface shadow-card ring-inset transition-[background-color,box-shadow] duration-120 hover:bg-surface-raised ${
                selected ? 'ring-2 ring-ink' : 'ring-1 ring-line'
              }`}
            >
              <button
                type="button"
                aria-label={nameOf(e)}
                aria-pressed={selected}
                aria-describedby={describedBy}
                onClick={() => {
                  // Re-tapping the current pick must never re-fire onSelect:
                  // race/background re-run pruneChoicesFor and the class picker
                  // clears every choice, silently discarding picks. Deselect when
                  // that's offered, otherwise do nothing.
                  if (selected) onDeselect?.();
                  else onSelect(e);
                }}
                title={selected && onDeselect !== undefined ? 'Tap again to unselect' : undefined}
                className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 py-3.5 pr-2 pl-4 text-left @min-[12rem]:basis-0"
              >
                {/* One line cut short, but wrapped in a narrow card, where an
                    ellipsis would leave a few letters. */}
                <span className="font-display text-title-card wrap-anywhere @min-[12rem]:truncate">
                  {nameOf(e)}
                  {selected && onDeselect !== undefined && (
                    <span className="ml-1.5 font-sans text-caption text-ink-muted">✕ unselect</span>
                  )}
                </span>
                {blurb !== undefined && (
                  <span id={blurbFor} className="text-caption text-ink-muted">
                    {blurb}
                  </span>
                )}
                {outsideFor !== undefined && <OutsideSourcesChip id={outsideFor} />}
              </button>
              <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2.5 py-3.5 pr-3">
                {selected && (
                  <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-ink text-bg">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
                <SourceBadge source={sourceOf(e)} />
                {infoType !== undefined && (
                  <EntityInfoSheet
                    type={infoType}
                    entity={e}
                    entriesOverride={infoEntries?.(e)}
                    subtitle={`${nameOf(e)} · ${sourceName(sourceOf(e))}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`${nameOf(e)} details`}
                        title="Full description"
                        className="tap -m-2.5 rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
                      >
                        <Info size={18} />
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
        <button type="button" onClick={() => setShowAll(true)} className={MORE}>
          Show {hiddenCount} more — other printings, variants & playtest content
        </button>
      )}
      {showAll && dedupe && filter === '' && (
        <button type="button" onClick={() => setShowAll(false)} className={MORE}>
          Show fewer — one printing per name
        </button>
      )}
      {sourceHiddenCount > 0 && (
        <button type="button" onClick={() => setShowHiddenSources(true)} className={MORE}>
          {hiddenSourcesLabel(sourceHiddenCount, scope)}
        </button>
      )}
      {showHiddenSources && (
        <button type="button" onClick={() => setShowHiddenSources(false)} className={MORE}>
          {backToSourcesLabel(scope)}
        </button>
      )}
    </div>
  );
}
