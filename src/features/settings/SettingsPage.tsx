import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link } from 'react-router';
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
import { resolveTheme, useThemeChoice } from '@/lib/theme';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce } from '@/stores/announcer';
import { type DataStatusState, dataStatusStore, useDataStatus } from '@/stores/dataStatus';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { errorText } from '@/stores/notices';
import { offlineReadyAnnounced } from '@/stores/offlineReady';
import { onboardingStore } from '@/stores/onboarding';
import { Button, buttonClass } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { cardClass, listRowClass, openListClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { PERSIST_DENIED_TEXT, PersistStatus, STORAGE_DETAILS_ID } from '../onboarding/Status';
import { BOOKS_PATH } from '../workshop/collections';
import { analyticsEnabled } from './analytics';
import { ConditionMotionSwitch } from './ConditionMotionSwitch';
import { houseRulesWords, useAppRules } from './HouseRulesSection';
import { booksShownWords, useBooksShown } from './SourcesSection';
import { ThemeFiles } from './ThemeFiles';
import { ThemePicker } from './ThemePicker';

/** Where the table rules and rule packs are set (ADR-002, D1; board 10, B). */
const RULES_PATH = '/workshop/rules';

/**
 * What a build with analytics on sends, said beside the privacy copy. The
 * address is what `analyticsUrl.ts` cuts down to its route; the referring
 * site and the browser's own details come with the script's requests, so
 * they are named too rather than implied away.
 */
export const ANALYTICS_ON_TEXT =
  'This build counts page visits with Vercel Web Analytics. Each visit sends which kind of page was opened (character, collection and entry ids are taken out of its address), the site that linked you here, and what any web request carries, such as your browser and device type. None of your characters, homebrew or dice history is sent.';

/** Said once a requested download completes; it matches the line that turns to "ready". */
export const OFFLINE_DOWNLOADED_TEXT = 'Game data downloaded. The offline compendium is ready.';

/**
 * The page's sections, in order, as the contents list names them. Each id is
 * its section's anchor; none may be `storage-details` or start with `theme=`,
 * which this page reads off the address for other jobs.
 */
export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'rules-and-content', label: 'Rules & content' },
  { id: 'game-data', label: 'Game data' },
  { id: 'your-data', label: 'Your data & privacy' },
  { id: 'help-and-about', label: 'Help & about' },
  { id: 'reset', label: 'Reset' },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** A section's anchor and heading, so the contents list and the page say the same words. */
