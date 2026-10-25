import { useEffect, useState } from 'react';
import { type DataStatusState, useDataStatus } from '@/stores/dataStatus';
import { type ShellReadiness, shellReadiness, swStatusStore, useSwStatus } from '@/stores/swStatus';

/**
 * How long a first install may take before the card stops saying "Not yet" and
 * suggests a reload. Measured from page load, so a card opened late does not
 * restart the clock. Generous, because the shell is about a megabyte and a
 * slow connection is exactly when someone wants to know.
 */
export const SHELL_STALL_MS = 60_000;

export type ShellStatus = ShellReadiness | 'stalled';

export type CompendiumState = 'downloading' | 'complete' | 'stopped';

/**
 * The compendium side, from the download queue's phase alone: `done` is set
 * only once every pack for the active tag has drained, so it already means
 * complete, and the roster never has to scan the cache to find out.
 */
export function compendiumState(phase: DataStatusState['phase']): CompendiumState {
  switch (phase) {
    case 'done':
      return 'complete';
    case 'error':
      return 'stopped';
    default:
      return 'downloading';
  }
}

/** Safe to open with no connection: the shell is cached and so is every pack. */
export function isOfflineReady(shell: ShellStatus, phase: DataStatusState['phase']): boolean {
  return shell === 'ready' && phase === 'done';
}

export function useAppShellReadiness(): ShellStatus {
  const shell = useSwStatus(shellReadiness);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (shell !== 'pending') return;
    let live = true;
    // The registration callback lands on window load; asking directly answers
    // a warm boot sooner.
    navigator.serviceWorker
      .getRegistration()
      .then((r) => {
        if (r?.active) swStatusStore.getState().markReady();
      })
      .catch(() => undefined);
    const timer = setTimeout(
      () => live && setStalled(true),
      Math.max(0, SHELL_STALL_MS - performance.now()),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shell]);

  return shell === 'pending' && stalled ? 'stalled' : shell;
}

export function useOfflineReadiness(): {
  shell: ShellStatus;
  compendium: CompendiumState;
  ready: boolean;
} {
  const shell = useAppShellReadiness();
  const phase = useDataStatus((s) => s.phase);
  return { shell, compendium: compendiumState(phase), ready: isOfflineReady(shell, phase) };
}
