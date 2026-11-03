import {
  ArrowLeft,
  Backpack,
  Check,
  CloudAlert,
  Gauge,
  Info,
  LoaderCircle,
  ScrollText,
  Sparkles,
  Swords,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams, useResolvedPath } from 'react-router';
import { DiceTray } from '@/features/dice/DiceTray';
import { usePageTitle } from '@/lib/usePageTitle';
import { useStickyHeight } from '@/lib/useStickyHeight';
import { announce } from '@/stores/announcer';
import { AdvToggle } from '@/ui/AdvToggle';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { GameDataProblem } from '@/ui/GameDataProblem';
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

/** The warning when the same character is open in another tab, shown and said. */
export const OPEN_ELSEWHERE_TEXT =
  'This character is open in another tab. If both change it, you will be asked which version to keep.';

/**
 * The pill behind a tab's icon, filled `surface-raised` for the open tab
 * (DS-001). With the label's bold weight it marks the open tab by more than
 * colour alone (A11Y-002). Decorative: NavLink reports the page through
 * `aria-current`. On the side rail the whole row takes the fill instead.
 * AppNav draws the same one. Sharing a module between the two pulled the data
 * registry chunk into the entry bundle (+140 KB), so each keeps its own copy.
 */
function TabPill({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      {...(active ? { 'data-indicator': '' } : {})}
      className={`flex h-7.5 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-out lg:size-auto lg:bg-transparent ${active ? 'bg-surface-raised' : ''}`}
    >
      {children}
    </span>
  );
}

export function Component() {
  const { id } = useParams();
  // Published for a tab's own sticky bar to sit under, and for the scroll
  // padding that keeps a focused control out from behind the header.
  const header = useStickyHeight('--sheet-header-h');
  const state = useCharacterSheet(id);
  const openElsewhere = useOpenElsewhere(id);
  // Said through the announcer when it starts (A11Y-002): the banner mounts
  // with its text, and a status region that does that is heard unreliably.
  useEffect(() => {
    if (openElsewhere) announce(OPEN_ELSEWHERE_TEXT, { key: 'open-elsewhere' });
  }, [openElsewhere]);
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
      <main className="flex flex-1 items-center gap-2 p-4 text-body text-ink-muted" role="status">
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        Loading character…
      </main>
    );
  }

  if (state.loadStatus === 'error') {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4" role="alert">
        <p className="text-body text-danger">Could not load this character: {state.error}</p>
        <div className="flex items-center gap-3">
          <Button variant="brand" onClick={state.retryLoad}>
            Retry
          </Button>
          <Link to="/" className="tap px-2 text-body-strong text-ink-muted hover:text-ink">
            Back to characters
          </Link>
        </div>
      </main>
    );
  }

  if (state.missing) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-body text-ink-muted">Character not found.</p>
        <Link to="/" className="tap self-start text-body-strong text-brand">
          Back to characters
        </Link>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header
        ref={header}
        // Opaque `bg` (DS-001): content scrolling under a translucent wash
        // showed through behind the name.
        className="sticky top-0 z-20 flex min-h-header items-center gap-2 bg-bg py-1 pr-2 pl-1 lg:pl-40"
      >
        <Link
          to="/"
          aria-label="Back to characters"
          className="tap rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          {/* Focusable, so resolving a save conflict (SaveConflictBanner) can
              land here once the banner and its buttons go away. */}
          <h1
            id="sheet-title"
            tabIndex={-1}
            className="truncate font-display text-title-sheet outline-none"
          >
            {state.doc?.name ?? '…'}
          </h1>
          <p className="truncate text-caption text-ink-muted">{state.sheet?.classLabel ?? ''}</p>
        </div>
        {/* Visual only (A11Y-002). As a live region it said "Unsaved, Saving,
            Saved" for every HP tap. A failure or a refused save is announced
            by the app shell's banners, and the recovery after one by the
            announcer. */}
        <span
          data-save-indicator=""
          // A failure in `danger`: the one state that needs the person.
          className={`flex items-center gap-1 px-1 text-[0.75rem] leading-4 ${
            state.saveStatus === 'error' || state.saveStatus === 'conflict'
              ? 'font-semibold text-danger'
              : 'text-ink-muted'
          }`}
        >
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
          {/* Not CircleAlert, which the app shell's banners use: an icon
              imported both here and by the entry had Vite's bundler fold the
              data registry chunk into the entry (+150 KB, DS-001), as sharing
              the tab marker did (see TabPill). */}
          {state.saveStatus === 'error' && (
            <>
              <CloudAlert size={13} aria-hidden="true" /> Save failed
            </>
          )}
          {state.saveStatus === 'conflict' && (
            <>
              <CloudAlert size={13} aria-hidden="true" /> Not saved
            </>
          )}
        </span>
        {id !== undefined && <HistoryDrawer charId={id} />}
      </header>
      {openElsewhere && (
        <Banner tone="neutral" icon={Info}>
          {OPEN_ELSEWHERE_TEXT}
        </Banner>
      )}
      <main className="flex-1 px-4 pt-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4 lg:pl-40">
        {state.sheet === null && state.data.status === 'error' ? (
          // Every tab is derived from the game data, so none of them can draw
          // without it; the header above still names the character, which is
          // safe on the device either way.
          <GameDataProblem
            error={state.data.error}
            onRetry={state.data.retry}
            note="Your character is saved on this device."
          />
        ) : (
          <Outlet context={state} />
        )}
      </main>
      {/* Boxed as the app nav is (see AppNav). */}
      <nav
        aria-label="Character sheet"
        className="fixed inset-x-0 bottom-0 z-10 box-content flex h-tabbar border-line border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:box-border lg:right-auto lg:h-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4 lg:pb-0"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center gap-0.75 pt-1.5 text-tab lg:min-h-tap lg:flex-none lg:flex-row lg:gap-2.5 lg:rounded-control lg:px-3 lg:text-label ${
                isActive
                  ? 'font-bold text-ink lg:bg-surface-raised'
                  : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* The current tab is marked by weight and a pill, not by
                    colour alone (A11Y-002); NavLink sets aria-current. */}
                <TabPill active={isActive}>
                  <Icon size={20} aria-hidden className="lg:size-4.5" />
                </TabPill>
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
