import { useEffect } from 'react';
import { dataStatusStore } from '@/stores/dataStatus';
import { NOTICE_MS, noticeStore, notify } from '@/stores/notices';
import { onboardingStore } from '@/stores/onboarding';
import {
  type OfflineReadiness,
  offlineReadiness,
  pageControlled,
  shellReadiness,
  swStatusStore,
} from '@/stores/swStatus';

export const OFFLINE_ANNOUNCED_KEY = 'cast-guidance:offline-ready-announced';

function announced(): boolean {
  try {
    return localStorage.getItem(OFFLINE_ANNOUNCED_KEY) !== null;
  } catch {
    return false;
  }
}

function markAnnounced(): void {
  try {
    localStorage.setItem(OFFLINE_ANNOUNCED_KEY, new Date().toISOString());
  } catch {
    // Unremembered: at worst a later visit decides again, silently or not.
  }
}

/** What the notice says, honest about a tab the worker does not control yet. */
const NOTICE_COPY: Record<Exclude<OfflineReadiness, 'no'>, { title: string; detail: string }> = {
  now: {
    title: 'Ready to use offline',
    detail: 'The app and its game data now open without a connection.',
  },
  'next-launch': {
    title: 'Ready to use offline next time',
    detail: 'It works offline the next time you open the app. Reload now to use it offline here.',
  },
};

/**
 * Say "Ready to use offline" once per device, the moment it becomes true.
 *
 * It is for anyone not looking at the getting-started card when that happens:
 * someone who hid it, or who is on another screen. Only while a card is
 * actually on screen does this stay quiet, since the card's own line says the
 * same thing. A device that was already ready before this visit (launched
 * under a worker, nothing to fetch) is recorded without a word, since nothing
 * changed for it. Once recorded, later boots subscribe to nothing.
 */
export function watchOfflineReady(): () => void {
  if (announced()) return () => undefined;
  // Read before this run can change it: a page opened under a worker was
  // launched from a shell an earlier visit installed.
  const warmShell = pageControlled();
  let lastNoticeAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subs: Array<() => void> = [];
  const stop = () => {
    for (const unsub of subs.splice(0)) unsub();
    clearTimeout(timer);
  };

  // Another notice still on screen is not replaced; this one waits its turn.
  const announce = (ready: Exclude<OfflineReadiness, 'no'>) => {
    const wait = lastNoticeAt + NOTICE_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => announce(ready), wait);
      return;
    }
    stop();
    markAnnounced();
    notify({ ...NOTICE_COPY[ready], tone: 'good' });
  };

  let decided = false;
  const check = () => {
    const data = dataStatusStore.getState();
    const ready = offlineReadiness(
      shellReadiness(swStatusStore.getState()),
      data.phase === 'done',
      warmShell,
    );
    if (decided || ready === 'no') return;
    decided = true;
    if ((warmShell && data.filesTotal === 0) || onboardingStore.getState().cardsShown > 0) {
      stop();
      markAnnounced();
      return;
    }
    announce(ready);
  };

  subs.push(
    noticeStore.subscribe((s, prev) => {
      if (s.seq !== prev.seq) lastNoticeAt = Date.now();
    }),
    dataStatusStore.subscribe(check),
    swStatusStore.subscribe(check),
  );
  check();
  return stop;
}

/** Mounted once in the app shell; renders nothing. */
export function OfflineReadyNotice() {
  useEffect(() => watchOfflineReady(), []);
  return null;
}
