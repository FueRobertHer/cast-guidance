import { Analytics } from '@vercel/analytics/react';
import { useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { initDataLayer } from '@/data5e/loader';
import { OfflineReadyNotice } from '@/features/onboarding/OfflineReadyNotice';
import { announce } from '@/stores/announcer';
import {
  characterSessionStore,
  installCharacterSessionLifecycle,
  useCharacterSession,
} from '@/stores/characterSession';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { notify } from '@/stores/notices';
import { DataBanner } from '@/ui/DataBanner';
import { DataUpdateToast } from '@/ui/DataUpdateToast';
import { DbLifecycleBanner } from '@/ui/DbLifecycleBanner';
import { DialogHost } from '@/ui/dialogs';
import { LiveAnnouncer } from '@/ui/LiveAnnouncer';
import { NoticeToast } from '@/ui/NoticeToast';
import { PwaUpdateToast } from '@/ui/PwaUpdateToast';
import { RollToast } from '@/ui/RollToast';
import { SaveConflictBanner } from '@/ui/SaveConflictBanner';

/** What a screen reader hears when saving works again after a failure. */
export const SAVE_RECOVERED_TEXT = 'Changes saved';

/**
 * A failed save, and the way to retry it.
 *
 * Saving is otherwise silent to a screen reader (A11Y-002): the header's
 * Unsaved, Saving and Saved are visual only, since every HP tap cycles them.
 * What is said is the failure, once, through this banner's `role="alert"`:
 * an alert is the one kind of region announced reliably when it is inserted,
 * and its text does not change while saves keep failing, so it is not said
 * again. The recovery is said once through the announcer, because the banner
 * that could say it is the thing that goes away.
 *
 * Only a save that landed is a recovery. A failed save whose retry is then
 * refused because another tab changed the character leaves this list too,
 * for the conflict banner, and is not saved.
 */
function SaveErrorBanner() {
  const errors = useCharacterSession((state) => state.saveErrors);
  const conflicts = useCharacterSession((state) => state.saveConflicts);
  const entries = Object.entries(errors);
  const failing = entries.length > 0;
  const wasFailing = useRef<string[]>([]);
  useEffect(() => {
    // Each recovery is its own event: a second failure and recovery inside the
    // de-duplication window still deserves its "saved".
    const recovered = wasFailing.current.some((id) => !(id in errors) && !(id in conflicts));
    if (!failing && recovered) announce(SAVE_RECOVERED_TEXT, { key: 'save', repeat: true });
    wasFailing.current = Object.keys(errors);
  }, [failing, errors, conflicts]);
  if (!failing) return null;
  const [, message] = entries[0] ?? [];
  return (
    <div
      className="flex items-center justify-between gap-2 bg-accent-deep px-3 py-1.5 text-xs"
      role="alert"
    >
      <span className="truncate">
        Character changes could not be saved{message === undefined ? '.' : `: ${message}`}
        {entries.length > 1 ? ` (${entries.length} characters affected)` : ''}
      </span>
      <button
        type="button"
        onClick={() => {
          void characterSessionStore
            .getState()
            .retryFailedSaves()
            .catch(() => undefined);
        }}
        className="shrink-0 rounded bg-accent-fill px-2 py-0.5 font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * The banners about saving and the game data download. Once another tab has
 * deleted or upgraded the database (TEST-002), every save and download here
 * fails with "Database has been closed", which explains nothing and offers a
 * Retry that cannot work. The lifecycle banner says what happened instead, and
 * the ones that would echo it stand aside. Exported for tests.
 */
export function StorageBanners() {
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  return (
    <>
      <DbLifecycleBanner />
      {dbOpen && (
        <>
          <DataBanner />
          <DataUpdateToast />
          <SaveConflictBanner />
          <SaveErrorBanner />
        </>
      )}
    </>
  );
}

export function AppShell() {
  useEffect(() => {
    void initDataLayer();
  }, []);

  useEffect(
    () =>
      installCharacterSessionLifecycle(characterSessionStore, {
        onKept: (name) =>
          notify({ title: `Unsaved edits to ${name} were kept in History`, tone: 'info' }),
      }),
    [],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      {/*
        Every page here is one window scroll, so a push navigation used to land
        on the new page at the old page's scroll offset: tapping a spell three
        screens down the library list opened its description already scrolled
        past the title. This resets to the top on push and restores the saved
        offset on back, which is what the library's own "Back" (a navigate(-1),
        unless the page was opened from a link) wants.
      */}
      <ScrollRestoration />
      {/* First, so its regions are in the page before anything announces. */}
      <LiveAnnouncer />
      <StorageBanners />
      <Outlet />
      <DialogHost />
      <NoticeToast />
      <RollToast />
      <PwaUpdateToast />
      <OfflineReadyNotice />
      <Analytics />
    </div>
  );
}
