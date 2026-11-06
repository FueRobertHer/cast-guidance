import { useSyncExternalStore } from 'react';

/**
 * "Animate condition effects" in Settings: whether the signatures on attack
 * chips loop, on by default. They start on their own, last over five seconds
 * and run beside other content, so they need a way to stop (WCAG 2.2.2), and
 * the device's reduced-motion setting may not be one a player can reach for
 * this alone. Off leaves every colour and mark in its still pose.
 *
 * A preference of this device, not character data, so it lives in localStorage
 * like the theme.
 */
export const CONDITION_MOTION_KEY = 'cast-guidance:condition-motion';

/** A choice this tab made that storage refused (blocked, or full). */
let unstored: boolean | null = null;

function read(): boolean {
  if (unstored !== null) return unstored;
  try {
    return localStorage.getItem(CONDITION_MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();

export function setAnimateConditions(on: boolean): void {
  try {
    if (on) localStorage.removeItem(CONDITION_MOTION_KEY);
    else localStorage.setItem(CONDITION_MOTION_KEY, 'off');
    unstored = null;
  } catch {
    // Unremembered: this tab keeps it until it closes.
    unstored = on;
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  // A choice another tab made arrives through the `storage` event.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CONDITION_MOTION_KEY && event.key !== null) return;
    unstored = null;
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether condition effects animate, re-rendering when it changes here or in another tab. */
export function useAnimateConditions(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
