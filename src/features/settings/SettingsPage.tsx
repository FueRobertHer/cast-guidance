import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getActiveTag, listAvailableTags, updateToTag, verifyFullOffline } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { resetAppData } from '@/db/reset';
import { useDataStatus } from '@/stores/dataStatus';
import { askConfirm } from '@/ui/dialogs';

/**
 * Measured cached-data size alongside the browser's own figure. They differ,
 * and the difference is not a bug: `estimate()` reports the on-disk footprint,
 * which carries index overhead and space freed by deletes that the storage
 * engine has not compacted yet, so it reads high after a reset or a version
 * swap and settles later. `cachedBytes` is the actual content total.
 *
 * Re-measured whenever the download queue changes phase, so the numbers are
 * not a stale snapshot from first mount.
 */
function useStorageUsage(phase: string) {
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>();
  const [cachedBytes, setCachedBytes] = useState<number>();
  useEffect(() => {
    // Nothing has been fetched yet before the queue starts, so there is no
    // point measuring; every later phase change is worth a re-read.
    if (phase === 'idle') return;
    void navigator.storage
      ?.estimate?.()
      .then(setEstimate)
      .catch(() => undefined);
    void dataCacheRepo
      .totalBytes()
      .then(setCachedBytes)
      .catch(() => undefined);
  }, [phase]);
  return { estimate, cachedBytes };
}

const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Component() {
  const phase = useDataStatus((s) => s.phase);
  const filesDone = useDataStatus((s) => s.filesDone);
  const filesTotal = useDataStatus((s) => s.filesTotal);
  const [offline, setOffline] = useState<{ cached: number; total: number }>();
  const [tags, setTags] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string>();
  const { estimate, cachedBytes } = useStorageUsage(phase);

  const resetAll = async () => {
    const ok = await askConfirm({
      title: 'Reset all app data?',
      detail:
        'Deletes every character, homebrew file, and cached download on this device, then reloads. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    setResetMsg(undefined);
    try {
      await resetAppData();
      window.location.reload();
    } catch (err) {
      setResetting(false);
      setResetMsg(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    void verifyFullOffline()
      .then(setOffline)
      .catch(() => undefined);
  }, []);

  const offlineReady = offline !== undefined && offline.cached === offline.total;

  const runUpdate = async (tag: string) => {
    const ok = await askConfirm({
      title: `Install data version ${tag}?`,
      detail: 'The current version stays until the new one downloads and passes checks (~2.5 MB).',
      confirmLabel: 'Install',
    });
    if (!ok) return;
    setUpdating(true);
    setUpdateMsg(undefined);
    try {
      await updateToTag(tag);
      invalidateRegistry();
      setUpdateMsg(`Now on ${tag}. Characters re-derive automatically.`);
      setTags(null);
      void verifyFullOffline().then(setOffline);
    } catch (err) {
      setUpdateMsg(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Game data</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">Dataset version</dt>
          <dd>{getActiveTag()}</dd>
          <dt className="text-ink-muted">Download queue</dt>
          <dd className="capitalize">
            {phase}
            {updating && filesTotal > 0 ? ` (${filesDone}/${filesTotal})` : ''}
          </dd>
          <dt className="text-ink-muted">Offline compendium</dt>
          <dd>
            {offline === undefined
              ? '…'
              : offlineReady
                ? 'ready ✓'
                : `${offline.cached}/${offline.total} files`}
          </dd>
          <dt className="text-ink-muted">Game data size</dt>
          <dd>{mb(cachedBytes)}</dd>
          <dt className="text-ink-muted">Browser storage</dt>
          <dd>
            {mb(estimate?.usage)} of {mb(estimate?.quota)}
          </dd>
        </dl>

        {tags === null ? (
          <button
            type="button"
            disabled={updating}
            onClick={() => {
              void listAvailableTags()
                .then(setTags)
                .catch((err: unknown) =>
                  setUpdateMsg(
                    `Could not list versions: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
            }}
            className="w-fit rounded-lg bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Check for data updates
          </button>
        ) : tags.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No compatible data versions available. Newer releases with a different schema are not
            shown because this app build cannot read them safely.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor="data-tag" className="text-sm text-ink-muted">
              Switch version
            </label>
            {/*
             * `appearance-none` + our own chevron: the native control paints a
             * light system dropdown that reads as a foreign element on this
             * dark surface. Options still use OS chrome in the popup, so they
             * carry explicit colors too.
             */}
            <div className="relative">
              <select
                id="data-tag"
                value={getActiveTag()}
                disabled={updating}
                onChange={(e) => {
                  const t = e.target.value;
                  if (t !== getActiveTag()) void runUpdate(t);
                }}
                className="w-full appearance-none rounded-lg bg-surface-2 py-2 pr-9 pl-3 text-sm outline-none disabled:opacity-40"
              >
                {(tags.includes(getActiveTag()) ? tags : [getActiveTag(), ...tags]).map((t) => (
                  <option key={t} value={t} className="bg-surface-2 text-ink">
                    {t}
                    {t === getActiveTag() ? ' (installed)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted"
              />
            </div>
            {updating && <span className="text-xs text-ink-muted">Installing…</span>}
          </div>
        )}
        {updateMsg !== undefined && <p className="text-xs text-amber-300">{updateMsg}</p>}
        <p className="text-xs text-ink-muted">
          Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
          with the app itself. Characters store name references, so they survive data updates.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Your data &amp; privacy</h2>
        <p className="text-xs text-ink-muted">
          Everything — your characters, homebrew, dice history, and the downloaded compendium —
          lives only in this browser on this device. Nothing is sent to a server and there are no
          accounts. Back a character up any time with its Export button; that file is the only copy
          that leaves the device.
        </p>
        <p className="text-xs text-ink-muted">
          Because it&rsquo;s browser storage, clearing site data or heavy storage pressure can evict
          it. Export characters you care about, and use “Make available offline” above so the
          compendium is cached.
        </p>
        <button
          type="button"
          disabled={resetting}
          onClick={() => void resetAll()}
          className="w-fit rounded-lg border border-accent px-3 py-2 text-sm font-semibold text-accent disabled:opacity-40"
        >
          {resetting ? 'Resetting…' : 'Reset app data'}
        </button>
        <p className="text-xs text-ink-muted">
          Permanently deletes all characters, homebrew, and cached data on this device, then
          reloads. This cannot be undone — export anything you want to keep first.
        </p>
        {resetMsg !== undefined && <p className="text-xs text-amber-300">{resetMsg}</p>}
      </section>
    </main>
  );
}
