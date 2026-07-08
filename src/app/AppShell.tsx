import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { initDataLayer, retryDataLayer } from '@/data5e/loader';
import { useDataStatus } from '@/stores/dataStatus';
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
      <div className="flex items-center justify-between gap-2 bg-accent-deep px-3 py-1.5 text-xs">
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
    return (
      <div className="bg-surface px-3 py-1.5 text-xs text-ink-muted">
        <div className="flex items-center justify-between">
          <span>Downloading game data…</span>
          <span>
            {done}/{total}
          </span>
        </div>
        <div className="mt-1 h-0.5 overflow-hidden rounded bg-surface-2">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
          />
        </div>
      </div>
    );
  }
  return null;
}

export function AppShell() {
  useEffect(() => {
    void initDataLayer();
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      <DataBanner />
      <Outlet />
      <NoticeToast />
      <RollToast />
      <PwaUpdateToast />
    </div>
  );
}
