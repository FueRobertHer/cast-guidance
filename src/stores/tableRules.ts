import { useSyncExternalStore } from 'react';
import { TABLE_RULES, type TableRuleChoices, type TableRuleId } from '@/engine/castGuidance';

/**
 * The app's own table rules, chosen in Settings: one choice for the app, a
 * preference of this device like the theme, so each lives in localStorage
 * under its own key. A rule left unchosen is absent, which plays as written
 * for each character's edition; a character's own choice and a pack applied
 * to them come first (`engine/rules.ts`). The engine reads these through
 * `EngineContext.rules` (`data5e/engineAdapter.ts`).
 */
export type AppTableRules = Readonly<Partial<TableRuleChoices>>;

/** Each rule's key. One-use dice keeps the key it had before the other rules came. */
const KEYS: Readonly<Record<TableRuleId, string>> = {
  critDamage: 'cast-guidance:table-rule:critDamage',
  restLength: 'cast-guidance:table-rule:restLength',
  hpEachLevel: 'cast-guidance:table-rule:hpEachLevel',
  hpOnLongRest: 'cast-guidance:table-rule:hpOnLongRest',
  flanking: 'cast-guidance:table-rule:flanking',
  oneUseDice: 'cast-guidance:one-use-dice',
};

const IDS = Object.keys(KEYS) as TableRuleId[];

/** Choices this tab made that storage refused (blocked, or full): `null` is one taken back. */
const unstored = new Map<TableRuleId, string | null>();

function stored(id: TableRuleId): string | null {
  if (unstored.has(id)) return unstored.get(id) ?? null;
  try {
    return localStorage.getItem(KEYS[id]);
  } catch {
    return null;
  }
}

const EMPTY: AppTableRules = {};
let last: AppTableRules = EMPTY;

/** The app's choices, read now: the same object while nothing changed. */
export function appTableRules(): AppTableRules {
  const next: Record<string, string> = {};
  for (const id of IDS) {
    const value = stored(id);
    // Anything else stored there (an older or newer value) plays as written.
    if (value !== null && (TABLE_RULES[id] as readonly string[]).includes(value)) {
      next[id] = value;
    }
  }
  const same =
    IDS.every((id) => next[id] === last[id]) &&
    Object.keys(next).length === Object.keys(last).length;
  if (!same) last = Object.keys(next).length === 0 ? EMPTY : next;
  return last;
}

const listeners = new Set<() => void>();

/** Choose a rule for the app, or (`undefined`) take the choice back to as written. */
export function setAppTableRule<K extends TableRuleId>(
  id: K,
  value: TableRuleChoices[K] | undefined,
): void {
  try {
    if (value === undefined) localStorage.removeItem(KEYS[id]);
    else localStorage.setItem(KEYS[id], value);
    unstored.delete(id);
  } catch {
    // Unremembered: this tab keeps it until it closes.
    unstored.set(id, value ?? null);
  }
  for (const listener of listeners) listener();
}

const ours = new Set(Object.values(KEYS));

/** Listen for the app's choices changing, here or in another tab. */
export function subscribeTableRules(onChange: () => void): () => void {
  // A choice another tab made arrives through the `storage` event.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !ours.has(event.key)) return;
    unstored.clear();
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The app's choices, re-rendering when they change here or in another tab. */
export function useAppTableRules(): AppTableRules {
  return useSyncExternalStore(subscribeTableRules, appTableRules, () => EMPTY);
}
