import { CircleAlert } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { usePageTitle } from '@/lib/usePageTitle';
import { Button, buttonClass } from '@/ui/Button';

/**
 * Route-level recovery UI (REL-005). Rendered by react-router when a route's
 * element or one of its children throws while rendering (e.g. a malformed
 * character whose derivation throws) or a loader errors. Contains the failure
 * to that route subtree so one bad record cannot take down the whole app — the
 * rest of the app shell and other routes keep working.
 *
 * A section screen (DS-001): the title in `title-page` beside a `danger`
 * CircleAlert, as every failure is drawn, then what is still safe, the
 * error's own words for a bug report, and Reload as the one next step.
 */
export function RouteError() {
  const error = useRouteError();
  usePageTitle('Something went wrong');
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error ?? 'Unknown error');

  return (
    <main role="alert" className="flex flex-1 flex-col items-start gap-4 px-4 pt-5 pb-4">
      <div className="flex items-start gap-3">
        <CircleAlert
          size={24}
          strokeWidth={1.75}
          aria-hidden="true"
          className="mt-1.25 shrink-0 text-danger"
        />
        <h1 className="font-display text-title-page">This screen ran into a problem</h1>
      </div>
      <p className="max-w-content text-body text-ink-muted">
        It couldn&rsquo;t render, but your other characters and saved data are safe on this device.
        Try reloading, or head back and open something else.
      </p>
      <p className="max-w-full overflow-x-auto rounded-control bg-surface px-3 py-2 font-mono text-caption text-ink-muted ring-1 ring-line ring-inset">
        {detail}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="brand" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link to="/" className={buttonClass({ variant: 'secondary' })}>
          Back to characters
        </Link>
      </div>
    </main>
  );
}
