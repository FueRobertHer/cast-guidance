import { useSyncExternalStore } from 'react';

/**
 * Whether a one-use die that lets you wait for the d20 (2014 Guidance and
 * Bardic Inspiration) is still offered after the roll. The roll prompt offers
 * it before the d20 either way (the rolls canvas, one-use dice B): as both are
 * written and the default, one you leave comes back in the result; under a
 * table's house rule ("before"), you add it first or not at all. A die that
 * waits for a failed roll (2024 Bardic) is offered after the roll either way.
 *
 * One choice for the app, a preference of this device like the theme, so it
 * lives in localStorage. A character at a table with other rules keeps its own
 * on Build (`CharacterDoc.oneUseDice`), which wins over this.
 */
export type OneUseDice = 'after' | 'before';

export const ONE_USE_DICE_KEY = 'cast-guidance:one-use-dice';

/** What each choice means, as the buffs canvas words it (Dice, the Settings mock). */
export const ONE_USE_DICE_WHY: Record<OneUseDice, string> = {
  after:
    'As written: the roll prompt offers them, and any you leave come back after the roll, since both let you wait until you see the d20. Bardic must still be used before the DM says how it went.',
  before:
    'House rule: add them in the roll prompt or not at all. A die you add is spent even on a natural 1 or 20.',
};

/** A choice this tab made that storage refused (blocked, or full). */
let unstored: OneUseDice | null = null;

/** The app's choice, read now. */
export function oneUseDiceSetting(): OneUseDice {
  if (unstored !== null) return unstored;
  try {
    return localStorage.getItem(ONE_USE_DICE_KEY) === 'before' ? 'before' : 'after';
  } catch {
    return 'after';
  }
}

const listeners = new Set<() => void>();

export function setOneUseDice(choice: OneUseDice): void {
  try {
    if (choice === 'after') localStorage.removeItem(ONE_USE_DICE_KEY);
    else localStorage.setItem(ONE_USE_DICE_KEY, choice);
    unstored = null;
  } catch {
    // Unremembered: this tab keeps it until it closes.
    unstored = choice;
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  // A choice another tab made arrives through the `storage` event.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ONE_USE_DICE_KEY && event.key !== null) return;
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

/** The app's choice, re-rendering when it changes here or in another tab. */
export function useOneUseDice(): OneUseDice {
  return useSyncExternalStore(subscribe, oneUseDiceSetting, () => 'after');
}
