import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { initDataLayer, retryDataLayer } from '@/data5e/loader';
import {
  characterSessionStore,
  installCharacterSessionLifecycle,
  useCharacterSession,
} from '@/stores/characterSession';
import { useDataStatus } from '@/stores/dataStatus';
import { DialogHost } from '@/ui/dialogs';
import { NoticeToast } from '@/ui/NoticeToast';
import { PwaUpdateToast } from '@/ui/PwaUpdateToast';
import { RollToast } from '@/ui/RollToast';

function DataBanner() {
  const phase = useDataStatus((s) => s.phase);
  const done = useDataStatus((s) => s.filesDone);
  const total = useDataStatus((s) => s.filesTotal);
  const error = useDataStatus((s) => s.error);

  if (phase === 'error') {
    return (
      <div
        className="flex items-center justify-between gap-2 bg-accent-deep px-3 py-1.5 text-xs"
        role="alert"
      >
        <span className="truncate">Game data download failed: {error}</span>
        <button
          type="button"
          onClick={retryDataLayer}
          className="shrink-0 rounded bg-accent px-2 py-0.5 font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }
  if (phase === 'working' && total > 0 && done < total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <div
        className="bg-surface px-3 py-1.5 text-xs text-ink-muted"
        role="progressbar"
        aria-label="Downloading game data"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} files`}
      >
        <div className="flex items-center justify-between">
          <span>Downloading game data…</span>
          <span>
            {done}/{total}
          </span>
        </div>
        <div className="mt-1 h-0.5 overflow-hidden rounded bg-surface-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  return null;
}

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
      <DataBanner />
      <SaveErrorBanner />
      <Outlet />
      <DialogHost />
      <NoticeToast />
      <RollToast />
      <PwaUpdateToast />
    </div>
  );
}
