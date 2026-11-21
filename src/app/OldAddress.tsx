import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BOOKS_ID } from '@/features/workshop/collections';
import { FIRST_ENTRY, isFirstEntry } from '@/lib/useBack';

/**
 * Where an address from before the Workshop took over lands (ADR-002 U12), so
 * an old link or bookmark still reaches the page that does its job. A file the
 * Builder opened (`/homebrew/edit/<id>`) is that collection's page, which
 * finds a collection by any of its rows' ids. Anything else under `/homebrew`
 * was the Homebrew page or below it, whose jobs are on the Collections shelf.
 * The id is passed on as written in the path, still encoded, since the
 * collection page reads its address from the path.
 */
export function workshopAddress(pathname: string): string {
  const [, , action, id, ...rest] = pathname.split('/');
  // The old route matched any trailing slashes after the id, as the router
  // does for a path with no splat.
  const onlySlashes = rest.every((s) => s === '');
  return action?.toLowerCase() === 'edit' &&
    id !== undefined &&
    id !== '' &&
    onlySlashes &&
    !namesTheBooks(id)
    ? `/workshop/collection/${id}`
    : '/workshop?shelf=collections';
}

/**
 * Whether an id is the collection page's own name for The books, which no
 * file's id ever was: the page would open The books, not a file.
 */
function namesTheBooks(id: string): boolean {
  try {
    return decodeURIComponent(id) === BOOKS_ID;
  } catch {
    return false;
  }
}

/**
 * The route for the old addresses: it replaces them in history, so Back does
 * not land on them again. `navigate`, not `<Navigate>`, which would pull the
 * router's redirect into the entry chunk.
 */
export function Component() {
  const location = useLocation();
  const navigate = useNavigate();
  const to = workshopAddress(location.pathname);
  // An old link opened in a new tab: the page it lands on is still the first,
  // so its Back goes up to the Workshop rather than out of the app.
  const first = isFirstEntry(location);
  useEffect(() => {
    void navigate(to, { replace: true, ...(first ? { state: FIRST_ENTRY } : {}) });
  }, [navigate, to, first]);
  return null;
}
