import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type PackState = 'missing' | 'downloading' | 'ready';

export interface DataStatusState {
  /** Overall lifecycle of the background download queue. */
  phase: 'idle' | 'working' | 'done' | 'error';
  packs: Record<string, PackState>;
  filesDone: number;
  filesTotal: number;
  currentPath?: string;
  error?: string;
  /** Set once a boot-time check finds a newer compatible data tag than the installed one. */
  updateAvailableTag?: string;
  setPack(pack: string, state: PackState): void;
  fileStarted(path: string): void;
  fileDone(): void;
  addTotal(n: number): void;
  setPhase(phase: DataStatusState['phase'], error?: string): void;
  setUpdateAvailableTag(tag?: string): void;
}

/** Vanilla store so the React-free data layer can drive it. */
export const dataStatusStore = createStore<DataStatusState>((set) => ({
  phase: 'idle',
  packs: {},
  filesDone: 0,
  filesTotal: 0,
  setPack: (pack, state) => set((s) => ({ packs: { ...s.packs, [pack]: state } })),
  fileStarted: (path) => set({ currentPath: path }),
  fileDone: () => set((s) => ({ filesDone: s.filesDone + 1 })),
  addTotal: (n) => set((s) => ({ filesTotal: s.filesTotal + n })),
  setPhase: (phase, error) => set({ phase, error }),
  setUpdateAvailableTag: (tag) => set({ updateAvailableTag: tag }),
}));

export function useDataStatus<T>(selector: (s: DataStatusState) => T): T {
  return useStore(dataStatusStore, selector);
}
