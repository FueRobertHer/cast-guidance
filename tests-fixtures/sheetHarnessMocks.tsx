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
 * Only the network edge is replaced. The loader's job here is to fetch release
 * files; the harness has already written its world into the real data cache,
 * so reads go to IndexedDB exactly as they do once a download has finished.
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
 * The app shell without the parts that need a browser this test does not
 * have (the service worker, analytics, the data download). The dialog host
 * and the notice toast stay real: a rest asks through one and reports through
 * the other, and both are what the player sees.
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
