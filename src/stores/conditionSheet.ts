import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether a sheet that changes conditions is over the page: the picker, or a
 * condition's own sheet with its switch and Exhaustion's stepper. Those apply
 * each change at once, with the attack chips behind them, so a chip waits for
 * the sheet to go before it plays what changed (`ChipFace`). Set by
 * `ConditionStrip`, which holds both sheets.
 */
export const conditionSheetStore = createStore<{ open: boolean }>(() => ({ open: false }));

export function useConditionSheetOpen(): boolean {
  return useStore(conditionSheetStore, (s) => s.open);
}
