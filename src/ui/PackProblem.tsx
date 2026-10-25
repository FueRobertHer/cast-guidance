import type { TypePacksState } from '@/data5e/hooks';

/**
 * Why a list that reads one download is short or empty, with Retry (PWA-001).
 * Nothing when that download is fine.
 *
 * The class pickers used to start their class download with a bare `void`, so
 * a launch without the class files (offline, or a failed download) showed
 * "Pick a class" over an empty list, and the rejection went nowhere but the
 * console as an uncaught error.
 */
export function PackProblem({ packs, what }: { packs: TypePacksState; what: string }) {
  if (packs.status !== 'error') return null;
  const capitalized = what.charAt(0).toUpperCase() + what.slice(1);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-deep px-3 py-2"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-xs">
        {packs.offline
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
