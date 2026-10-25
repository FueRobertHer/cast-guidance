import type { TypePacksState } from '@/data5e/hooks';
import { useOnReconnect } from '@/lib/useOnline';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { useFailureAlert } from './failureAlert';

interface PackProblemProps {
  packs: TypePacksState;
  what: string;
  /**
   * `always` for a panel inside a modal sheet. The modal hides the rest of the
   * app from assistive tech, the shell's banner included, so the banner that
   * would otherwise say the outage is not there to hear, and the panel is the
   * only voice left (docs/a11y-audit.md). Everywhere else, `useFailureAlert`
   * decides.
   */
  alert?: 'auto' | 'always';
  /** For the message, so a dialog can name it as its description. */
  messageId?: string;
  /**
   * The failure in other words, for one that is not a download: a file read
   * from this device, which neither the network nor "offline" explains.
   */
  message?: string;
}

/**
 * Why a list that reads one download is short or empty, with Retry (PWA-001).
 * Nothing when that download is fine.
 *
 * The class pickers used to start their class download with a bare `void`, so
 * a launch without the class files (offline, or a failed download) showed
 * "Pick a class" over an empty list, and the rejection went nowhere but the
 * console as an uncaught error. The spell list and the spell info sheet did
 * the same with the spell files (#106).
 */
export function PackProblem({ packs, what, alert = 'auto', messageId, message }: PackProblemProps) {
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  // Back online, a download the network stopped is tried again unasked. Not
  // with the database closed (another tab deleted or upgraded it): no download
  // can land then, and the shell's banner offers the reload.
  useOnReconnect(() => {
    if (dbOpen && packs.status === 'error') packs.retry();
  });
  if (packs.status !== 'error') return null;
  // The failure is then "Database has been closed", which a Retry cannot fix.
  // Outside a modal the shell's database banner says what happened; inside
  // one it is hidden, so this line is the alert.
  if (!dbOpen) {
    return (
      <p
        id={messageId}
        role={alert === 'always' ? 'alert' : undefined}
        className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted"
      >
        Reload this tab to load {what}.
      </p>
    );
  }
  return (
    <PackProblemPanel
      packs={packs}
      what={what}
      alert={alert}
      messageId={messageId}
      message={message}
    />
  );
}

/** The panel itself, mounted with the failure so its alert role is decided then. */
function PackProblemPanel({ packs, what, alert, messageId, message }: PackProblemProps) {
  const alerts = useFailureAlert() || alert === 'always';
  const capitalized = what.charAt(0).toUpperCase() + what.slice(1);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-deep px-3 py-2"
      role={alerts ? 'alert' : undefined}
    >
      <p id={messageId} className="min-w-0 flex-1 text-xs">
        {message !== undefined
          ? message
          : packs.offline
            ? `You're offline, so ${what} can't be downloaded yet.`
            : `${capitalized} couldn't be downloaded${packs.error === null ? '.' : `: ${packs.error}`}`}
      </p>
      <button
        type="button"
        onClick={packs.retry}
        className="tap shrink-0 rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white"
      >
        Retry
      </button>
    </div>
  );
}
