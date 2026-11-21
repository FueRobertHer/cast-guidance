import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

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
  return action?.toLowerCase() === 'edit' && id !== undefined && id !== '' && rest.length === 0
    ? `/workshop/collection/${id}`
    : '/workshop?shelf=collections';
}

/**
 * The route for the old addresses: it replaces them in history, so Back does
 * not land on them again. `navigate`, not `<Navigate>`, which would pull the
 * router's redirect into the entry chunk.
 */
export function Component() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const to = workshopAddress(pathname);
  useEffect(() => {
    void navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}
