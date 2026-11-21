import { isEntityType } from '@/data5e/normalize';

/** The sheet's tabs after `/c/:id`, from `routes.tsx`. */
const SHEET_TABS = new Set(['stats', 'inventory', 'spells', 'features', 'build']);
/** The Workshop editor's actions in `/workshop/:action/:type?/:uid?`. */
const WORKSHOP_ACTIONS = new Set(['new', 'copy', 'edit', 'change']);
/** Pages whose address holds nothing but its own name. */
const PLAIN = new Set(['/', '/settings', '/create', '/library', '/workshop', '/workshop/rules']);

/**
 * The route an address belongs to, with every id and name in it replaced by a
 * placeholder, or `undefined` for an address no route here claims.
 *
 * Default deny: only the shapes in `routes.tsx` are spelled out, so a route
 * added later is left out until it is added here, rather than sent with
 * whatever its address holds. A character's id, a collection's id and an
 * entry's uid (a homebrew one carries the name its author gave it) never
 * leave; the section names and Workshop actions that are kept come from the
 * app's own fixed lists. The query string and the hash are always dropped.
 */
export function analyticsPath(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (PLAIN.has(path)) return path;
  const [first, ...rest] = path.split('/').slice(1);
  switch (first) {
    case 'c': {
      const [id, tab, ...more] = rest;
      if (id === undefined || id === '' || more.length > 0) return undefined;
      if (tab === undefined) return '/c/[character]';
      return SHEET_TABS.has(tab) ? `/c/[character]/${tab}` : undefined;
    }
    case 'library': {
      const [type, uid, ...more] = rest;
      if (type === undefined || !isEntityType(type) || more.length > 0) return undefined;
      return uid === undefined ? `/library/${type}` : `/library/${type}/[entry]`;
    }
    case 'workshop': {
      const [action, type, uid, ...more] = rest;
      if (action === 'collection')
        return type !== undefined && uid === undefined ? '/workshop/collection/[id]' : undefined;
      if (action === undefined || !WORKSHOP_ACTIONS.has(action) || more.length > 0)
        return undefined;
      if (type === undefined) return uid === undefined ? `/workshop/${action}` : undefined;
      if (!isEntityType(type)) return undefined;
      return uid === undefined
        ? `/workshop/${action}/${type}`
        : `/workshop/${action}/${type}/[entry]`;
    }
    default:
      return undefined;
  }
}

/** The shape of the analytics script's events: only `url` is read or changed. */
export interface AnalyticsEvent {
  type: 'pageview' | 'event';
  url: string;
}

/**
 * The analytics `beforeSend`: an event goes with its address cut down to the
 * route, or not at all (`null`) when the address is not one of the app's
 * routes or cannot be read.
 */
export function scrubAnalyticsEvent<E extends AnalyticsEvent>(event: E): E | null {
  let url: URL;
  try {
    url = new URL(event.url);
  } catch {
    return null;
  }
  const path = analyticsPath(url.pathname);
  return path === undefined ? null : { ...event, url: `${url.origin}${path}` };
}
