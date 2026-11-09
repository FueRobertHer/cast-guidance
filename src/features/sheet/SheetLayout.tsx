import {
  ArrowLeft,
  Backpack,
  Cloud,
  CloudAlert,
  CloudCheck,
  Download,
  Gauge,
  History,
  Info,
  LoaderCircle,
  Pencil,
  ScrollText,
  Sparkles,
  Swords,
  Trash2,
} from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { DiceTray } from '@/features/dice/DiceTray';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { useStickyHeight } from '@/lib/useStickyHeight';
import { announce } from '@/stores/announcer';
import { notifyFailure } from '@/stores/notices';
import { AdvToggle } from '@/ui/AdvToggle';
import { Banner } from '@/ui/Banner';
import { Button, ButtonCount, buttonClass } from '@/ui/Button';
import { GameDataProblem } from '@/ui/GameDataProblem';
import { PackProblem } from '@/ui/PackProblem';
import {
  confirmDeleteCharacter,
  deleteCharacter,
  exportCharacter,
} from '../characters/characterActions';
import { ConditionStrip } from './ConditionStrip';
import { HistoryDrawer } from './HistoryDrawer';
import { useRollOfferSpending } from './rollOfferSpending';
import { SheetMenu } from './SheetMenu';
import { type CharacterSheetState, useCharacterSheet } from './useCharacterSheet';
import { useOpenElsewhere } from './useOpenElsewhere';

// The tab bar, in the design system's order. `label` is sized for the bar;
// `title` is what the document title says, where "Items" would not tell a
// history list which screen it was. Build is not a tab: the header's Edit
// opens it (see BUILD).
const tabs = [
  { to: '.', label: 'Play', title: 'Play', icon: Swords, end: true },
  { to: 'stats', label: 'Stats', title: 'Stats', icon: Gauge, end: false },
  { to: 'spells', label: 'Spells', title: 'Spells', icon: Sparkles, end: false },
  { to: 'inventory', label: 'Items', title: 'Inventory', icon: Backpack, end: false },
  { to: 'features', label: 'Features', title: 'Features', icon: ScrollText, end: false },
] as const;

/** Build's route segment, reached from the header's Edit rather than the tab bar. */
const BUILD = 'build';

/**
 * Location state on the way into Build: the tab it was opened from, so Back
 * on Build returns there. It rides on the history entry, so a Build reached
 * again by the browser's own Back and Forward still knows where it came from.
 * FeaturesTab's link to Build sets it too.
 */
export interface BuildFrom {
  sheetFrom: string;
}

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

function tabFor(tab: string) {
  return tabs.find((t) => (t.to === '.' ? '' : t.to) === tab);
}

/** Document-title name for a tab segment ('' is Play); undefined if unknown. */
export function tabTitle(tab: string): string | undefined {
  return tab === BUILD ? 'Build' : tabFor(tab)?.title;
}

/** The tab a Build visit was opened from, if its location state names one. */
export function buildFrom(state: unknown): (typeof tabs)[number] | undefined {
  if (typeof state !== 'object' || state === null || !('sheetFrom' in state)) return undefined;
  return typeof state.sheetFrom === 'string' ? tabFor(state.sheetFrom) : undefined;
}

/**
 * Whether the tab bar shows Spells: for a character with spellcasting, and on
 * the Spells route itself, so a link straight to a non-caster's Spells still
 * shows where it is. Hidden until the sheet is derived, since only the class
 * data says who casts.
 */
export function showsSpells(tab: string, spellcastingBlocks: number | undefined): boolean {
  return tab === 'spells' || (spellcastingBlocks ?? 0) > 0;
}

/** Edit's accessible name, which says the count its badge shows. */
export function editLabel(pending: number): string {
  if (pending === 0) return 'Edit character';
  return `Edit character, ${pending} ${pending === 1 ? 'choice' : 'choices'} to make`;
}

/** A click a link should take as it would without script: new tab, window, download. */
function modifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** The warning when the same character is open in another tab, shown and said. */
export const OPEN_ELSEWHERE_TEXT =
  'This character is open in another tab. If both change it, you will be asked which version to keep.';

/**
 * The header's save state as an icon and a word, or null before the first
 * save. A failure is in `danger` with CloudAlert, the one state that needs the
 * person. Not CircleAlert, which the app shell's banners use: an icon imported
 * both here and by the entry had Vite's bundler fold the data registry chunk
 * into the entry (+150 KB, DS-001), as sharing the tab marker did (see TabPill).
 */
