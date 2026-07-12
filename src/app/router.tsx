import { createBrowserRouter } from 'react-router';
import { AppNavLayout } from '@/app/AppNav';
import { AppShell } from '@/app/AppShell';

// Route modules export `Component` (react-router lazy route module convention),
// giving route-level code splitting for free.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        // Top-level sections share the persistent app nav.
        element: <AppNavLayout />,
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
