/**
 * Module stand-ins for the sheet harness (TEST-003). A test file installs them
 * with `vi.mock`, since a mock only applies in the file that declares it:
 *
 *   vi.mock('@/data5e/loader', () =>
 *     import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
 *   );
 *   vi.mock('@/app/AppShell', () =>
 *     import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
 *   );
 *
 * Kept apart from `sheetHarness.tsx` because a mock factory that imported the
 * harness would import the route table, which imports the shell being mocked.
 *
 * What is stubbed, exactly:
 * - `@/data5e/loader`, the whole module (`loaderStub`). Its fetching
 *   (`ensurePack`, `ensureTypePacks`, `repairTypePacks`, `initDataLayer`)
 *   resolves at once; tag resolution (`getActiveTag`, `whenTagReady`) answers
 *   with {@link HARNESS_TAG}; the release rollback and probation hooks the
 *   registry calls (`noteRegistryBuildStarting`, `noteRegistryBuilt`,
 *   `noteRegistryBuildFailed`) record nothing and never roll back; and
 *   `getFile` reads the data cache instead of the network. The harness has
 *   already written its world into that cache, so the registry reads it from
 *   IndexedDB as it does once a download has finished.
 * - `@/app/AppShell` (`appShellStub`). The stand-in renders the route outlet,
 *   the dialog host and the notice toast only. It drops the data-layer start
 *   and the character-session lifecycle listeners (its two effects), and
 *   `ScrollRestoration`, the storage and data banners, the save-error banner,
 *   the roll toast, the service-worker update toast, the offline-ready notice
 *   and analytics.
 */
import 'fake-indexeddb/auto';
import { Outlet } from 'react-router';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { DialogHost } from '@/ui/dialogs';
import { NoticeToast } from '@/ui/NoticeToast';

/** The data release the harness world is cached under. */
export const HARNESS_TAG = 'harness';

const resolved = () => Promise.resolve();

export const loaderStub = {
  getActiveTag: () => HARNESS_TAG,
  whenTagReady: resolved,
  ensurePack: resolved,
  ensureTypePacks: resolved,
  repairTypePacks: resolved,
  initDataLayer: resolved,
  noteRegistryBuilt: resolved,
  noteRegistryBuildStarting: () => Promise.resolve(false),
  noteRegistryBuildFailed: () => Promise.resolve(false),
  /** On-demand reads (the class spell lookup) come from the cache too. */
  getFile: async (path: string): Promise<unknown> =>
    (await dataCacheRepo.getFile(HARNESS_TAG, path))?.json,
};

/**
 * The app shell cut down to what the sheet tests read: the dialog host and the
 * notice toast stay real, since a rest asks through one and reports through
 * the other, and both are what the player sees. What it drops is listed at
 * the top of this file.
 */
function HarnessShell() {
  return (
    <>
      <Outlet />
      <DialogHost />
      <NoticeToast />
    </>
  );
}

export const appShellStub = { AppShell: HarnessShell };
