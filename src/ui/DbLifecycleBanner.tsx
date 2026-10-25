import { type DbLifecycle, useDbLifecycle } from '@/stores/dbLifecycle';

/** What the banner says for each closed state. Neither one is something this tab did wrong. */
export const DB_LIFECYCLE_COPY: Readonly<Record<Exclude<DbLifecycle, 'open'>, string>> = {
  deleted:
    'App data was reset in another tab, so this tab has stopped saving. Reload to start fresh.',
  superseded:
    'A newer version of the app opened in another tab, so this tab has stopped saving. ' +
    'Reload to use the new version.',
};

function reloadPage(): void {
  window.location.reload();
}

/**
 * Says why this tab stopped saving after another tab deleted or upgraded the
 * database (TEST-002), and offers the reload that is the only way back.
 *
 * The status line stays mounted while the database is open, empty, so screen
 * readers already know the live region when the message arrives: text added
 * to a region that mounts with it is announced unreliably. Polite, and focus
 * stays where it was, because nothing here needs an answer this second; the
 * person can finish reading what they were on and reload when ready.
 */
export function DbLifecycleBanner({ onReload = reloadPage }: { onReload?: () => void }) {
  const state = useDbLifecycle((s) => s.state);
  const closed = state !== 'open';
  return (
    <div
      className={
        closed
          ? 'flex items-center justify-between gap-2 bg-accent-deep px-3 py-1.5 text-xs'
          : undefined
      }
    >
      <p role="status" className={closed ? 'min-w-0' : 'sr-only'}>
        {closed ? DB_LIFECYCLE_COPY[state] : ''}
      </p>
      {closed && (
        <button
          type="button"
          onClick={onReload}
          className="min-h-11 shrink-0 rounded bg-accent px-3 font-semibold"
        >
          Reload
        </button>
      )}
    </div>
  );
}