function saveIndicator(
  status: CharacterSheetState['saveStatus'],
): { icon: ReactNode; word: string; failed: boolean } | null {
  switch (status) {
    case 'pending':
      return { icon: <Cloud size={14} aria-hidden="true" />, word: 'Unsaved', failed: false };
    case 'saving':
      return {
        icon: <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />,
        word: 'Saving',
        failed: false,
      };
    case 'saved':
      return { icon: <CloudCheck size={14} aria-hidden="true" />, word: 'Saved', failed: false };
    case 'error':
      return {
        icon: <CloudAlert size={14} aria-hidden="true" />,
        word: 'Save failed',
        failed: true,
      };
    case 'conflict':
      return { icon: <CloudAlert size={14} aria-hidden="true" />, word: 'Not saved', failed: true };
    default:
      return null;
  }
}

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
      className={`flex h-[30px] w-[56px] items-center justify-center rounded-full transition-colors duration-200 ease-out lg:size-auto lg:bg-transparent ${active ? 'bg-surface-raised' : ''}`}
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
  // The roll toast spends the dice it offers through this (Bardic Inspiration).
  useRollOfferSpending(state.doc, state.sheet, state.update);
  const openElsewhere = useOpenElsewhere(id);
  // Said through the announcer when it starts (A11Y-002): the banner mounts
  // with its text, and a status region that does that is heard unreliably.
  useEffect(() => {
    if (openElsewhere) announce(OPEN_ELSEWHERE_TEXT, { key: 'open-elsewhere' });
  }, [openElsewhere]);
  const location = useLocation();
  const navigate = useNavigate();
  const tab = sheetTab(useResolvedPath('.').pathname, location.pathname);
  const rollsHere = tabRolls(tab);
  const onBuild = tab === BUILD;
  // Back on Build returns to the tab Build was opened from, a step back
  // through history (or to that tab, on a first entry). Build reached any
  // other way (a link from outside, a new blank character) goes up to the
  // roster, as every tab does.
  const from = onBuild ? buildFrom(location.state) : undefined;
  const back = useBack(from?.to ?? '/');
  const menuButton = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const doc = state.doc;
  const pending = state.sheet?.pending.length ?? 0;
  // Species, class and level.
  const who = [doc?.race?.name, state.sheet?.classLabel].filter(Boolean).join(' ');
  const saveState = saveIndicator(state.saveStatus);

  const menu = [
    { label: 'History', icon: History, dialog: true, onSelect: () => setHistoryOpen(true) },
    {
      label: 'Export',
      icon: Download,
      // The character as it is on screen, an edit still waiting to save included.
      onSelect: () => {
        if (doc !== null) exportCharacter(doc).catch((err) => notifyFailure('Export', err));
      },
    },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      dialog: true,
      onSelect: async () => {
        if (doc === null || !(await confirmDeleteCharacter(doc.name))) return;
        // Off the sheet first, so it never draws the character going away
        // under the person. A failed delete is reported over the roster,
        // where the character is still listed.
        await navigate('/', { replace: true });
        await deleteCharacter(doc.id).catch((err) => notifyFailure('Delete', err));
      },
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header
        ref={header}
        // Opaque `bg` (DS-001): content scrolling under a translucent wash
        // showed through behind the name. It wraps at a large text size: the
        // name keeps 6rem, and Edit and the menu go under it as a pair before
        // they squeeze it out of sight.
        className="sticky top-0 z-20 flex min-h-header flex-wrap items-center gap-1 bg-bg py-1 pr-1 pl-1 lg:pl-40"
      >
        <Link
          to={from?.to ?? '/'}
          aria-label={from === undefined ? 'Back to characters' : `Back to ${from.label}`}
          onClick={(event) => {
            if (from === undefined || modifiedClick(event)) return;
            event.preventDefault();
            back();
          }}
          className="tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-24 flex-1 px-1">
          {/* Focusable, so resolving a save conflict (SaveConflictBanner) can
              land here once the banner and its buttons go away. */}
          <h1
            id="sheet-title"
            tabIndex={-1}
            className="truncate font-display text-title-sheet outline-none"
          >
            {doc?.name ?? '…'}
          </h1>
          <p className="flex min-w-0 items-center gap-1 text-caption text-ink-muted">
            {who !== '' && <span className="truncate">{who}</span>}
            {who !== '' && saveState !== null && <span aria-hidden="true">·</span>}
            {/* Visual only (A11Y-002). As a live region it said "Unsaved,
                Saving, Saved" for every HP tap. A failure or a refused save
                is announced by the app shell's banners, and the recovery after
                one by the announcer. Never truncated: the class line gives
                way to it. Always there, empty and out of the layout while
                nothing has been saved yet, so what waits on it finds it. */}
            <span
              data-save-indicator=""
              className={`flex shrink-0 items-center gap-1 empty:hidden ${
                saveState?.failed === true ? 'font-semibold text-danger' : ''
              }`}
            >
              {saveState?.icon}
              {saveState?.word}
            </span>
          </p>
        </div>
        {/* Build's way in, from every tab. Its count keeps unmade choices in
            sight wherever the player is ("Edit 2"). On Build it is the current
            page, and passes Build's own state on: a link to the page it is on
            replaces that history entry. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <NavLink
            to={BUILD}
            state={onBuild ? location.state : ({ sheetFrom: tab } satisfies BuildFrom)}
            aria-label={editLabel(pending)}
            className={({ isActive }) =>
              `${buttonClass({ variant: 'outline', size: 'sm' })} ${isActive ? 'bg-surface-raised' : ''}`
            }
          >
            <Pencil size={16} aria-hidden="true" />
            Edit
            {pending > 0 && <ButtonCount>{pending}</ButtonCount>}
          </NavLink>
          <SheetMenu label="More: history, export, delete" items={menu} buttonRef={menuButton} />
        </div>
        {/* Its own row, inside the header so it sticks with it and counts in
            the height the header publishes. Not on Build, which edits the
            character rather than plays it. */}
        {doc !== null && !onBuild && (
          <ConditionStrip
            doc={doc}
            sheet={state.sheet}
            update={state.update}
            addable={tab === ''}
          />
        )}
        {id !== undefined && (
          <HistoryDrawer
            charId={id}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            returnFocus={menuButton}
          />
        )}
      </header>
      {openElsewhere && (
        <Banner tone="neutral" icon={Info}>
          {OPEN_ELSEWHERE_TEXT}
        </Banner>
      )}
      {/* Where the dice dock floats, the page ends far enough down that the
          last row scrolls clear of it (DS-001 DiceDock): the spec's page
          padding of tab bar, dock and space-12, and from `lg`, where the dock
          sits 1.5rem up with no tab bar, space-12 above the dock. */}
      <main
        className={`flex-1 px-4 pt-1 lg:pl-40 ${
          rollsHere
            ? 'pb-[calc(var(--spacing-tabbar)+var(--spacing-dock)+3rem+env(safe-area-inset-bottom))] lg:pb-[calc(1.5rem+var(--spacing-dock)+3rem)]'
            : 'pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4'
        }`}
      >
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
          <>
            {state.data.equipment !== undefined && (
              <div className="mb-3">
                <PackProblem
                  packs={state.data.equipment}
                  what="equipped items"
                  message="Some equipped items aren't downloaded, so AC and attacks leave them out."
                />
              </div>
            )}
            <Outlet context={state} />
          </>
        )}
      </main>
      {/* Boxed as the app nav is (see AppNav). */}
      <nav
        aria-label="Character sheet"
        className="fixed inset-x-0 bottom-0 z-10 box-content flex h-tabbar border-line border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:box-border lg:right-auto lg:h-auto lg:w-36 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:px-2 lg:pt-4 lg:pb-0"
      >
        {tabs.map(({ to, label, icon: Icon, end }) =>
          to === 'spells' && !showsSpells(tab, state.sheet?.spellcasting.length) ? null : (
            <NavLink
              key={label}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 flex-col items-center gap-[3px] pt-[6px] text-tab lg:min-h-tap lg:flex-none lg:flex-row lg:gap-2.5 lg:rounded-control lg:px-3 lg:text-label ${
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
          ),
        )}
      </nav>
      {rollsHere && <AdvToggle />}
      {/* On every page of the sheet, so a tap on the roll toast can open its
          history wherever the roll was made; its button only in the dock. */}
      <DiceTray dock={rollsHere} />
    </div>
  );
}
