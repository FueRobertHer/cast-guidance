import { type RefObject, useEffect, useRef, useState } from 'react';

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
  /**
   * Attach to the status label (with `tabIndex={-1}`). The ask button only
   * exists while there is something to ask, so once the browser answers it is
   * gone, and focus goes to the answer instead of falling to the page body.
   */
  statusRef: RefObject<HTMLElement | null>;
} {
  const [state, setState] = useState<PersistState>(() =>
    typeof storageManager()?.persisted === 'function' ? 'checking' : 'unsupported',
  );
  const [requesting, setRequesting] = useState(false);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLElement>(null);
  const [answers, setAnswers] = useState(0);

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

  // After the commit, so the label already reads the answer when it is spoken.
  // Only when focus fell with the button that just went away: Firefox's prompt
  // does not block the page, so someone may have moved on while it was open.
  useEffect(() => {
    if (answers === 0) return;
    const active = document.activeElement;
    if (active === null || active === document.body) statusRef.current?.focus();
  }, [answers]);

  /**
   * Called from a click on purpose: Firefox shows a permission prompt, and a
   * prompt with a reason in front of it beats one that appears out of nowhere.
   * A second press while the first is pending does nothing; the button stays
   * enabled (`aria-disabled`) so it keeps focus meanwhile.
   */
  const request = async () => {
    const storage = storageManager();
    if (typeof storage?.persist !== 'function' || inFlight.current) return;
    inFlight.current = true;
    setRequesting(true);
    try {
      setState((await storage.persist()) ? 'persisted' : 'denied');
    } catch {
      setState('denied');
    } finally {
      inFlight.current = false;
      setRequesting(false);
      setAnswers((n) => n + 1);
    }
  };

  return { state, requesting, request, statusRef };
}
