import { Analytics } from '@vercel/analytics/react';
import { useEffect } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { initDataLayer } from '@/data5e/loader';
import {
  characterSessionStore,
  installCharacterSessionLifecycle,
  useCharacterSession,
} from '@/stores/characterSession';
import { DataBanner } from '@/ui/DataBanner';
import { DataUpdateToast } from '@/ui/DataUpdateToast';
import { DialogHost } from '@/ui/dialogs';
import { NoticeToast } from '@/ui/NoticeToast';
import { PwaUpdateToast } from '@/ui/PwaUpdateToast';
import { RollToast } from '@/ui/RollToast';

function SaveErrorBanner() {
  const errors = useCharacterSession((state) => state.saveErrors);
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
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
        className="shrink-0 rounded bg-accent px-2 py-0.5 font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

export function AppShell() {
  useEffect(() => {
    void initDataLayer();
  }, []);

  useEffect(() => installCharacterSessionLifecycle(), []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      {/*
        Every page here is one window scroll, so a push navigation used to land
        on the new page at the old page's scroll offset: tapping a spell three
        screens down the library list opened its description already scrolled
        past the title. This resets to the top on push and restores the saved
        offset on back, which is what the library's own "Back" (a navigate(-1))
        wants.
      */}
      <ScrollRestoration />
      <DataBanner />
      <DataUpdateToast />
      <SaveErrorBanner />
      <Outlet />
      <DialogHost />
      <NoticeToast />
      <RollToast />
      <PwaUpdateToast />
      <Analytics />
    </div>
  );
}
