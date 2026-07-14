import { AlertTriangle } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/**
 * Route-level recovery UI (REL-005). Rendered by react-router when a route's
 * element or one of its children throws while rendering (e.g. a malformed
 * character whose derivation throws) or a loader errors. Contains the failure
 * to that route subtree so one bad record cannot take down the whole app — the
 * rest of the app shell and other routes keep working.
 */
export function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error ?? 'Unknown error');

  return (
    <main role="alert" className="flex flex-1 flex-col items-start gap-3 p-6">
      <div className="flex items-center gap-2 text-amber-300">
        <AlertTriangle size={18} aria-hidden="true" />
        <h1 className="text-lg font-bold text-ink">This screen ran into a problem</h1>
      </div>
      <p className="text-sm text-ink-muted">
        It couldn&rsquo;t render, but your other characters and saved data are safe on this device.
        Try reloading, or head back and open something else.
      </p>
      <p className="max-w-full overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs text-ink-muted">
        {detail}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
        >
          Reload
        </button>
        <Link to="/" className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold">
          Back to characters
        </Link>
      </div>
    </main>
  );
}
