import { retryDataLayer, updateToTag } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { useDataStatus } from '@/stores/dataStatus';

/** Download progress for the background data queue, and its failure state. */
export function DataBanner() {
  const phase = useDataStatus((s) => s.phase);
  const done = useDataStatus((s) => s.filesDone);
  const total = useDataStatus((s) => s.filesTotal);
  const error = useDataStatus((s) => s.error);
  const failedTag = useDataStatus((s) => s.failedTag);

  if (phase === 'error') {
    // Two different failures reach this banner and they need different
    // retries. Re-arming the background queue after a failed version install
    // downloads the *current* version's remaining files and reports success,
    // leaving the update the user asked for undone; so a failed install
    // retries the install, and says which version it is retrying.
    const retry =
      failedTag === undefined
        ? retryDataLayer
        : () => {
            void updateToTag(failedTag)
              .then(invalidateRegistry)
              // updateToTag has already put the reason back in this banner.
              .catch(() => undefined);
          };
    return (
      <div
        className="fixed inset-x-4 top-3 z-40 flex items-center justify-between gap-3 rounded-lg border border-surface-2 bg-accent-deep px-4 py-2.5 text-xs shadow-lg backdrop-blur lg:right-6 lg:left-auto lg:w-96"
        role="alert"
      >
        <span className="truncate">
          {failedTag === undefined
            ? `Game data download failed: ${error}`
            : `Update to ${failedTag} failed: ${error}`}
        </span>
        <button
          type="button"
          onClick={retry}
          className="shrink-0 rounded bg-accent px-2 py-0.5 font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }
  // `phase` turns 'working' when the boot routine starts, not when it knows
  // there is anything to fetch, and stays that way until the whole pack queue
  // drains. On an installed PWA every pack is already cached, so nothing ever
  // calls addTotal and this sat at "0/0" for the length of the drain,
  // announcing a download that had already happened. A progress bar with no
  // progress to report has nothing to say, so it waits for real work.
  if (phase === 'working' && total > 0) {
    // Clamped because the counters are shared: a run that starts while another
    // is still finishing can push `done` past its own total for a moment, and
    // a bar wider than its track is worse than a bar that pauses at full.
    const pct = Math.round((Math.min(done, total) / total) * 100);
    return (
      <div
        className="fixed inset-x-4 top-3 z-40 rounded-lg border border-surface-2 bg-surface/95 px-4 py-2.5 text-xs text-ink-muted shadow-lg backdrop-blur lg:right-6 lg:left-auto lg:w-96"
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
