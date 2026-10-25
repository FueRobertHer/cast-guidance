import type { Locator, Page } from '@playwright/test';
import { MIRROR_PATHS } from '../fixtures/mirror.ts';
import { characterLink, dataFailureBanner, libraryEntry, settingsValue } from './app.ts';
import {
  type CacheLevel,
  CHARACTER_NAME,
  filesAt,
  HOMEBREW_NAME,
  type LevelManifest,
} from './cacheLevels.ts';

/**
 * The PWA-001 route matrix: every route in `src/app/routes.tsx`, with deep
 * links to a sheet tab, a library entity and a homebrew file, and what each
 * must show after a cold offline launch at each cache level.
 *
 * Every cell lands in one of three states, each with its own way on:
 * - `content`: the page itself.
 * - `offline`: what the page needs is not downloaded and cannot be while
 *   offline. It says so, keeps what it can on screen, and offers Retry.
 * - `not-found`: there is no such thing (whatever is downloaded), with a link
 *   to the nearest page.
 * Never a blank screen, a spinner that does not resolve, or a raw error.
 */
export type CellState = 'content' | 'offline' | 'not-found';

export interface Cell {
  state: CellState;
  /** The whole document title. */
  title: string;
  /** What must be on screen. */
  shows: (page: Page) => Locator;
  /** The way on that the state offers: Retry, or a link to the nearest page. */
  action?: (page: Page) => Locator;
  /** Anything else the cell must show (a panel inside the page's content). */
  also?: (page: Page) => Locator;
}

export interface RouteCase {
  /** Names the cell in the report. */
  name: string;
  path: (m: LevelManifest) => string;
  /**
   * The page's frame, whatever its state: the app nav, the sheet's own tab
   * bar, or the focused flow's way back. A cell with content but no frame is
   * a page that lost its way out.
   */
  frame: (page: Page) => Locator;
  at: (level: CacheLevel) => Cell;
}

const APP = 'Cast Guidance';
const title = (...parts: string[]) => [...parts, APP].join(' · ');

/** The library's panel for a section it cannot download while offline. */
export function offlineSection(page: Page): Locator {
  return page
    .getByRole('alert')
    .filter({ hasText: "You're offline, so the rest of this section can't be downloaded yet." });
}

/** The panel a page shows when the game data it needs is not on the device and cannot be fetched offline. */
export function offlineData(page: Page): Locator {
  return page
    .getByRole('alert')
    .filter({ hasText: "You're offline, and the game data this needs isn't downloaded yet." });
}

/** The data banner's offline state, on every route while the download is incomplete. */
export function offlineBanner(page: Page): Locator {
  return dataFailureBanner(page, "You're offline, so the game data download can't finish yet.");
}

/** The class pickers' panel for a class list it cannot download while offline. */
export function offlineClassList(page: Page): Locator {
  return page
    .getByRole('alert')
    .filter({ hasText: "You're offline, so the class list can't be downloaded yet." });
}

const appNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const sheetNav = (page: Page) => page.getByRole('navigation', { name: 'Character sheet' });

const retryIn = (panel: (page: Page) => Locator) => (page: Page) =>
  panel(page).getByRole('button', { name: 'Retry' });

const link = (name: string) => (page: Page) => page.getByRole('link', { name, exact: true });
const button = (name: string) => (page: Page) => page.getByRole('button', { name, exact: true });
const heading = (name: string) => (page: Page) =>
  page.getByRole('heading', { level: 1, name, exact: true });
const text = (value: string) => (page: Page) => page.getByText(value, { exact: true });

const content = (pageTitle: string, shows: Cell['shows'], action?: Cell['action']): Cell => ({
  state: 'content',
  title: pageTitle,
  shows,
  action,
});
const notFound = (pageTitle: string, shows: Cell['shows'], action: Cell['action']): Cell => ({
  state: 'not-found',
  title: pageTitle,
  shows,
  action,
});
const offlineLibrary = (pageTitle: string): Cell => ({
  state: 'offline',
  title: pageTitle,
  shows: offlineSection,
  action: retryIn(offlineSection),
});
const offlinePage = (pageTitle: string): Cell => ({
  state: 'offline',
  title: pageTitle,
  shows: offlineData,
  action: retryIn(offlineData),
});

/** A sheet tab: the character's own page once essentials are here, the offline panel before. */
function sheetTab(
  name: string,
  tab: string,
  shows: Cell['shows'],
  also?: (level: CacheLevel) => Cell['also'],
): RouteCase {
  const pageTitle = title(tab, CHARACTER_NAME);
  return {
    name: `sheet ${tab}`,
    path: (m) => `/c/${m.characterId}${name}`,
    // The layout keeps its header and tab bar over the offline panel.
    frame: sheetNav,
    at: (level) =>
      level === 'none'
        ? offlinePage(pageTitle)
        : { ...content(pageTitle, shows), also: also?.(level) },
  };
}

/** Settings' count of the offline compendium, as the level leaves it. */
function compendiumCount(level: CacheLevel): RegExp {
  if (level === 'none') return /^not downloaded yet$/;
  if (level === 'full') return /^ready ✓$/;
  return new RegExp(`^${filesAt(level)}/${MIRROR_PATHS.length} files$`);
}

const FIREBALL = 'fireball%7Cphb';

