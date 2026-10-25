import { useState } from 'react';
import { type DataStatusState, dataStatusStore, useDataStatus } from '@/stores/dataStatus';
import { type DbLifecycleState, dbLifecycleStore, useDbLifecycle } from '@/stores/dbLifecycle';

const alertsDownload = (s: DataStatusState) => s.phase === 'error' && s.failedTag === undefined;
const isOpen = (s: DbLifecycleState) => s.state === 'open';

/**
 * Whether a page's data failure panel is the alert that says its failure
 * (A11Y-002: each failure is said once). Call it in a component that mounts
 * with the failure.
 *
 * The shell's DataBanner alerts a failed download (offline or not) with its
 * reason and a Retry, so while it does the panel is a plain visual. Otherwise
 * the panel is the one voice, offline included: a repair pressed offline, or
 * a section that failed after the queue finished, has no banner to speak for
 * it. Decided as the panel mounts, with one change allowed: a panel that
 * alerts gives the role up if the banner starts alerting the same outage
 * after it (dropping a role says nothing). A silent panel never gains it,
 * since a role that arrives late reads out a line that is no longer news.
 */
export function useFailureAlert(): boolean {
  const [alertedFirst] = useState(
    () => !(isOpen(dbLifecycleStore.getState()) && alertsDownload(dataStatusStore.getState())),
  );
  const queueFailed = useDataStatus(alertsDownload);
  const dbOpen = useDbLifecycle(isOpen);
  const bannerAlerts = queueFailed && dbOpen;
  const [dropped, setDropped] = useState(false);
  if (alertedFirst && bannerAlerts && !dropped) setDropped(true);
  return alertedFirst && !dropped && !bannerAlerts;
}
