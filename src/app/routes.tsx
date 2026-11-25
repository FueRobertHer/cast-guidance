import type { RouteObject } from 'react-router';
import { AppNavLayout } from '@/app/AppNav';
import { AppShell } from '@/app/AppShell';
import { NotFound } from '@/app/NotFound';
import { RouteError } from '@/app/RouteError';

// The route table, apart from the router that serves it: creating a browser
// router starts it, so this module stays free of side effects for tests that
// mount the real table in a memory router.
// Route modules export `Component` (react-router lazy route module convention),
// giving route-level code splitting for free.
// `errorElement` is placed at each nesting level so a render/loader failure is
// contained to the smallest subtree (REL-005): a bad character sheet, a broken
// section, or the whole app as a last resort, never a blank crash.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        // Top-level sections share the persistent app nav.
        element: <AppNavLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, lazy: () => import('@/features/characters/CharacterListPage') },
          { path: 'library/:type?/:uid?', lazy: () => import('@/features/library/LibraryPage') },
          // The Workshop's home and its shelves' pages (ADR-002, D1).
          { path: 'workshop', lazy: () => import('@/features/workshop/WorkshopHome') },
          {
            path: 'workshop/collection/:id',
            lazy: () => import('@/features/workshop/CollectionPage'),
          },
          { path: 'workshop/rules', lazy: () => import('@/features/workshop/RulesPage') },
          // The Homebrew page and the Builder were here until the Workshop
          // took over their jobs (ADR-002, U12): an old link or bookmark
          // lands on the Workshop page that does its job.
          { path: 'homebrew/*', lazy: () => import('@/app/OldAddress') },
          { path: 'settings', lazy: () => import('@/features/settings/SettingsPage') },
          // Anything no other route claims (UX-003). It ranks below every
          // concrete path, and sitting here keeps the app nav on screen.
          { path: '*', element: <NotFound /> },
        ],
      },
      // Focused, full-screen flows (own navigation, no app tab bar).
      { path: 'create', lazy: () => import('@/features/creator/CreatorPage') },
      {
        path: 'c/:id',
        lazy: () => import('@/features/sheet/SheetLayout'),
        errorElement: <RouteError />,
        children: [
          { index: true, lazy: () => import('@/features/sheet/tabs/PlayTab') },
          { path: 'stats', lazy: () => import('@/features/sheet/tabs/StatsTab') },
          { path: 'inventory', lazy: () => import('@/features/sheet/tabs/InventoryTab') },
          { path: 'spells', lazy: () => import('@/features/sheet/tabs/SpellsTab') },
          { path: 'features', lazy: () => import('@/features/sheet/tabs/FeaturesTab') },
          { path: 'build', lazy: () => import('@/features/sheet/BuildPage') },
        ],
      },
      // Making and editing a theme (docs/theming-plan.md, phase 4).
      { path: 'settings/theme/:id?', lazy: () => import('@/features/settings/ThemeEditorPage') },
      // Making and editing an entry: `/workshop/new` and an editor's address.
      // The static Workshop paths above outrank this one.
      {
        path: 'workshop/:action/:type?/:uid?',
        lazy: () => import('@/features/workshop/WorkshopPage'),
      },
    ],
  },
];
