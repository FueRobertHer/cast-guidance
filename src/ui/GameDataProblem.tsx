import { CircleAlert, Info } from 'lucide-react';
import { useOnline, useOnReconnect } from '@/lib/useOnline';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { Button } from './Button';
import { useFailureAlert } from './failureAlert';
import { NOTE_CLASS, PROBLEM_CLASS } from './PackProblem';

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
 *
 * Drawn as a `danger` hint (DS-001), since the page needs it fixed: what
 * happened, what is still safe, then Retry.
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
  // Not the alert while the shell's DataBanner alerts the same outage (A11Y-002).
  const alerts = useFailureAlert();
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  // Back online, the download that could not start is tried again unasked.
  // Not with the database closed (another tab deleted or upgraded it): no
  // download can land then, and the shell's banner offers the reload.
  useOnReconnect(() => {
    if (dbOpen) onRetry();
  });
  if (!dbOpen) {
    return (
      <p className={NOTE_CLASS}>
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" />
        Reload this tab to load the game data.
      </p>
    );
  }
  return (
    <div className={PROBLEM_CLASS}>
      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div
        className="flex min-w-0 flex-1 flex-col items-start gap-1"
        role={alerts ? 'alert' : undefined}
      >
        <p>
          {online
            ? `The game data this needs couldn't be downloaded${error === null ? '.' : `: ${error}`}`
            : "You're offline, and the game data this needs isn't downloaded yet."}
        </p>
        {(note !== undefined || !online) && (
          <p className="text-caption text-ink-muted">
            {[note, online ? undefined : "It downloads by itself once you're back online."]
              .filter((part) => part !== undefined)
              .join(' ')}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={onRetry} className="-ml-1">
          Retry
        </Button>
      </div>
    </div>
  );
}
