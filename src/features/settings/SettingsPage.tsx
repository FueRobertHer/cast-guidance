import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { GAME_DATA_DOWNLOAD_SIZE } from '@/data5e/downloadSize';
import { getRevision, subscribeRevision } from '@/data5e/landing';
import {
  CompendiumNotDownloadedError,
  downloadAllPacks,
  getActiveTag,
  listAvailableTags,
  updateToTag,
  verifyFullOffline,
} from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { resetAppData } from '@/db/reset';
import { usePersistentStorage } from '@/lib/persistentStorage';
import { storageErrorText } from '@/lib/storageErrors';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce } from '@/stores/announcer';
import { dataStatusStore, useDataStatus } from '@/stores/dataStatus';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { errorText } from '@/stores/notices';
import { offlineReadyAnnounced } from '@/stores/offlineReady';
import { onboardingStore } from '@/stores/onboarding';
import { Button, buttonClass } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { cardClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { PERSIST_DENIED_TEXT, PersistStatus, STORAGE_DETAILS_ID } from '../onboarding/Status';
import { ConditionMotionSwitch } from './ConditionMotionSwitch';
import { OneUseDiceSetting } from './OneUseDiceSetting';
import { SourcesSection } from './SourcesSection';
import { ThemePicker } from './ThemePicker';

/** Said once a requested download completes; it matches the line that turns to "ready". */
export const OFFLINE_DOWNLOADED_TEXT = 'Game data downloaded. The offline compendium is ready.';

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

/**
 * The offline inventory's answer before the class and spell indexes have
 * landed (a first download that never started, or stopped inside essentials).
 */
const NOT_DOWNLOADED = 'not downloaded';

/**
 * The About section links the copies on the repository's main branch, which
 * can be ahead of the deployed build. Offline they do not open, which is
 * acceptable for reference documents.
 */
const REPO_BLOB_URL = 'https://github.com/FueRobertHer/cast-guidance/blob/main';
export const ABOUT_LINKS = [
  { label: 'License', path: 'LICENSE' },
  { label: 'Third-party notices', path: 'THIRD_PARTY_NOTICES.md' },
  { label: 'Content notice', path: 'docs/content-notice.md' },
] as const;

const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Whether the address links to Storage details. Read from the address rather
 * than the router, so the page renders without one.
 */
const linkedToDetails = () => window.location.hash === `#${STORAGE_DETAILS_ID}`;

/** A section's heading, in the screen's `heading` style (DS-001). */
const H2 = 'px-1 text-heading';

export function Component() {
  usePageTitle('Settings');
  const phase = useDataStatus((s) => s.phase);
  const filesDone = useDataStatus((s) => s.filesDone);
  const filesTotal = useDataStatus((s) => s.filesTotal);
  const rolledBackFrom = useDataStatus((s) => s.rolledBackFrom);
  const queueId = useId();
  const [offline, setOffline] = useState<{ cached: number; total: number }>();
  /** Set when the offline inventory itself could not be read. */
  const [offlineError, setOfflineError] = useState<string>();
  const [tags, setTags] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  /**
   * The last thing the data section has to say. `failed` decides whether it is
   * styled as a failure; `failedTag` additionally means there is a specific
   * install to retry; `alert` whether the line is the alert that says it (see
   * `alertsHere`).
   */
  const [updateMsg, setUpdateMsg] = useState<{
    text: string;
    failed?: boolean;
    failedTag?: string;
    alert?: boolean;
  }>();
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState<{ text: string; alert: boolean }>();
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string>();
  const { estimate, cachedBytes } = useStorageUsage(phase);
  const persist = usePersistentStorage();
  const [guideShown, setGuideShown] = useState(false);
  // Opened by a link to it: on arrival, and on a jump to it with the page
  // already open (Back or Forward, or the address bar), which keeps the page
  // mounted and so is only heard as a hash change.
  const [detailsOpen, setDetailsOpen] = useState(linkedToDetails);
  const detailsSummary = useRef<HTMLElement>(null);
  useEffect(() => {
    const arrive = () => {
      if (!linkedToDetails()) return;
      setDetailsOpen(true);
      // Focus follows the link (the browser has already scrolled to it), so
      // a keyboard or screen reader carries on from the details.
      detailsSummary.current?.focus();
    };
    arrive();
    window.addEventListener('hashchange', arrive);
    return () => window.removeEventListener('hashchange', arrive);
  }, []);

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

  /** Files landed so far, as consumers have been told (see `landing.ts`). */
  const revision = useSyncExternalStore(subscribeRevision, getRevision, getRevision);
  /** The latest measurement started; an older one that resolves late is dropped. */
  const measuring = useRef(0);

  /** Re-read what is cached; the numbers are a claim, so a failure to read them says so. */
  const measureOffline = useCallback(() => {
    const run = ++measuring.current;
    void verifyFullOffline()
      .then((v) => {
        if (run !== measuring.current) return;
        setOffline(v);
        setOfflineError(undefined);
      })
      .catch((err: unknown) => {
        if (run !== measuring.current) return;
        // Not a failure to read: there is nothing to count yet.
        setOfflineError(
          err instanceof CompendiumNotDownloadedError ? NOT_DOWNLOADED : errorText(err),
        );
      });
  }, []);

  // Measured on mount and again whenever files land or the queue changes
  // phase. Measured on mount only, a page opened while the background drain
  // was still running said "13/19 files" beside "done" for as long as it
  // stayed open. Landings are flushed in batches, so this re-reads about once
  // per flush window during a drain, not once per file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: phase and revision are refresh triggers
  useEffect(measureOffline, [measureOffline, phase, revision]);

  const offlineReady = offline !== undefined && offline.cached === offline.total;
  /** Non-undefined only when the last install attempt failed, and it names it. */
  const failedInstallTag = updateMsg?.failedTag;
  /**
   * Whether a failure line here is the alert that says it (A11Y-002). Not when
   * the shell's DataBanner is alerting that very failure, so one failure is not
   * two alerts read back to back. Decided once, as the failure is recorded:
   * read from the live phase, a stale line gained the alert role the moment a
   * banner Retry moved the phase on, and kept it after the retry succeeded.
   * `failedTag` is the install that failed, or undefined for a download.
   */
  const alertsHere = (failedTag: string | undefined): boolean => {
    const data = dataStatusStore.getState();
    const bannerShowsIt =
      dbLifecycleStore.getState().state === 'open' &&
      data.phase === 'error' &&
      data.failedTag === failedTag;
    return !bannerShowsIt;
  };

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
      const done = `Now on ${tag}. Characters re-derive automatically.`;
      setUpdateMsg({ text: done });
      // The line appears with its text, which a screen reader may not hear,
      // and the install was waited on, so the outcome is said (A11Y-002).
      announce(done, { key: 'update' });
      setTags(null);
      measureOffline();
    } catch (err) {
      setUpdateMsg({
        text: `Update failed: ${storageErrorText(err)}`,
        failed: true,
        alert: alertsHere(tag),
        failedTag: tag,
      });
    } finally {
      setUpdating(false);
    }
  };

  const runUpdate = async (tag: string) => {
    const ok = await askConfirm({
      title: `Install data version ${tag}?`,
      detail: `The current version stays until the new one downloads and passes checks (up to about ${GAME_DATA_DOWNLOAD_SIZE}).`,
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
    // Read before the download: finishing it is what fires the one-time
    // "Ready to use offline" notice, and then that is the one thing said.
    const noticeSpent = offlineReadyAnnounced();
    try {
      await downloadAllPacks();
      // The button that was pressed retires with the download, so focus has
      // nothing left to say; this is the one word that it finished, unless
      // the offline-ready notice is saying it.
      if (noticeSpent) announce(OFFLINE_DOWNLOADED_TEXT, { key: 'download' });
    } catch (err) {
      setDownloadFailed({ text: storageErrorText(err), alert: alertsHere(undefined) });
    } finally {
      setDownloading(false);
      measureOffline();
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 pt-5 pb-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-title-page">Settings</h1>
      </header>

      {/* First (DS-001): the one setting that changes every screen. */}
      <section className="flex flex-col gap-2">
        <h2 className={H2}>Appearance</h2>
        <div className={cardClass}>
          <ThemePicker />
        </div>
        <div className={cardClass}>
          <ConditionMotionSwitch />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={H2}>House rules</h2>
        <p className="px-1 text-caption text-ink-muted">
          For every character, unless its own Build page says otherwise.
        </p>
        <div className={cardClass}>
          <OneUseDiceSetting />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Game data</h2>
        <dl className={`${cardClass} grid grid-cols-2 gap-y-1 text-body`}>
          <dt className="text-ink-muted">Dataset version</dt>
          <dd>
            {getActiveTag()}
            {rolledBackFrom !== undefined &&
              ` (went back from ${rolledBackFrom}, which could not start)`}
          </dd>
          <dt className="text-ink-muted">Download queue</dt>
          <dd id={queueId} className="capitalize">
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
              ? offlineError === NOT_DOWNLOADED
                ? 'not downloaded yet'
                : 'could not be read'
              : offline === undefined
                ? '…'
                : offlineReady
                  ? 'Ready'
                  : `${offline.cached}/${offline.total} files`}
          </dd>
          <dt className="text-ink-muted">Unpacked game data</dt>
          <dd>{mb(cachedBytes)}</dd>
          <dt className="text-ink-muted">Browser storage</dt>
          <dd>
            {mb(estimate?.usage)} of {mb(estimate?.quota)}
          </dd>
        </dl>

        {tags === null ? (
          <Button
            disabled={updating}
            className="self-start"
            onClick={() => {
              // `maxAgeMs: 0` skips the remembered list: someone who pressed
              // "check for updates" is owed a live answer, not this morning's.
              void listAvailableTags({ maxAgeMs: 0 })
                .then(setTags)
                .catch((err: unknown) =>
                  setUpdateMsg({
                    text: `Could not list versions: ${errorText(err)}`,
                    failed: true,
                  }),
                );
            }}
          >
            Check for data updates
          </Button>
        ) : tags.length === 0 ? (
          <p className="text-body text-ink-muted">
            No compatible data versions available. Newer releases with a different schema are not
            shown because this app build cannot read them safely.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor="data-tag" className="text-body text-ink-muted">
              Switch version
            </label>
            {/*
             * `appearance-none` + our own chevron: the native control paints a
             * system dropdown that reads as a foreign element on this surface.
             * Options still use OS chrome in the popup, so they carry explicit
             * colors too.
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
                className={`${fieldClass} appearance-none pr-9`}
              >
                {(tags.includes(getActiveTag()) ? tags : [getActiveTag(), ...tags]).map((t) => (
                  <option key={t} value={t} className="bg-surface-raised text-ink">
                    {t}
                    {t === getActiveTag() ? ' (installed)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
              />
            </div>
            {updating && <span className="text-caption text-ink-muted">Installing…</span>}
          </div>
        )}
        {updateMsg !== undefined &&
          (updateMsg.failed !== true ? (
            <p className="text-caption text-ink-muted">{updateMsg.text}</p>
          ) : (
            // An alert unless the shell's DataBanner is alerting this same
            // install failure ("Update to … failed"); see `alertsHere`.
            <div
              className="flex flex-wrap items-center gap-2"
              role={updateMsg.alert === false ? undefined : 'alert'}
            >
              <p className="text-caption text-danger">
                {updateMsg.text}
                {failedInstallTag !== undefined && ' Your current version is untouched.'}
              </p>
              {failedInstallTag !== undefined && (
                <Button
                  size="sm"
                  disabled={updating}
                  onClick={() => void install(failedInstallTag)}
                >
                  Retry install
                </Button>
              )}
            </div>
          ))}

        {/* Offline readiness is a claim the app makes about itself, so it comes
            with the control that makes it true and the reason it is not. */}
        {(offlineError !== undefined || (offline !== undefined && !offlineReady)) && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={downloading || updating}
              // Busy while it runs, and described by the queue line that
              // counts the files, so the count is there to read on demand
              // rather than spoken as each file lands.
              aria-busy={downloading}
              aria-describedby={queueId}
              onClick={() => void downloadEverything()}
            >
              {downloading
                ? 'Downloading…'
                : downloadFailed === undefined
                  ? 'Make available offline'
                  : 'Retry download'}
            </Button>
            {/* An alert unless the shell's DataBanner is alerting the same
                failure ("Game data download failed"); one alert is enough. */}
            {downloadFailed !== undefined && !downloading && (
              <p
                className="text-caption text-danger"
                role={downloadFailed.alert ? 'alert' : undefined}
              >
                Download failed: {downloadFailed.text}
              </p>
            )}
          </div>
        )}
        <p className="px-1 text-caption text-ink-muted">
          Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
          with the app itself. Characters store name references, so they survive data updates.
        </p>
      </section>

      <SourcesSection />

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Your data &amp; privacy</h2>
        <p className="px-1 text-caption text-ink-muted">
          Everything (your characters, homebrew, dice history, and the downloaded compendium) lives
          only in this browser on this device. Nothing is sent to a server and there are no
          accounts. Back a character up any time from its ⋯ menu on Characters, then Export; that
          file is the only copy that leaves the device.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-body text-ink-muted">Persistent storage</span>
          <PersistStatus state={persist.state} ref={persist.statusRef} />
          {persist.state === 'best-effort' && (
            <Button aria-disabled={persist.requesting} onClick={() => void persist.request()}>
              Ask the browser to keep my data
            </Button>
          )}
        </div>
        {persist.state === 'denied' && (
          <p className="px-1 text-caption text-ink-muted">
            {PERSIST_DENIED_TEXT} Export to keep a copy.
          </p>
        )}
        {/* The why behind the roster's checklist, which links here: closed
            unless that link opened the page, so Settings stays short. */}
        <details
          id={STORAGE_DETAILS_ID}
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
          className="group scroll-mt-4 rounded-card bg-surface shadow-card ring-1 ring-line ring-inset"
        >
          <summary
            ref={detailsSummary}
            className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-x-2 px-4 py-2.5 text-body-strong"
          >
            Storage details
            <ChevronDown
              size={16}
              aria-hidden
              className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="flex flex-col gap-2 border-line border-t p-4 text-caption text-ink-muted">
            <p>
              Because it&rsquo;s browser storage, the browser can clear it when storage runs low or
              when you clear browsing data. Export characters you care about, and use “Make
              available offline” above so the compendium is cached.
            </p>
            <p>
              Your browser may ask to allow persistent storage. Choosing Allow keeps your data
              safer.
            </p>
            <p>Back up a character any time: open its ⋯ menu on Characters and choose Export.</p>
            <p>
              On iPhone and iPad, Safari can clear a site&rsquo;s data after about a week without a
              visit. Add Cast Guidance to your Home Screen before you build characters. The Home
              Screen app has its own storage, so Export from Safari and Import there.
            </p>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            onClick={() => {
              onboardingStore.getState().reopen();
              setGuideShown(true);
            }}
          >
            Show the getting-started guide
          </Button>
          {/* Mounted empty so the confirmation is announced when it arrives. */}
          <p aria-live="polite" className="text-caption text-ink-muted">
            {guideShown ? 'Shown on the Characters page.' : ''}
          </p>
        </div>
        {/* The screen's one destructive control, so it is the red one. */}
        <Button
          variant="danger"
          disabled={resetting}
          className="self-start"
          onClick={() => void resetAll()}
        >
          {resetting ? 'Resetting…' : 'Reset app data'}
        </Button>
        <p className="px-1 text-caption text-ink-muted">
          Permanently deletes all characters, homebrew, and cached data on this device, then
          reloads. This cannot be undone. Export anything you want to keep first.
        </p>
        {resetMsg !== undefined && <p className="px-1 text-caption text-danger">{resetMsg}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={H2}>About</h2>
        <p className="px-1 text-caption text-ink-muted">
          Cast Guidance is open source under the MIT License.
        </p>
        {/* Button-sized links: they meet the target size that inline caption
            links would not, and they wrap on a narrow screen. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {ABOUT_LINKS.map(({ label, path }) => (
            <a
              key={path}
              href={`${REPO_BLOB_URL}/${path}`}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClass({})}
            >
              {label}
              {/* The space sits outside the span: some name computations
                  trim a child's leading space, which ran the words together. */}{' '}
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
