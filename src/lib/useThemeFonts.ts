import { useEffect, useState } from 'react';
import { libraryFontIds, loadThemeFonts } from '@/theme/libraryFonts';

/**
 * Whether these fonts are on this device: `ready` once every library face
 * among them has loaded (the app's own and the device's always are),
 * `missing` when one could not be fetched (offline, before its first use),
 * and `loading` until then. Asks again when the device comes back online.
 */
export function useThemeFonts(ids: readonly unknown[]): 'ready' | 'loading' | 'missing' {
  const wanted = libraryFontIds(ids).sort().join(' ');
  const [state, setState] = useState<{ key: string; ready: boolean } | null>(null);
  useEffect(() => {
    if (wanted === '') return;
    let live = true;
    const ask = () => {
      void loadThemeFonts(wanted.split(' ')).then((ready) => {
        if (live) setState({ key: wanted, ready });
      });
    };
    ask();
    window.addEventListener('online', ask);
    return () => {
      live = false;
      window.removeEventListener('online', ask);
    };
  }, [wanted]);
  if (wanted === '') return 'ready';
  if (state === null || state.key !== wanted) return 'loading';
  return state.ready ? 'ready' : 'missing';
}
