import { type To, useLocation, useNavigate } from 'react-router';

/**
 * The state that marks the tab's first entry once a replace has given it a
 * new key: a redirect from an old address, or a page putting its own address
 * in place. Pass it with such a replace, so Back still goes up, not out.
 */
export const FIRST_ENTRY = { firstEntry: true } as const;

/**
 * Whether this entry is where the tab's session started. react-router gives
 * that entry the key 'default', which a replace changes, so a replace of it
 * carries {@link FIRST_ENTRY}.
 */
export function isFirstEntry({ key, state }: { key: string; state: unknown }): boolean {
  return (
    key === 'default' ||
    (typeof state === 'object' &&
      state !== null &&
      (state as { firstEntry?: unknown }).firstEntry === true)
  );
}

/**
 * The state for a replace of `location`: `state`, with {@link FIRST_ENTRY}'s
 * marker added when `location` is the tab's first entry, so the replace keeps
 * it first. A page that replaces its own address and offers Back passes it.
 */
export function keepFirst(location: { key: string; state: unknown }, state?: unknown): unknown {
  if (!isFirstEntry(location)) return state;
  return typeof state === 'object' && state !== null ? { ...state, ...FIRST_ENTRY } : FIRST_ENTRY;
}

/**
 * In-app Back: one step back through this tab's history, or up to `fallback`
 * when this page is where the session started (a deep link or a shared URL),
 * where `navigate(-1)` would leave the app or do nothing at all. The fallback
 * replaces, so Back from it does not bounce to the page just left.
 */
export function useBack(fallback: To): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  return () => {
    if (isFirstEntry(location)) void navigate(fallback, { replace: true });
    else void navigate(-1);
  };
}
