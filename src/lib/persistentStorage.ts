import { useEffect, useState } from 'react';

/**
 * Whether the browser has agreed to keep this site's data under storage
 * pressure.
 *
 * - `unsupported`: no Storage API to ask.
 * - `best-effort`: not protected yet, and not asked this visit.
 * - `denied`: asked this visit and the browser said no. Chrome decides on its
 *   own heuristics, so "no" is not the user refusing; the copy must not say it is.
 */
export type PersistState = 'unsupported' | 'checking' | 'persisted' | 'best-effort' | 'denied';

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

export function usePersistentStorage(): {
  state: PersistState;
  requesting: boolean;
  request(): Promise<void>;
} {
  const [state, setState] = useState<PersistState>(() =>
    typeof storageManager()?.persisted === 'function' ? 'checking' : 'unsupported',
  );
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const storage = storageManager();
    if (typeof storage?.persisted !== 'function') return;
    let live = true;
    storage
      .persisted()
      .then((yes) => live && setState(yes ? 'persisted' : 'best-effort'))
      .catch(() => live && setState('best-effort'));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Called from a click on purpose: Firefox shows a permission prompt, and a
   * prompt with a reason in front of it beats one that appears out of nowhere.
   */
  const request = async () => {
    const storage = storageManager();
    if (typeof storage?.persist !== 'function') return;
    setRequesting(true);
    try {
      setState((await storage.persist()) ? 'persisted' : 'denied');
    } catch {
      setState('denied');
    } finally {
      setRequesting(false);
    }
  };

  return { state, requesting, request };
}
