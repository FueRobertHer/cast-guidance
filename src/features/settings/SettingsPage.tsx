import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  downloadAllPacks,
  getActiveTag,
  listAvailableTags,
  updateToTag,
  verifyFullOffline,
} from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { resetAppData } from '@/db/reset';
import { useDataStatus } from '@/stores/dataStatus';
import { errorText } from '@/stores/notices';
import { askConfirm } from '@/ui/dialogs';
import { SourcesSection } from './SourcesSection';

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
  /** Set when the offline inventory itself could not be read. */
  const [offlineError, setOfflineError] = useState<string>();
  const [tags, setTags] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  /**
   * The last thing the data section has to say. `failed` decides whether it is
   * announced and styled as a failure; `failedTag` additionally means there is
   * a specific install to retry.
   */
  const [updateMsg, setUpdateMsg] = useState<{
    text: string;
    failed?: boolean;
    failedTag?: string;
  }>();
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState<string>();
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

  /** Re-read what is cached; the numbers are a claim, so a failure to read them says so. */
  const measureOffline = () => {
    void verifyFullOffline()
      .then((v) => {
        setOffline(v);
        setOfflineError(undefined);
      })
      .catch((err: unknown) => setOfflineError(errorText(err)));
  };

  useEffect(measureOffline, []);

  const offlineReady = offline !== undefined && offline.cached === offline.total;
  /** Non-undefined only when the last install attempt failed, and it names it. */
  const failedInstallTag = updateMsg?.failedTag;

  /**
   * The install itself, without the confirmation. Retrying is agreeing to the
   * same thing twice, so the retry path re-enters here rather than asking
   * again; the failed attempt already left the old version live and intact.
   */
  const install = async (tag: string) => {
    setUpdating(true);
    setUpdateMsg(undefined);
    try {
      await updateToTag(tag);
      invalidateRegistry();
      setUpdateMsg({ text: `Now on ${tag}. Characters re-derive automatically.` });
      setTags(null);
      measureOffline();
    } catch (err) {
      setUpdateMsg({ text: `Update failed: ${errorText(err)}`, failed: true, failedTag: tag });
    } finally {
      setUpdating(false);
    }
  };

  const runUpdate = async (tag: string) => {
    const ok = await askConfirm({
      title: `Install data version ${tag}?`,
      detail: 'The current version stays until the new one downloads and passes checks (~2.5 MB).',
      confirmLabel: 'Install',
    });
    if (!ok) return;
    await install(tag);
  };

  /**
   * "Everything, now" rather than "everything, eventually": the background
   * queue drains in idle time and can stop on an error the user never sees,
   * which is exactly the state the line above reports as "31/48 files". This
   * button is both the way to finish that download and the way to retry it.
   */
  const downloadEverything = async () => {
    setDownloading(true);
    setDownloadFailed(undefined);
    try {
      await downloadAllPacks();
    } catch (err) {
      setDownloadFailed(errorText(err));
    } finally {
      setDownloading(false);
      measureOffline();
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
            {/* Clamped like the banner's bar: the counters are shared, so a run
                that starts while another is finishing can pass its own total. */}
            {(updating || downloading) && filesTotal > 0
              ? ` (${Math.min(filesDone, filesTotal)}/${filesTotal})`
              : ''}
          </dd>
          <dt className="text-ink-muted">Offline compendium</dt>
          <dd>
            {offlineError !== undefined
              ? 'could not be read'
              : offline === undefined
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
                  setUpdateMsg({
                    text: `Could not list versions: ${errorText(err)}`,
                    failed: true,
                  }),
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
                disabled={updating || downloading}
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
        {updateMsg !== undefined &&
          (updateMsg.failed !== true ? (
            <p className="text-xs text-ink-muted">{updateMsg.text}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <p className="text-xs text-amber-300">
                {updateMsg.text}
                {failedInstallTag !== undefined && ' Your current version is untouched.'}
              </p>
              {failedInstallTag !== undefined && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => void install(failedInstallTag)}
                  className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  Retry install
                </button>
              )}
            </div>
          ))}

        {/* Offline readiness is a claim the app makes about itself, so it comes
            with the control that makes it true and the reason it is not. */}
        {(offlineError !== undefined || (offline !== undefined && !offlineReady)) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={downloading || updating}
              onClick={() => void downloadEverything()}
              className="w-fit rounded-lg bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {downloading
                ? 'Downloading…'
                : downloadFailed === undefined
                  ? 'Make available offline'
                  : 'Retry download'}
            </button>
            {downloadFailed !== undefined && !downloading && (
              <p className="text-xs text-amber-300" role="alert">
                Download failed: {downloadFailed}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-ink-muted">
          Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
          with the app itself. Characters store name references, so they survive data updates.
        </p>
      </section>

      <SourcesSection />

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
