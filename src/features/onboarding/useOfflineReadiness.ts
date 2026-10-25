import { useEffect, useState } from 'react';
import { verifyFullOffline } from '@/data5e/loader';
import { type DataStatusState, useDataStatus } from '@/stores/dataStatus';
import {
  type OfflineReadiness,
  offlineReadiness,
  pageControlled,
  type ShellReadiness,
  shellReadiness,
  swStatusStore,
  useSwStatus,
} from '@/stores/swStatus';

/**
 * How long a first install may take before the card stops saying "Not yet" and
 * suggests a reload. Measured from page load, so a card opened late does not
 * restart the clock. Generous, because the shell is about a megabyte and a
 * slow connection is exactly when someone wants to know.
 */
export const SHELL_STALL_MS = 60_000;

/** `checking` until the first lookup has answered, so a warm boot never flashes "Not yet". */
export type ShellStatus = ShellReadiness | 'checking' | 'stalled';

export type CompendiumState = 'checking' | 'downloading' | 'complete' | 'stopped';

/**
 * The compendium side, from the download queue's phase: `done` is set only
 * once every pack for the active tag has drained, so it already means
 * complete, and the roster never has to scan the cache to find out. `idle` is
 * before the boot routine has said anything, which is no answer yet.
 */
export function compendiumState(phase: DataStatusState['phase']): CompendiumState {
  switch (phase) {
    case 'idle':
      return 'checking';
    case 'done':
      return 'complete';
    case 'error':
      return 'stopped';
    default:
      return 'downloading';
  }
}

/** Guarded: the getter itself can throw when site storage is blocked. */
async function hasActiveWorker(): Promise<boolean> {
  try {
    return (await navigator.serviceWorker.getRegistration())?.active != null;
  } catch {
    return false;
  }
}

export function useAppShellReadiness(): ShellStatus {
  const shell = useSwStatus(shellReadiness);
  const [checked, setChecked] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (shell !== 'pending') return;
    let live = true;
    // The registration callback waits for workbox-window to load and register;
    // asking the browser directly answers a warm boot without that wait.
    void hasActiveWorker().then((active) => {
      if (active) swStatusStore.getState().markReady();
      if (live) setChecked(true);
    });
    const timer = setTimeout(
      () => live && setStalled(true),
      Math.max(0, SHELL_STALL_MS - performance.now()),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shell]);

  if (shell !== 'pending') return shell;
  if (stalled) return 'stalled';
  return checked ? 'pending' : 'checking';
}

/**
 * A failed version install leaves the phase at `error`, but the release still
 * live may be complete, and saying "stopped" about it would under-claim. Only
 * then does this ask the loader for the cache inventory; every other phase
 * answers for itself.
 */
function useCompendium(): CompendiumState {
  const phase = useDataStatus((s) => s.phase);
  const failedTag = useDataStatus((s) => s.failedTag);
  const failedInstall = phase === 'error' && failedTag !== undefined;
  const [verified, setVerified] = useState<{ tag: string; complete: boolean }>();

  useEffect(() => {
    if (!failedInstall) return;
    let live = true;
    verifyFullOffline()
      .then(
        (v) =>
          live && setVerified({ tag: failedTag, complete: v.total > 0 && v.cached === v.total }),
      )
      .catch(() => live && setVerified({ tag: failedTag, complete: false }));
    return () => {
      live = false;
    };
  }, [failedInstall, failedTag]);

  if (!failedInstall) return compendiumState(phase);
  if (verified?.tag !== failedTag) return 'checking';
  return verified.complete ? 'complete' : 'stopped';
}

export function useOfflineReadiness(): {
  shell: ShellStatus;
  compendium: CompendiumState;
  offline: OfflineReadiness;
  /** False while either side has yet to give its first answer. */
  settled: boolean;
} {
  const shell = useAppShellReadiness();
  const compendium = useCompendium();
  return {
    shell,
    compendium,
    offline: offlineReadiness(shell, compendium === 'complete', pageControlled()),
    settled: shell !== 'checking' && compendium !== 'checking',
  };
}
