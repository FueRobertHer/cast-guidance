import { Check, Info, RefreshCcw, Search, X } from 'lucide-react';
import { type Ref, useId, useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import {
  applySourcePolicy,
  backToSourcesLabel,
  hiddenSourcesLabel,
  policyAllows,
} from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import { Button, buttonClass } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
import { OutsideSourcesChip } from '@/ui/OutsideSourcesChip';
import { SourceBadge, sourceBadgeLabel } from '@/ui/SourceBadge';
import { fieldClass } from '@/ui/TextField';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
/** An entity's id as `selectedUid` spells it: `name|source`, lower case. */
export const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

/** An option card's ground and edge: picked takes the 2px `ink` edge. */
const cardShell = (selected: boolean) =>
  `@container flex flex-wrap items-start rounded-control bg-surface shadow-card ring-inset ${
    selected ? 'ring-2 ring-ink' : 'ring-1 ring-line'
  }`;

/** A card's right-hand side: the pick's check, the source badge, and ⓘ when asked for. */
function CardSide({
  entity,
  label = nameOf(entity),
  badge = true,
  selected,
  infoType,
  infoEntries,
}: {
  entity: Entity;
  /** The card's name as a screen reader hears it, which ⓘ's name starts with. */
  label?: string;
  /** False where the card's printing switch already shows the book. */
  badge?: boolean;
  selected: boolean;
  infoType?: string;
  infoEntries?: (e: Entity) => unknown;
}) {
  return (
    <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2.5 py-3.5 pr-3">
      {selected && (
        <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-ink text-bg">
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        </span>
      )}
      {badge && <SourceBadge source={sourceOf(entity)} />}
      {infoType !== undefined && (
        <EntityInfoSheet
          type={infoType}
          entity={entity}
          entriesOverride={infoEntries?.(entity)}
          subtitle={`${nameOf(entity)} · ${sourceName(sourceOf(entity))}`}
          trigger={
            <button
              type="button"
              aria-label={`${label} details`}
              title="Full description"
              className="tap -m-2.5 rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <Info size={18} />
            </button>
          }
        />
      )}
    </div>
  );
}

/**
 * A pick standing in for the list it was made from: the same option card,
 * picked, with one way back to the list. Its name is the heading of what
 * follows the pick, and where focus lands once the list folds away.
 */
export function PickedEntityCard({
  entity,
  describe,
  infoType,
  infoEntries,
  heading: Heading = 'h2',
  headingRef,
  changeLabel,
  onChange,
}: {
  entity: Entity;
  describe?: (e: Entity) => string | undefined;
  infoType?: string;
  infoEntries?: (e: Entity) => unknown;
  /** The name's heading level, under whatever heads the page around it. */
  heading?: 'h2' | 'h3' | 'h4';
  headingRef?: Ref<HTMLHeadingElement>;
  /** The button's words, which say what it changes ("Change class"). */
  changeLabel: string;
  onChange: () => void;
}) {
  const blurb = describe?.(entity);
  return (
    <div className={cardShell(true)}>
      <div className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 pt-3.5 pr-2 pl-4 @min-[12rem]:basis-0">
        {/* Focused from script only, and the app-wide ring skips tabindex -1. */}
        <Heading
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-title-card wrap-anywhere outline-none"
        >
          {nameOf(entity)}
        </Heading>
        {blurb !== undefined && <p className="text-caption text-ink-muted">{blurb}</p>}
      </div>
      <CardSide entity={entity} selected infoType={infoType} infoEntries={infoEntries} />
      {/* The small button's own 4px border is the rest of the card's 16px inset. */}
      <div className="basis-full px-3 pt-1 pb-2.5">
        <Button variant="outline" size="sm" onClick={onChange}>
          <RefreshCcw size={14} aria-hidden /> {changeLabel}
        </Button>
      </div>
    </div>
  );
}

/** The order books come in, core books first (lower = earlier). */
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
const byName = (a: Entity, b: Entity) => nameOf(a).localeCompare(nameOf(b));
/** Two printings of one name: by rank, then by title for the unranked books. */
const byBook = (a: Entity, b: Entity) =>
  rankOf(a) - rankOf(b) || sourceName(sourceOf(a)).localeCompare(sourceName(sourceOf(b)));

/** Playtest material, sidekicks, and named variants belong behind the fold. */
const isNiche = (e: Entity) =>
  sourceOf(e).toLowerCase().startsWith('ua') ||
  nameOf(e).toLowerCase().includes('sidekick') ||
  nameOf(e).includes(';');

/** What makes two entities printings of one title: the name, ignoring case. */
const titleKeyOf = (e: Entity) => nameOf(e).toLowerCase();

/** One card: a name and every printing of it in the list, in book order. */
interface Title {
  key: string;
  printings: readonly Entity[];
}

/**
 * Group a sorted list into titles, in the order each first appears. A second
 * entity with a uid already seen is dropped, since the registry answers that
 * uid with the first and a chip for it would pick the other one.
 */
function groupTitles(list: readonly Entity[]): Title[] {
  const byKey = new Map<string, Entity[]>();
  for (const e of list) {
    const printings = byKey.get(titleKeyOf(e));
    if (printings === undefined) byKey.set(titleKeyOf(e), [e]);
    else if (!printings.some((p) => uidOf(p) === uidOf(e))) printings.push(e);
  }
  return [...byKey].map(([key, printings]) => ({ key, printings }));
}

/**
 * The books a card's title is printed in, as the library entry's switch draws
 * them: a code chip each, the full title in its name. The pressed chip is the
 * printing the card shows, and so the one a tap on the card picks.
 */
function PrintingSwitch({
  name,
  printings,
  shownUid,
  onShow,
}: {
  name: string;
  printings: readonly Entity[];
  shownUid: string;
  onShow: (e: Entity) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs
    <div
      role="group"
      aria-label={`${name}, printed in`}
      className="-mt-1.5 flex basis-full flex-wrap items-center gap-x-2 px-4 pb-2"
    >
      <span aria-hidden="true" className="text-caption text-ink-muted">
        Printed in
      </span>
      {/* Chips with a 44px tap from their transparent border, so the row
          pulls in by that border to line up with the text. */}
      <div className="-mx-1.5 flex flex-wrap">
        {printings.map((p) => {
          const source = sourceOf(p);
          return (
            <Chip
              key={uidOf(p)}
              tone="outline"
              className="uppercase"
              pressed={uidOf(p) === shownUid}
              // The code is what shows; the title is what it means.
              aria-label={`${source}, ${sourceBadgeLabel(source)}`}
              title={sourceBadgeLabel(source)}
              onClick={() => onShow(p)}
            >
              {source}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

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
 *
 * A card is a title, not a printing. Each book has its own rules for a name
 * (VGM's Goblin is not MPMM's), so the player has to be able to choose which
 * to play, but a card per printing made the species list half again as long.
 * A title in several books has a "Printed in" switch in place of the badge:
 * it changes which printing the card shows (blurb, ⓘ) and so which one a tap
 * on the card picks. It opens on the current pick, else on the first book.
 */
export function EntityCardList({
  entities,
  selectedUid,
  onSelect,
  onDeselect,
  onReselect,
  curated = false,
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
   * Without `onDeselect`, what tapping the selected card does: picks it again,
   * for a list that closes on its pick. Absent, the tap does nothing.
   */
  onReselect?: () => void;
  /**
   * Curate the default view: titles printed in a core book first (PHB before
   * setting books), then A→Z, with playtest material, sidekicks and named
   * variants behind a "show more" toggle. Filtering always searches everything.
   */
  curated?: boolean;
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
  // The printing each switched card shows, by title key. Only what the
  // player switched to is kept: the rest open on the pick or the first book.
  const [shownByTitle, setShownByTitle] = useState<Readonly<Record<string, string>>>({});

  const { titles, hiddenCount, sourceHiddenCount } = useMemo(() => {
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

    // Curated view: titles in a core book first (PHB before setting books),
    // then A→Z, so a new player sees Human before Aarakocra. A title sits by
    // its best book: a Goblin in MPMM and GGR is filed with MPMM, not GGR.
    // Full lists stay A→Z. Either way a title's printings end up side by side,
    // in book order, which is the order its switch offers them in.
    const bestRank = new Map<string, number>();
    if (curated) {
      for (const e of allowed) {
        const key = titleKeyOf(e);
        bestRank.set(key, Math.min(bestRank.get(key) ?? rankOf(e), rankOf(e)));
      }
    }
    const rankOfTitle = (e: Entity) => bestRank.get(titleKeyOf(e)) ?? 0;
    const sorted = allowed.sort(
      (a, b) => rankOfTitle(a) - rankOfTitle(b) || byName(a, b) || byBook(a, b),
    );
    // Searching means the user wants something specific, so search everything.
    // Otherwise the curated view folds the niche away, but never the pick.
    const searching = f !== '';
    const shown = searching
      ? sorted.filter(matchesText)
      : !curated || showAll
        ? sorted
        : sorted.filter((e) => !isNiche(e) || isCurrentPick(e));
    return {
      titles: groupTitles(shown),
      hiddenCount: searching ? 0 : sorted.length - shown.length,
      sourceHiddenCount,
    };
  }, [entities, filter, curated, showAll, selectedUid, policy, showHiddenSources]);

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
        {titles.map(({ key, printings }, i) => {
          const e =
            printings.find((p) => uidOf(p) === shownByTitle[key]) ??
            printings.find((p) => uidOf(p) === selectedUid) ??
            (printings[0] as Entity);
          const switched = printings.length > 1;
          // Several cards' names would otherwise be the same "Goblin", and
          // what a tap picks is this one book's.
          const label = switched ? `${nameOf(e)}, ${sourceBadgeLabel(sourceOf(e))}` : nameOf(e);
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
              key={key}
              className={`${cardShell(selected)} transition-[background-color,box-shadow] duration-120 hover:bg-surface-raised`}
            >
              <button
                type="button"
                aria-label={label}
                aria-pressed={selected}
                aria-describedby={describedBy}
                onClick={() => {
                  // Re-tapping the current pick must never re-fire onSelect:
                  // race/background re-run pruneChoicesFor and the class picker
                  // clears every choice, silently discarding picks. Deselect when
                  // that's offered, else reselect when that is, else do nothing.
                  if (selected) (onDeselect ?? onReselect)?.();
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
                    <span className="ml-1.5 inline-flex items-center gap-0.5 font-sans text-caption text-ink-muted">
                      <X size={14} aria-hidden="true" /> Unselect
                    </span>
                  )}
                </span>
                {blurb !== undefined && (
                  <span id={blurbFor} className="text-caption text-ink-muted">
                    {blurb}
                  </span>
                )}
                {outsideFor !== undefined && <OutsideSourcesChip id={outsideFor} />}
              </button>
              <CardSide
                entity={e}
                label={label}
                badge={!switched}
                selected={selected}
                infoType={infoType}
                infoEntries={infoEntries}
              />
              {switched && (
                <PrintingSwitch
                  name={nameOf(e)}
                  printings={printings}
                  shownUid={uidOf(e)}
                  onShow={(p) => setShownByTitle((shown) => ({ ...shown, [key]: uidOf(p) }))}
                />
              )}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className={MORE}>
          Show {hiddenCount} more: playtest content, sidekicks and variants
        </button>
      )}
      {showAll && curated && filter === '' && (
        <button type="button" onClick={() => setShowAll(false)} className={MORE}>
          Show fewer: hide playtest content, sidekicks and variants
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
