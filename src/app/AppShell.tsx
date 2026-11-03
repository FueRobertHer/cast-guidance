import { Analytics } from '@vercel/analytics/react';
import { CircleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { initDataLayer } from '@/data5e/loader';
import { OfflineReadyNotice } from '@/features/onboarding/OfflineReadyNotice';
import { installThemeSync } from '@/lib/theme';
import { announce } from '@/stores/announcer';
import {
  characterSessionStore,
  installCharacterSessionLifecycle,
  useCharacterSession,
} from '@/stores/characterSession';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { notify } from '@/stores/notices';
import { Banner, BannerAction } from '@/ui/Banner';
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
 * Only a save that landed is a recovery. A failed save also leaves this list
 * when its retry is refused because another tab changed the character (for
 * the conflict banner), or when only the sheet's own edits were waiting and
 * the stored copy was taken instead; neither wrote anything, so neither is
 * "saved".
 */
function SaveErrorBanner() {
  const errors = useCharacterSession((state) => state.saveErrors);
  const status = useCharacterSession((state) => state.saveStatus);
  const entries = Object.entries(errors);
  const failing = entries.length > 0;
  const wasFailing = useRef(false);
  useEffect(() => {
    // Each recovery is its own event: a second failure and recovery inside the
    // de-duplication window still deserves its "saved". The list empties only
    // on saved, conflict or idle, and the status can have moved on by this
    // render: an edit queued behind the save that landed is already
    // "saving". Conflict and idle are never followed so at once, so anything
    // else here is a save that landed.
    if (wasFailing.current && !failing && status !== 'conflict' && status !== 'idle')
      announce(SAVE_RECOVERED_TEXT, { key: 'save', repeat: true });
    wasFailing.current = failing;
  }, [failing, status]);
  if (!failing) return null;
  const [, message] = entries[0] ?? [];
  return (
    <Banner
      tone="danger"
      icon={CircleAlert}
      role="alert"
      actions={
        <BannerAction
          tone="danger"
          onClick={() => {
            void characterSessionStore
              .getState()
              .retryFailedSaves()
              .catch(() => undefined);
          }}
        >
          Retry
        </BannerAction>
      }
    >
      Character changes could not be saved{message === undefined ? '.' : `: ${message}`}
      {entries.length > 1 ? ` (${entries.length} characters affected)` : ''}
    </Banner>
  );
}

/**
 * The banners about saving and the game data download. Once another tab has
 * deleted or upgraded the database (TEST-002), every save and download here
 * fails with "Database has been closed", which explains nothing and offers a
 * Retry that cannot work. The lifecycle banner says what happened instead, and
 * the ones that would echo it stand aside. Exported for tests.
 *
 * They stack failures first (DS-001), so what is going wrong is read before
 * what is on offer: the save banners, then the data download (a failure or
 * its progress), then the data update offer.
 */
export function StorageBanners() {
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  return (
    <>
      <DbLifecycleBanner />
      {dbOpen && (
        <>
          <SaveErrorBanner />
          <SaveConflictBanner />
          <DataBanner />
          <DataUpdateToast />
        </>
      )}
    </>
  );
}

export function AppShell() {
  useEffect(() => {
    void initDataLayer();
  }, []);

  // The boot script drew the first frame in the chosen theme; this keeps it
  // in step with the device and with other tabs (DS-001).
  useEffect(() => installThemeSync(), []);

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
      {/* Banners sit in the page above the screen, never over it (DS-001):
          the app update offer is one, after the storage banners. */}
      <StorageBanners />
      <PwaUpdateToast />
      <Outlet />
      <DialogHost />
      <NoticeToast />
      <RollToast />
      <OfflineReadyNotice />
      <Analytics />
    </div>
  );
}