function sectionOf(id: SectionId) {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no Settings section ${id}`);
  return found;
}

/** A section's box: its heading over its card, and room above it when an anchor lands on it. */
const SECTION = 'flex scroll-mt-4 flex-col gap-2';

/**
 * "On this page", in the empty column beside the sections on a wide screen,
 * staying in view as the page scrolls. A phone has no room beside them, and
 * its six short sections are a couple of flicks, so it goes without. Plain
 * anchors: the browser scrolls and moves the focus start to the section.
 */
function OnThisPage() {
  const labelId = useId();
  return (
    <nav
      aria-labelledby={labelId}
      className="hidden lg:sticky lg:top-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-1 lg:self-start"
    >
      <p id={labelId} className="px-3 pb-1 text-caption text-ink-muted">
        On this page
      </p>
      <ul className="flex flex-col">
        {SETTINGS_SECTIONS.map(({ id, label }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="flex min-h-tap items-center rounded-control px-3 text-label text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The theme and the motion switch, in one card. While a theme of the
 * player's own is in use, the section is drawn in that theme's built-in base
 * (a subtree with its own `data-theme`, which every built-in fills
 * completely): a theme can make anything unreadable, and this is where the
 * way back is.
 */
function Appearance() {
  const choice = useThemeChoice();
  const own = choice.startsWith('custom:');
  const { id, label } = sectionOf('appearance');
  return (
    <section
      id={id}
      data-theme={own ? resolveTheme(choice) : undefined}
      className={`${SECTION} ${own ? '-mx-2 rounded-card bg-bg px-2 py-3 font-sans text-ink' : ''}`}
    >
      <h2 className={H2}>{label}</h2>
      <div className={`${cardClass} flex flex-col gap-4`}>
        <ThemePicker />
        <ThemeFiles />
        <div className="-mx-4 border-line border-t px-4 pt-4">
          <ConditionMotionSwitch />
        </div>
      </div>
    </section>
  );
}

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

/** The download's phase as the Download line says it; the store's own names are code words. */
export const PHASE_WORDS: Record<DataStatusState['phase'], string> = {
  idle: 'Not started',
  working: 'In progress',
  done: 'Complete',
  error: 'Failed',
};

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

/** What "Check for data updates" says when nothing on the mirror can be installed. */
const NO_COMPATIBLE_TEXT =
  'No compatible data versions available. Newer releases with a different schema are not shown because this app build cannot read them safely.';

/**
 * The answer to "Check for data updates", said above the version list. The
 * list comes newest first, as the boot-time check reads it, and like that
 * check it passes over the release this device went back from: offering it
 * again only invites the same rollback.
 */
export function updateStatusText(
  tags: readonly string[],
  active: string,
  wentBackFrom?: string,
): string {
  const newest = tags.find((t) => t !== wentBackFrom);
  const skipped =
    wentBackFrom !== undefined && tags[0] === wentBackFrom
      ? ` ${wentBackFrom} could not start on this device.`
      : '';
  return newest === undefined || newest === active
    ? `Up to date: ${active} is the newest version this app can use.${skipped}`
    : `${newest} is available. You have ${active}.${skipped}`;
}

/**
 * A size in MB, or in GB from 1 GB up: a browser's quota is often gigabytes,
 * and "10244.4 MB" asks the reader to do the division.
 */
export function sizeText(n?: number): string {
  if (n === undefined) return '?';
  const mb = n / 1024 / 1024;
  // Compared as shown, so 1023.96 MB reads "1.0 GB", not "1024.0 MB".
  return Number(mb.toFixed(1)) >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Whether the address links to Storage details. Read from the address rather
 * than the router, so the page renders without one.
 */
const linkedToDetails = () => window.location.hash === `#${STORAGE_DETAILS_ID}`;

/** A section's heading, in the screen's `heading` style (DS-001). */
const H2 = 'px-1 text-heading';

/**
 * One label and its value in a list of facts. The label keeps a set width,
 * so the values line up a short way from it; the value sits beside it while
 * both fit and drops below it once they do not (large text, a wide font on a
 * narrow phone), rather than running off the side of the screen.
 */
function Fact({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-6">
      <dt className="max-w-full basis-40 text-ink-muted">{label}</dt>
      <dd id={id} className="min-w-0 flex-1 basis-32 text-ink">
        {children}
      </dd>
    </div>
  );
}

/**
 * A row that opens where a setting now lives, in the Workshop: its name over
 * what it is set to, so Settings still says it. A row of a list, which draws
 * the card around it.
 */
function WorkshopRow({ to, title, caption }: { to: string; title: string; caption: string }) {
  return (
    <Link to={to} className={`${listRowClass} hover:bg-surface-hover`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-strong">{title}</span>
        {/* A flex column draws no space between its items; a name read aloud needs one. */}
        <span className="sr-only">,</span>{' '}
        <span className="text-caption text-ink-muted">{caption}</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-faint" />
    </Link>
  );
}

/** The table rules every character plays by, in short, opening the Rules page. */
export function TableRulesRow() {
  const { rules, ready } = useAppRules();
  return (
    <WorkshopRow
      to={RULES_PATH}
      title="Table rules and rule packs"
      caption={ready ? houseRulesWords(rules) : 'Loading…'}
    />
  );
}

/** Which books show, opening The books in the Workshop. */
export function BooksRow() {
  const shown = useBooksShown();
  return <WorkshopRow to={BOOKS_PATH} title="The books" caption={booksShownWords(shown)} />;
}

/**
 * The two settings that live in the Workshop, side by side in one list. The
 * list is unclipped (`openListClass`), so a focused row's ring is drawn
 * whole rather than cut off at the card's sides.
 */
function RulesAndContent() {
  const { id, label } = sectionOf('rules-and-content');
  return (
    <section id={id} className={SECTION}>
      <h2 className={H2}>{label}</h2>
      <div className={openListClass}>
        <TableRulesRow />
        <BooksRow />
      </div>
      <p className="px-1 text-caption text-ink-muted">
        Both open in the Workshop. Table rules apply to every character, and a character can set its
        own on its Build tab. The books decide what you pick from and what the Library and search
        show.
      </p>
    </section>
  );
}

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

  const gameData = sectionOf('game-data');
  const yourData = sectionOf('your-data');
  const helpAndAbout = sectionOf('help-and-about');
  const reset = sectionOf('reset');

  const offlineReady = offline !== undefined && offline.cached === offline.total;
  /** Whether "Make available offline" is on screen: only while something is missing. */
  const offerDownload = offlineError !== undefined || (offline !== undefined && !offlineReady);
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
    // One column up to a phone's or tablet's width, capped so lines stay
    // readable. On a wide screen the contents list takes the space beside it.
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-5 pb-4 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,42rem)_11rem] lg:content-start lg:justify-center lg:gap-x-12">
      <header className="flex items-center justify-between lg:col-start-1">
        <h1 className="font-display text-title-page">Settings</h1>
      </header>

      <OnThisPage />

      <div className="flex min-w-0 flex-col gap-6 lg:col-start-1">
        {/* First (DS-001): the one setting that changes every screen. */}
        <Appearance />

        <RulesAndContent />

        <section id={gameData.id} className={SECTION}>
          <h2 className={H2}>{gameData.label}</h2>
          <div className={`${cardClass} flex flex-col gap-4`}>
            <dl className="flex flex-col gap-1 text-body">
              <Fact label="Dataset version">
                {getActiveTag()}
                {rolledBackFrom !== undefined &&
                  ` (went back from ${rolledBackFrom}, which could not start)`}
              </Fact>
              <Fact label="Download" id={queueId}>
                {PHASE_WORDS[phase]}
                {/* Clamped like the banner's bar: the counters are shared, so a run
                    that starts while another is finishing can pass its own total. */}
                {(updating || downloading) && filesTotal > 0
                  ? ` (${Math.min(filesDone, filesTotal)}/${filesTotal})`
                  : ''}
              </Fact>
              <Fact label="Offline compendium">
                {offlineError !== undefined
                  ? offlineError === NOT_DOWNLOADED
                    ? 'not downloaded yet'
                    : 'could not be read'
                  : offline === undefined
                    ? '…'
                    : offlineReady
                      ? 'Ready'
                      : `${offline.cached}/${offline.total} files`}
              </Fact>
            </dl>

            <div className="-mx-4 flex flex-col items-start gap-3 border-line border-t px-4 pt-4">
              {tags !== null && tags.length > 0 && (
                <p className="text-body text-ink-muted">
                  {updateStatusText(tags, getActiveTag(), rolledBackFrom)}
                </p>
              )}
              {tags === null ? (
                <Button
                  variant="outline"
                  disabled={updating}
                  onClick={() => {
                    // `maxAgeMs: 0` skips the remembered list: someone who pressed
                    // "check for updates" is owed a live answer, not this morning's.
                    void listAvailableTags({ maxAgeMs: 0 })
                      .then((list) => {
                        setTags(list);
                        // The button that was pressed is gone, so the answer is
                        // said as well as shown (A11Y-002: a line that mounts with
                        // its text is announced unreliably).
                        announce(
                          list.length === 0
                            ? NO_COMPATIBLE_TEXT
                            : updateStatusText(
                                list,
                                getActiveTag(),
                                dataStatusStore.getState().rolledBackFrom,
                              ),
                          { key: 'update-check' },
                        );
                      })
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
                <p className="text-body text-ink-muted">{NO_COMPATIBLE_TEXT}</p>
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
                      {(tags.includes(getActiveTag()) ? tags : [getActiveTag(), ...tags]).map(
                        (t) => (
                          <option key={t} value={t} className="bg-surface-raised text-ink">
                            {t}
                            {t === getActiveTag() ? ' (installed)' : ''}
                          </option>
                        ),
                      )}
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
                        variant="outline"
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
              {offerDownload && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={downloading || updating}
                    // Busy while it runs, and described by the Download line that
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
            </div>
          </div>
          <p className="px-1 text-caption text-ink-muted">
            Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
            with the app itself. Characters store name references, so they survive data updates.
          </p>
        </section>

        <section id={yourData.id} className={SECTION}>
          <h2 className={H2}>{yourData.label}</h2>
          <p className="px-1 text-caption text-ink-muted">
            Everything (your characters, homebrew, dice history, and the downloaded compendium)
            lives only in this browser on this device. None of it is sent to a server and there are
            no accounts. Back a character up any time from its ⋯ menu on Characters, then Export;
            that file is the only copy that leaves the device.
          </p>
          {analyticsEnabled() && (
            <p className="px-1 text-caption text-ink-muted">{ANALYTICS_ON_TEXT}</p>
          )}
          {/* Unclipped, like the Workshop rows: the summary spans the card, and
              a clipping card would cut its focus ring off at the sides. */}
          <div className={openListClass}>
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body-strong">Persistent storage</span>
                  <PersistStatus state={persist.state} ref={persist.statusRef} />
                </span>
                {persist.state === 'best-effort' && (
                  <Button
                    variant="outline"
                    aria-disabled={persist.requesting}
                    onClick={() => void persist.request()}
                  >
                    Ask the browser to keep my data
                  </Button>
                )}
              </div>
              {persist.state === 'denied' && (
                <p className="text-caption text-ink-muted">
                  {PERSIST_DENIED_TEXT} Export to keep a copy.
                </p>
              )}
            </div>
            {/* The why behind the roster's checklist, which links here: closed
                unless that link opened the page, so Settings stays short. */}
            <details
              id={STORAGE_DETAILS_ID}
              open={detailsOpen}
              onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
              className="group scroll-mt-4"
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
                {/* The measured sizes: what the downloads hold, and what the
                    browser counts against its quota (see `useStorageUsage`). */}
                <dl className="flex flex-col gap-1 pb-1">
                  <Fact label="Game data">{sizeText(cachedBytes)}</Fact>
                  <Fact label="Browser storage used">
                    {sizeText(estimate?.usage)} of {sizeText(estimate?.quota)}
                  </Fact>
                </dl>
                <p>
                  Because it&rsquo;s browser storage, the browser can clear it when storage runs low
                  or when you clear browsing data. Export characters you care about.{' '}
                  {/* The button this names shows only while something is missing,
                      so once the compendium is whole the line says so instead. */}
                  {offerDownload
                    ? 'Use “Make available offline” above so the compendium is cached.'
                    : offlineReady
                      ? 'The compendium is already cached for offline use.'
                      : ''}
                </p>
                <p>
                  Your browser may ask to allow persistent storage. Choosing Allow keeps your data
                  safer.
                </p>
                <p>
                  Back up a character any time: open its ⋯ menu on Characters and choose Export.
                </p>
                <p>
                  On iPhone and iPad, Safari can clear a site&rsquo;s data after about a week
                  without a visit. Add Cast Guidance to your Home Screen before you build
                  characters. The Home Screen app has its own storage, so Export from Safari and
                  Import there.
                </p>
              </div>
            </details>
          </div>
        </section>

        <section id={helpAndAbout.id} className={SECTION}>
          <h2 className={H2}>{helpAndAbout.label}</h2>
          <div className={`${cardClass} flex flex-col gap-4`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                variant="outline"
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
            <div className="-mx-4 flex flex-col gap-3 border-line border-t px-4 pt-4">
              <p className="text-caption text-ink-muted">
                Cast Guidance is open source under the MIT License.
              </p>
              {/* Button-sized links: they meet the target size that inline caption
                  links would not, and they wrap on a narrow screen. */}
              <div className="flex flex-wrap items-center gap-2">
                {ABOUT_LINKS.map(({ label, path }) => (
                  <a
                    key={path}
                    href={`${REPO_BLOB_URL}/${path}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={buttonClass({ variant: 'outline', size: 'sm' })}
                  >
                    {label}
                    {/* The space sits outside the span: some name computations
                        trim a child's leading space, which ran the words together. */}{' '}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Last and on its own: the screen's one destructive control. */}
        <section id={reset.id} className={SECTION}>
          <h2 className={H2}>{reset.label}</h2>
          <div className={`${cardClass} flex flex-col items-start gap-3`}>
            <p className="text-caption text-ink-muted">
              Permanently deletes all characters, homebrew, and cached data on this device, then
              reloads. This cannot be undone. Export anything you want to keep first.
            </p>
            <Button variant="danger" disabled={resetting} onClick={() => void resetAll()}>
              {resetting ? 'Resetting…' : 'Reset app data'}
            </Button>
            {resetMsg !== undefined && <p className="text-caption text-danger">{resetMsg}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
