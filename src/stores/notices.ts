import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type NoticeTone = 'info' | 'good' | 'warn';

export interface Notice {
  title: string;
  /** Optional secondary line — e.g. a bulleted-into-one-line rest summary. */
  detail?: string;
  tone: NoticeTone;
}

export interface NoticeState {
  notice: Notice | null;
  /** Monotonic counter so repeated identical notices still re-trigger the toast. */
  seq: number;
  push(notice: Notice): void;
  clear(): void;
}

/**
 * Lightweight app-wide snackbar for one-shot feedback (rests, imports, …).
 * Distinct from the roll toast, which is specific to dice results.
 */
export const noticeStore = createStore<NoticeState>((set) => ({
  notice: null,
  seq: 0,
  push: (notice) => set((s) => ({ notice, seq: s.seq + 1 })),
  clear: () => set({ notice: null }),
}));

export function notify(notice: Notice): void {
  noticeStore.getState().push(notice);
}

export function useNotices<T>(selector: (s: NoticeState) => T): T {
  return useStore(noticeStore, selector);
}
