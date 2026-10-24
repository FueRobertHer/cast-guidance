import { useEffect } from 'react';

export const APP_NAME = 'Cast Guidance';

type TitlePart = string | null | undefined | false;

/**
 * A document title, most specific part first and the app name last
 * ("Spells · Aria · Cast Guidance"). Empty and whitespace-only parts are
 * dropped, so callers can pass a part that is not known yet.
 */
export function pageTitle(parts: ReadonlyArray<TitlePart>): string {
  const kept = parts.flatMap((p) => (typeof p === 'string' && p.trim() !== '' ? [p.trim()] : []));
  return [...kept, APP_NAME].join(' · ');
}

/**
 * Sets `document.title` while the calling screen is mounted, and puts the bare
 * app name back when it unmounts (UX-003): the title is what browser history,
 * the tab strip, and a screen reader announce for the page.
 *
 * One owner per screen. A child's effect runs before its parent's, so if a
 * layout and the route inside it both called this, the layout would win; the
 * screen that knows the most specific name owns the title (SheetLayout for
 * every sheet tab, each library sub-view for itself).
 */
export function usePageTitle(...parts: TitlePart[]): void {
  const title = pageTitle(parts);
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
