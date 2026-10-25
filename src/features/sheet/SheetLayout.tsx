import {
  ArrowLeft,
  Backpack,
  Check,
  CircleAlert,
  Gauge,
  LoaderCircle,
  ScrollText,
  Sparkles,
  Swords,
  Wrench,
} from 'lucide-react';
import { type CSSProperties, useLayoutEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams, useResolvedPath } from 'react-router';
import { DiceTray } from '@/features/dice/DiceTray';
import { usePageTitle } from '@/lib/usePageTitle';
import { AdvToggle } from '@/ui/AdvToggle';
import { HistoryDrawer } from './HistoryDrawer';
import { useCharacterSheet } from './useCharacterSheet';
import { useOpenElsewhere } from './useOpenElsewhere';

// `label` is sized for the tab bar; `title` is what the document title says,
// where "More" and "Items" would not tell a history list which screen it was.
const tabs = [
  { to: '.', label: 'Play', title: 'Play', icon: Swords, end: true },
  { to: 'stats', label: 'Stats', title: 'Stats', icon: Gauge, end: false },
  { to: 'inventory', label: 'Items', title: 'Inventory', icon: Backpack, end: false },
  { to: 'spells', label: 'Spells', title: 'Spells', icon: Sparkles, end: false },
  { to: 'features', label: 'More', title: 'Features', icon: ScrollText, end: false },
  { to: 'build', label: 'Build', title: 'Build', icon: Wrench, end: false },
] as const;

/**
 * Tabs that carry the floating dice cluster (advantage toggle above the tray
 * button). Play and Stats are where rolls actually start; everywhere else the
 * pair is two controls covering the content to reach a log of rolls you can't
 * make from that screen. `''` is the index route, Play.
 */
const ROLLING_TABS = new Set(['', 'stats']);

/**
 * Child segment of the sheet route ('' on Play, 'inventory', 'build', …).
 * Derived from the layout's own resolved path rather than a segment index, so
 * it survives the sheet being mounted somewhere other than `/c/:id`.
 */
export function sheetTab(basePath: string, pathname: string): string {
  return pathname.slice(basePath.length).replaceAll(/^\/+|\/+$/g, '');
}

/** Whether the dice cluster belongs on a tab; see {@link ROLLING_TABS}. */
export function tabRolls(tab: string): boolean {
  return ROLLING_TABS.has(tab);
}

/** Document-title name for a tab segment ('' is Play); undefined if unknown. */
export function tabTitle(tab: string): string | undefined {
  return tabs.find((t) => (t.to === '.' ? '' : t.to) === tab)?.title;
}

/**
 * The sticky header's height, published as `--sheet-header-h` so a tab's own
 * sticky bar can sit under it instead of behind it. Both stick to the
 * viewport, and the header draws on top, so a bar at `top-0` was hidden behind
 * it once the page scrolled (the build page's Undo was out of reach on a
 * phone). Measured, because the class line under the name can be empty.
 */
export function useHeaderHeight() {
  // A callback ref: the header only mounts once the character has loaded.
  const [el, header] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (el === null) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { header, style: { '--sheet-header-h': `${height}px` } as CSSProperties };
}

/**
 * Marks the open tab with a bar along its top edge (bottom bar) or its left
 * edge (side rail), so it is not told apart by colour alone (A11Y-002).
 * Decorative: NavLink reports the page through `aria-current`. AppNav draws
 * the same one. Sharing a module between the two pulled the data registry
 * chunk into the entry bundle (+140 KB), so each keeps its own copy.
 */
function ActiveTabBar() {
  return (
    <span
      aria-hidden="true"
      data-indicator=""
      className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent lg:inset-x-auto lg:inset-y-2 lg:left-0 lg:h-auto lg:w-0.5"
    />
  );
}

export function Component() {
  const { id } = useParams();
  const headerHeight = useHeaderHeight();
  const state = useCharacterSheet(id);
  const openElsewhere = useOpenElsewhere(id);
  const tab = sheetTab(useResolvedPath('.').pathname, useLocation().pathname);
  const rollsHere = tabRolls(tab);
  // The layout owns the title for every tab (see usePageTitle): the tabs are
  // its children, and their effects would run first and lose to it anyway.
  usePageTitle(
    ...(state.loadStatus === 'loading' || state.loadStatus === 'idle'
      ? ['Loading character']
      : state.loadStatus === 'error'
        ? ['Could not load character']
        : state.missing
          ? ['Character not found']
          : [tabTitle(tab), state.doc?.name.trim() || 'Unnamed character']),
  );

  if (state.loadStatus === 'loading' || state.loadStatus === 'idle') {
    return (
      <main className="flex flex-1 items-center gap-2 p-4 text-sm text-ink-muted" role="status">
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        Loading character…
      </main>
    );
  }

  if (state.loadStatus === 'error') {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4" role="alert">
        <p className="text-sm text-accent">Could not load this character: {state.error}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={state.retryLoad}
            className="text-sm font-semibold text-accent"
          >
            Retry
          </button>
          <Link to="/" className="text-sm text-ink-muted">
            Back to characters
          </Link>
        </div>
      </main>
    );
  }

  if (state.missing) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-sm text-ink-muted">Character not found.</p>
        <Link to="/" className="text-sm text-accent">
          Back to characters
        </Link>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col" style={headerHeight.style}>
      <header
        ref={headerHeight.header}
        className="sticky top-0 z-20 flex items-center gap-2 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:pl-40"
      >
        <Link
          to="/"
          aria-label="Back to characters"
          className="tap -my-2 -ml-3 rounded text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{state.doc?.name ?? '…'}</h1>
          <p className="truncate text-xs text-ink-muted">{state.sheet?.classLabel ?? ''}</p>
        </div>
        {/* Visual only (A11Y-002). As a live region it said "Unsaved, Saving,
            Saved" for every HP tap. A failure is announced by the app shell's
            save banner, and the recovery after one by the announcer. */}
        <span data-save-indicator="" className="flex items-center gap-1 text-xs text-ink-muted">
          {state.saveStatus === 'pending' && 'Unsaved'}
          {state.saveStatus === 'saving' && (
            <>
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> Saving
            </>
          )}
          {state.saveStatus === 'saved' && (
            <>
              <Check size={13} aria-hidden="true" /> Saved
            </>
          )}
          {state.saveStatus === 'error' && (
            <>
              <CircleAlert size={13} aria-hidden="true" /> Save failed
            </>
          )}
        </span>
        {id !== undefined && <HistoryDrawer charId={id} />}
      </header>
      {openElsewhere && (
        <div className="bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200 lg:pl-40" role="status">
          This character is open in another tab — edits in one can overwrite the other.
        </div>
      )}
      <main className="flex-1 px-4 pt-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4 lg:pl-40">
        <Outlet context={state} />
      </main>
      <nav
        aria-label="Character sheet"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-surface-2 bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[11px] lg:flex-none lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-lg lg:px-3 lg:py-2 lg:text-sm ${
                isActive ? 'font-semibold text-accent' : 'font-medium text-ink-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* The current tab is marked by weight and a bar, not by
                    colour alone (A11Y-002); NavLink sets aria-current. */}
                {isActive && <ActiveTabBar />}
                <Icon size={20} aria-hidden className="lg:size-[17px]" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {rollsHere && (
        <>
          <AdvToggle />
          <DiceTray />
        </>
      )}
    </div>
  );
}
