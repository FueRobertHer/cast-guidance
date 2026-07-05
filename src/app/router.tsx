import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/app/AppShell';

// Route modules export `Component` (react-router lazy route module convention),
// giving route-level code splitting for free.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, lazy: () => import('@/features/characters/CharacterListPage') },
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
        ],
      },
      { path: 'library/:type?/:uid?', lazy: () => import('@/features/library/LibraryPage') },
      { path: 'homebrew', lazy: () => import('@/features/homebrew/ManageHomebrewPage') },
      { path: 'settings', lazy: () => import('@/features/settings/SettingsPage') },
    ],
  },
]);
