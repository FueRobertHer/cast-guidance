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
  /**
   * The tag whose install failed, so the retry re-runs that install rather
   * than the background queue. Undefined means the failure was a plain
   * download and re-arming the queue is the right retry. Any later `setPhase`
   * drops it, so it never outlives the failure it describes.
   */
  failedTag?: string;
  beginRun(): void;
  setPack(pack: string, state: PackState): void;
  fileStarted(path: string): void;
  fileDone(): void;
  addTotal(n: number): void;
  setPhase(phase: DataStatusState['phase'], error?: string): void;
  setUpdateAvailableTag(tag?: string): void;
  setFailedTag(tag?: string): void;
}

/** Vanilla store so the React-free data layer can drive it. */
export const dataStatusStore = createStore<DataStatusState>((set) => ({
  phase: 'idle',
  packs: {},
  filesDone: 0,
  filesTotal: 0,
  /**
   * Start a fresh attempt. The counters are per-run: leaving a failed run's
   * totals in place made the next attempt open at "38/120" and climb from
   * there, reporting a download that had already been abandoned. The previous
   * error and failed tag go with them, so a retry in progress never shows the
   * failure it is retrying.
   */
  beginRun: () =>
    set({
      phase: 'working',
      filesDone: 0,
      filesTotal: 0,
      currentPath: undefined,
      error: undefined,
      failedTag: undefined,
    }),
  setPack: (pack, state) => set((s) => ({ packs: { ...s.packs, [pack]: state } })),
  fileStarted: (path) => set({ currentPath: path }),
  fileDone: () => set((s) => ({ filesDone: s.filesDone + 1 })),
  addTotal: (n) => set((s) => ({ filesTotal: s.filesTotal + n })),
  // Clears `failedTag` too: it belongs to the failure being replaced, and a
  // stale one made the background queue's next error render as "Update to
  // v2.33.0 failed" with a Retry that started a 2.5 MB install nobody asked
  // for. Whoever reports a failed install re-arms it immediately after.
  setPhase: (phase, error) => set({ phase, error, failedTag: undefined }),
  setUpdateAvailableTag: (tag) => set({ updateAvailableTag: tag }),
  setFailedTag: (tag) => set({ failedTag: tag }),
}));

export function useDataStatus<T>(selector: (s: DataStatusState) => T): T {
  return useStore(dataStatusStore, selector);
}
