import { createBrowserRouter } from 'react-router';
import { AppNavLayout } from '@/app/AppNav';
import { AppShell } from '@/app/AppShell';
import { RouteError } from '@/app/RouteError';

// Route modules export `Component` (react-router lazy route module convention),
// giving route-level code splitting for free.
// `errorElement` is placed at each nesting level so a render/loader failure is
// contained to the smallest subtree (REL-005): a bad character sheet, a broken
// section, or the whole app as a last resort — never a blank crash.
export const router = createBrowserRouter([
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
          { path: 'homebrew', lazy: () => import('@/features/homebrew/ManageHomebrewPage') },
          { path: 'settings', lazy: () => import('@/features/settings/SettingsPage') },
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
      { path: 'homebrew/edit/:fileId', lazy: () => import('@/features/homebrew/BuilderPage') },
    ],
  },
]);
