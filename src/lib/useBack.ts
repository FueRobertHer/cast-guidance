import { type To, useLocation, useNavigate } from 'react-router';

/**
 * In-app Back: one step back through this tab's history, or up to `fallback`
 * when this page is where the session started (a deep link or a shared URL),
 * where `navigate(-1)` would leave the app or do nothing at all. The fallback
 * replaces, so Back from it does not bounce to the page just left.
 *
 * react-router gives the session's first entry the key 'default'. A replace
 * of that entry gives it a fresh key and reads as having history; nothing on
 * the pages that use this replaces its own first entry.
 */
export function useBack(fallback: To): () => void {
  const { key } = useLocation();
  const navigate = useNavigate();
  return () => {
    if (key === 'default') void navigate(fallback, { replace: true });
    else void navigate(-1);
  };
}
