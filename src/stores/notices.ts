import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { announce } from './announcer';

export type NoticeTone = 'info' | 'good' | 'warn';

export interface Notice {
  title: string;
  /** Optional secondary line — e.g. a bulleted-into-one-line rest summary. */
  detail?: string;
  tone: NoticeTone;
}

/** How long the toast shows one notice, so a notice that can wait knows how long. */
export const NOTICE_MS = 3600;

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

/** A notice as one sentence or two, for a screen reader. */
export function noticeText({ title, detail }: Notice): string {
  if (detail === undefined) return title;
  return `${title}${/[.!?]$/.test(title) ? '' : '.'} ${detail}`;
}

/**
 * Show a notice, and say it. The toast is a plain visual: a region that
 * mounts with its text is announced unreliably, so the words go through the
 * announcer (A11Y-002). Each notice is an event, so the same words twice are
 * said twice; a burst is cut to its first and last by the key's throttle.
 */
export function notify(notice: Notice): void {
  noticeStore.getState().push(notice);
  announce(noticeText(notice), { key: 'notice', repeat: true });
}

/**
 * Report a failed mutation without losing the user's place.
 *
 * A write that fails silently is the worst outcome a local-first app can
 * produce: the screen still shows the change, the database does not have it,
 * and nothing says so. Every mutation that can reject says so through here,
 * naming the action so the toast reads as a sentence ("Rename failed").
 */
export function notifyFailure(action: string, err: unknown): void {
  notify({ title: `${action} failed`, detail: errorText(err), tone: 'warn' });
}

/** The message of anything that can be thrown, including non-Errors. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useNotices<T>(selector: (s: NoticeState) => T): T {
  return useStore(noticeStore, selector);
}
