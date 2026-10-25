import { useEffect } from 'react';
import { dataStatusStore } from '@/stores/dataStatus';
import { NOTICE_MS, noticeStore, notify } from '@/stores/notices';
import { onboardingStore } from '@/stores/onboarding';
import { shellReadiness, swStatusStore } from '@/stores/swStatus';
import { isOfflineReady } from './useOfflineReadiness';

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

/**
 * Say "Ready to use offline" once per device, the moment it becomes true.
 *
 * It is for someone who hid the getting-started card, or left the roster,
 * before the download finished; while the card is still showing, its own
 * line says Ready and this stays quiet. A device that was already ready
 * before this visit (launched under a worker, nothing to fetch) is recorded
 * without a word, since nothing changed for it. Once recorded, later boots
 * subscribe to nothing.
 */
export function watchOfflineReady(): () => void {
  if (announced()) return () => undefined;
  // Read before this run can change it: a page opened under a worker was
  // launched from a shell an earlier visit installed.
  const warmShell = 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
  let lastNoticeAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subs: Array<() => void> = [];
  const stop = () => {
    for (const unsub of subs.splice(0)) unsub();
    clearTimeout(timer);
  };

  // Another notice still on screen is not replaced; this one waits its turn.
  const announce = () => {
    const wait = lastNoticeAt + NOTICE_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(announce, wait);
      return;
    }
    stop();
    markAnnounced();
    notify({
      title: 'Ready to use offline',
      detail: 'The app and its game data now open without a connection.',
      tone: 'good',
    });
  };

  let decided = false;
  const check = () => {
    const data = dataStatusStore.getState();
    if (decided || !isOfflineReady(shellReadiness(swStatusStore.getState()), data.phase)) return;
    decided = true;
    if ((warmShell && data.filesTotal === 0) || !onboardingStore.getState().dismissed) {
      stop();
      markAnnounced();
      return;
    }
    announce();
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
