import { Compass } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { isEntityType } from '@/data5e/normalize';
import { usePageTitle } from '@/lib/usePageTitle';

export interface NearestPage {
  to: string;
  label: string;
}

/**
 * The closest real page above a path no route matched, or null when there is
 * nothing better than the roster. Segments stay URL-encoded, so what comes out
 * is a path the router will match the same way it matched the input.
 */
export function nearestPage(pathname: string): NearestPage | null {
  const [first, second] = pathname.split('/').filter((s) => s !== '');
  switch (first) {
    case 'c':
      return second === undefined
        ? null
        : { to: `/c/${second}`, label: 'Open this character’s sheet' };
    case 'library':
      // An unknown section would only land on "no such section", one level short.
      return second !== undefined && isEntityType(decodeSegment(second))
        ? { to: `/library/${second}`, label: 'Browse this library section' }
        : { to: '/library', label: 'Go to the library' };
    case 'homebrew':
      return { to: '/homebrew', label: 'Go to homebrew' };
    case 'create':
      return { to: '/create', label: 'Go to the character creator' };
    case 'settings':
      return { to: '/settings', label: 'Go to settings' };
    default:
      return null;
  }
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The catch-all route (UX-003). Before it existed an unmatched URL (a typo, a
 * stale bookmark, a link from an older build) reached the root error boundary
 * and read as a crash, with only Reload to press. This keeps the app nav and
 * says plainly that the address, not the app, is the problem.
 */
export function NotFound() {
  const { pathname } = useLocation();
  usePageTitle('Page not found');
  const nearest = nearestPage(pathname);

  return (
    <main className="flex flex-1 flex-col items-start gap-3 p-6">
      <div className="flex items-center gap-2">
        <Compass size={18} aria-hidden="true" className="text-ink-muted" />
        <h1 className="text-lg font-bold text-ink">Page not found</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Nothing here matches <span className="font-mono break-all text-ink">{pathname}</span>. The
        link may be mistyped, or from an older version of the app.
      </p>
      <div className="flex flex-wrap gap-3">
        {nearest !== null && (
          <Link
            to={nearest.to}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          >
            {nearest.label}
          </Link>
        )}
        <Link to="/" className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold">
          Back to characters
        </Link>
      </div>
    </main>
  );
}
