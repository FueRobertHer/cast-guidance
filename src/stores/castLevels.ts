import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * The level each spell row was last cast at (`castRowId`: the character, the
 * class or grant, the spell), for as long as the app is open (the rolls
 * canvas, "Level at cast" A): the row's damage chip keeps those dice, so
 * closing the result loses nothing. A setting it is not, so it is never saved.
 */
export const castLevelStore = createStore<{ levels: Readonly<Record<string, number>> }>(() => ({
  levels: {},
}));

export function rememberCastLevel(rowId: string, level: number): void {
  castLevelStore.setState((s) =>
    s.levels[rowId] === level ? s : { levels: { ...s.levels, [rowId]: level } },
  );
}

/** The level row `rowId` was last cast at, if it has been this session. */
export function useCastLevel(rowId: string): number | undefined {
  return useStore(castLevelStore, (s) => s.levels[rowId]);
}
