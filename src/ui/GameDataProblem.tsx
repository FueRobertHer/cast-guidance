import { useOnline, useOnReconnect } from '@/lib/useOnline';
import { useDbLifecycle } from '@/stores/dbLifecycle';

/**
 * Why a page that needs game data has none to show, and the way on (PWA-001).
 *
 * For a page that cannot draw anything useful until the essentials pack is on
 * the device: a character sheet derives every number from it, and the
 * creator lists nothing without it. Waiting for it used to be the only
 * outcome, so a first launch offline (or one whose first download failed)
 * left "Deriving…" or "Loading game data…" up for good.
 *
 * Offline, the reason and the remedy are the network, and the download is
 * tried again as soon as the device is back online. Online, it is a failed
 * download, and the error says which file.
 */
export function GameDataProblem({
  error,
  onRetry,
  note,
}: {
  error: string | null;
  onRetry: () => void;
  /** What is still safe, in the page's own terms. */
  note?: string;
}) {
  const online = useOnline();
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  // Back online, the download that could not start is tried again unasked.
  // Not with the database closed (another tab deleted or upgraded it): no
  // download can land then, and the shell's banner offers the reload.
  useOnReconnect(() => {
    if (dbOpen) onRetry();
  });
  if (!dbOpen) {
    return (
      <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
        Reload this tab to load the game data.
      </p>
    );
  }
  return (
    <div
      className="flex flex-col items-start gap-2 rounded-lg bg-accent-deep px-3 py-2"
      role="alert"
    >
      <p className="text-sm">
        {online
          ? `The game data this needs couldn't be downloaded${error === null ? '.' : `: ${error}`}`
          : "You're offline, and the game data this needs isn't downloaded yet."}
      </p>
      {(note !== undefined || !online) && (
        <p className="text-xs text-ink-muted">
          {[note, online ? undefined : "It downloads by itself once you're back online."]
            .filter((part) => part !== undefined)
            .join(' ')}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="tap rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white"
      >
        Retry
      </button>
    </div>
  );
}