export const ROUTES: readonly RouteCase[] = [
  {
    name: 'roster',
    frame: appNav,
    path: () => '/',
    at: () => content(title('Characters'), (page) => characterLink(page, CHARACTER_NAME)),
  },
  {
    name: 'library home',
    frame: appNav,
    path: () => '/library',
    at: () => content(title('Library'), heading('Library')),
  },
  {
    name: 'library section',
    frame: appNav,
    path: () => '/library/race',
    at: (level) =>
      level === 'none'
        ? offlineLibrary(title('Species / Races', 'Library'))
        : content(title('Species / Races', 'Library'), (page) => libraryEntry(page, 'Elf')),
  },
  {
    name: 'library spells',
    frame: appNav,
    path: () => '/library/spell',
    at: (level) =>
      level === 'full'
        ? content(title('Spells', 'Library'), (page) => libraryEntry(page, 'Fireball'))
        : offlineLibrary(title('Spells', 'Library')),
  },
  {
    name: 'library entity',
    frame: appNav,
    path: () => `/library/spell/${FIREBALL}`,
    at: (level) =>
      level === 'full'
        ? content(title('Fireball', 'Spells', 'Library'), heading('Fireball'))
        : offlineLibrary(title('Spells', 'Library')),
  },
  {
    name: 'library entity that does not exist',
    frame: appNav,
    path: () => '/library/race/nope%7Cx',
    at: (level) =>
      level === 'none'
        ? offlineLibrary(title('Species / Races', 'Library'))
        : notFound(
            title('Not found', 'Species / Races', 'Library'),
            (page) => page.getByText(/^Nothing in species \/ races is called/),
            link('Browse species / races'),
          ),
  },
  {
    name: 'library section that does not exist',
    frame: appNav,
    path: () => '/library/bogus',
    at: () =>
      notFound(
        title('No such section', 'Library'),
        (page) => page.getByText(/^There is no bogus section in the library/),
        link('Back to the library'),
      ),
  },
  {
    name: 'homebrew',
    frame: appNav,
    path: () => '/homebrew',
    at: () =>
      content(title('Homebrew'), (page) =>
        page.getByRole('main').getByText(`${HOMEBREW_NAME.replace(' ', '_')}.json`),
      ),
  },
  {
    name: 'homebrew file',
    frame: link('Back to homebrew'),
    path: (m) => `/homebrew/edit/${m.homebrewId}`,
    at: () => content(title(HOMEBREW_NAME, 'Homebrew editor'), heading(HOMEBREW_NAME)),
  },
  {
    name: 'homebrew file that does not exist',
    frame: link('Back to homebrew'),
    path: () => '/homebrew/edit/missing',
    at: () =>
      notFound(
        title('Homebrew file not found'),
        text('This homebrew file is no longer on this device.'),
        link('Go to the homebrew list'),
      ),
  },
  {
    name: 'settings',
    frame: appNav,
    path: () => '/settings',
    at: (level) =>
      content(
        title('Settings'),
        // How much is here, counted from what the level left on disk; before
        // the indexes land there is nothing to count against, which is not a
        // failure to read.
        (page) =>
          settingsValue(page, 'Offline compendium').filter({ hasText: compendiumCount(level) }),
        // What makes the compendium complete, once back online.
        level === 'full' ? undefined : button('Make available offline'),
      ),
  },
  {
    name: 'creator',
    frame: link('Back to characters (your draft is kept)'),
    path: () => '/create',
    at: (level) => {
      const pageTitle = title('Basics', 'Step 1 of 9', 'New character');
      return level === 'none'
        ? offlinePage(pageTitle)
        : content(pageTitle, (page) => page.getByRole('textbox', { name: 'Character name' }));
    },
  },
  sheetTab('', 'Play', button('Short rest')),
  sheetTab('/stats', 'Stats', (page) => page.getByRole('heading', { name: 'Saving throws' })),
  sheetTab('/inventory', 'Inventory', button('Add item')),
  sheetTab('/spells', 'Spells', text('This character has no spellcasting.')),
  sheetTab('/features', 'Features', (page) => page.getByRole('heading', { name: 'Notes' })),
  // Essentials hold no class files, so at that level the class picker says why it is empty.
  sheetTab(
    '/build',
    'Build',
    (page) => page.getByRole('textbox', { name: 'Name' }),
    (level) => (level === 'essential' ? offlineClassList : undefined),
  ),
  {
    name: 'character that does not exist',
    frame: link('Back to characters'),
    path: () => '/c/missing',
    at: () =>
      notFound(
        title('Character not found'),
        text('Character not found.'),
        link('Back to characters'),
      ),
  },
  {
    name: 'sheet tab of a character that does not exist',
    frame: link('Back to characters'),
    path: () => '/c/missing/spells',
    at: () =>
      notFound(
        title('Character not found'),
        text('Character not found.'),
        link('Back to characters'),
      ),
  },
  {
    name: 'unknown route',
    frame: appNav,
    path: () => '/nope',
    at: () =>
      notFound(title('Page not found'), heading('Page not found'), link('Back to characters')),
  },
];

/** Text that means a page is still waiting; none of it may outlast the state it resolves to. */
export const SPINNERS = /^(Loading…|Loading character…|Loading game data…|Deriving…)$/;

/** RouteError's heading: a page that threw. */
export const ROUTE_ERROR = 'This screen ran into a problem';
