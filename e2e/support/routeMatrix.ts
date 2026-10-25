import type { Locator, Page } from '@playwright/test';
import { characterLink, dataFailureBanner, libraryEntry, settingsValue } from './app.ts';
import {
  type CacheLevel,
  CHARACTER_NAME,
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
}

export interface RouteCase {
  /** Names the cell in the report. */
  name: string;
  path: (m: LevelManifest) => string;
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
function sheetTab(name: string, tab: string, shows: Cell['shows']): RouteCase {
  const pageTitle = title(tab, CHARACTER_NAME);
  return {
    name: `sheet ${tab}`,
    path: (m) => `/c/${m.characterId}${name}`,
    at: (level) => (level === 'none' ? offlinePage(pageTitle) : content(pageTitle, shows)),
  };
}

const FIREBALL = 'fireball%7Cphb';

export const ROUTES: readonly RouteCase[] = [
  {
    name: 'roster',
    path: () => '/',
    at: () => content(title('Characters'), (page) => characterLink(page, CHARACTER_NAME)),
  },
  {
    name: 'library home',
    path: () => '/library',
    at: () => content(title('Library'), heading('Library')),
  },
  {
    name: 'library section',
    path: () => '/library/race',
    at: (level) =>
      level === 'none'
        ? offlineLibrary(title('Species / Races', 'Library'))
        : content(title('Species / Races', 'Library'), (page) => libraryEntry(page, 'Elf')),
  },
  {
    name: 'library spells',
    path: () => '/library/spell',
    at: (level) =>
      level === 'full'
        ? content(title('Spells', 'Library'), (page) => libraryEntry(page, 'Fireball'))
        : offlineLibrary(title('Spells', 'Library')),
  },
  {
    name: 'library entity',
    path: () => `/library/spell/${FIREBALL}`,
    at: (level) =>
      level === 'full'
        ? content(title('Fireball', 'Spells', 'Library'), heading('Fireball'))
        : offlineLibrary(title('Spells', 'Library')),
  },
  {
    name: 'library entity that does not exist',
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
    path: () => '/homebrew',
    at: () =>
      content(title('Homebrew'), (page) =>
        page.getByRole('main').getByText(`${HOMEBREW_NAME.replace(' ', '_')}.json`),
      ),
  },
  {
    name: 'homebrew file',
    path: (m) => `/homebrew/edit/${m.homebrewId}`,
    at: () => content(title(HOMEBREW_NAME, 'Homebrew editor'), heading(HOMEBREW_NAME)),
  },
  {
    name: 'homebrew file that does not exist',
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
    path: () => '/settings',
    at: (level) =>
      level === 'full'
        ? content(title('Settings'), (page) => page.getByText('ready ✓', { exact: true }))
        : content(
            title('Settings'),
            // How much is here, in words; before the first download there is
            // nothing to count against, which is not a failure to read.
            (page) =>
              settingsValue(page, 'Offline compendium').filter({
                hasText: level === 'none' ? /^not downloaded yet$/ : /^\d+\/\d+ files$/,
              }),
            // What makes the compendium complete, once back online.
            button('Make available offline'),
          ),
  },
  {
    name: 'creator',
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
  sheetTab('/build', 'Build', (page) => page.getByRole('textbox', { name: 'Name' })),
  {
    name: 'character that does not exist',
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
    path: () => '/nope',
    at: () =>
      notFound(title('Page not found'), heading('Page not found'), link('Back to characters')),
  },
];

/** Text that means a page is still waiting; none of it may outlast the state it resolves to. */
export const SPINNERS = /^(Loading…|Loading character…|Loading game data…|Deriving…)$/;

/** RouteError's heading: a page that threw. */
export const ROUTE_ERROR = 'This screen ran into a problem';
