import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { GAME_DATA_DOWNLOAD_SIZE } from '@/data5e/downloadSize';
import { usePersistentStorage } from '@/lib/persistentStorage';
import { showsDataBanner, useDataStatus } from '@/stores/dataStatus';
import { onboardingStore, useOnboarding } from '@/stores/onboarding';
import { PERSIST_DENIED_TEXT, PersistStatus, Status, type Tone } from './Status';
import { type CompendiumState, type ShellStatus, useOfflineReadiness } from './useOfflineReadiness';

function Item({
  lead,
  status,
  live = false,
  children,
}: {
  lead: string;
  status?: ReactNode;
  /** Announce changes politely, lead included so the update says what it is about. */
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1" aria-live={live ? 'polite' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="text-sm font-semibold">{lead}</h3>
        {status}
      </div>
      <div className="flex flex-col gap-1.5 text-xs text-ink-muted">{children}</div>
    </li>
  );
}

const DOWNLOAD_STATUS: Record<CompendiumState, [Tone, string]> = {
  complete: ['good', 'Done'],
  downloading: ['wait', 'In progress'],
  stopped: ['warn', 'Stopped'],
};

/** The offline line's status and the one sentence that goes with it. */
function offlineLine(
  shell: ShellStatus,
  compendium: CompendiumState,
  ready: boolean,
): [Tone, string, string] {
  if (ready) return ['good', 'Ready', 'You can open Cast Guidance without a connection.'];
  if (shell === 'unsupported') {
    return [
      'off',
      'Not available',
      'This browser needs a connection to open the app. Your saved data stays on the device either way.',
    ];
  }
  if (shell === 'error') {
    return ['warn', 'Not yet', 'Offline support could not install. Reload the page to try again.'];
  }
  if (shell === 'stalled') {
    return [
      'warn',
      'Not yet',
      'Offline support has not finished installing. Reload the page to try again.',
    ];
  }
  if (compendium === 'stopped') {
    return ['wait', 'Not yet', 'The game data download stopped. Finish it to go offline.'];
  }
  return ['wait', 'Not yet', 'Keep the app open until the download finishes.'];
}

/**
 * First-run guidance on the roster: where the data lives, the one download,
 * when the app is safe to use offline, and how to keep the data. Inline rather
 * than a modal so it never stands between someone and their first character,
 * and so it can show live state, which is the part a one-off intro cannot do.
 *
 * It never takes focus on its own; screen readers meet it in reading order.
 * `onDismiss` is where focus goes when the button that had it disappears.
 */
export function GettingStarted({ onDismiss }: { onDismiss?: () => void }) {
  const dismissed = useOnboarding((s) => s.dismissed);
  const { shell, compendium, ready } = useOfflineReadiness();
  const bannerShowing = useDataStatus(showsDataBanner);
  const persist = usePersistentStorage();

  if (dismissed) return null;

  const [downloadTone, downloadLabel] = DOWNLOAD_STATUS[compendium];
  const [offlineTone, offlineLabel, offlineText] = offlineLine(shell, compendium, ready);

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="flex flex-col gap-3 rounded-lg border border-surface-2 bg-surface p-3"
    >
      <div>
        <h2 id="getting-started-heading" className="font-semibold">
          Getting started
        </h2>
        <p className="text-xs text-ink-muted">
          How this app keeps your data, and when it works without a connection.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        <Item lead="Saved on this device">
          <p>
            No account, and nothing is uploaded. Your characters, homebrew and dice history live in
            this browser only.
          </p>
        </Item>

        {/* The phase only: the count and the bar are the banner's job, and two
            progress readouts for one download would disagree within a frame. */}
        <Item lead="Game data" status={<Status tone={downloadTone} label={downloadLabel} />}>
          <p>
            A one-time download of about {GAME_DATA_DOWNLOAD_SIZE}, kept on this device.
            {compendium === 'downloading' &&
              bannerShowing &&
              ' The bar at the top shows how far along it is.'}
            {compendium === 'stopped' && ' Use Retry at the top, or try again from Settings.'}
          </p>
        </Item>

        {/* Live, but polite and not role="status": it changes rarely (Not yet
            to Ready), and the roster's undo bar owns the status role. */}
        <Item lead="Works offline" live status={<Status tone={offlineTone} label={offlineLabel} />}>
          <p>{offlineText}</p>
        </Item>

        <Item lead="Protect your data" status={<PersistStatus state={persist.state} />}>
          <p>Browsers can clear site data when storage runs low or when you clear browsing data.</p>
          {persist.state === 'best-effort' && (
            <>
              <button
                type="button"
                disabled={persist.requesting}
                onClick={() => void persist.request()}
                className="w-fit rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
              >
                Ask the browser to keep my data
              </button>
              <p>
                Your browser may ask to allow persistent storage. Choosing Allow keeps your data
                safer.
              </p>
            </>
          )}
          {persist.state === 'denied' && <p>{PERSIST_DENIED_TEXT} Back up instead:</p>}
          <p>Back up a character any time: open its ⋯ menu and choose Export.</p>
          <p>
            On iPhone and iPad, Safari can clear a site&rsquo;s data after about a week without a
            visit. Add Cast Guidance to your Home Screen before you build characters. The Home
            Screen app has its own storage, so Export from Safari and Import there.
          </p>
        </Item>

        <Item lead="Rules edition">
          <p>
            Each character picks 2014 or 2024 rules when you create it. Older books still work in a
            2024 game.
          </p>
        </Item>
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => {
            onboardingStore.getState().dismiss();
            onDismiss?.();
          }}
          className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold"
        >
          Got it, hide this
        </button>
        <Link to="/settings" className="text-sm text-ink-muted underline underline-offset-2">
          Storage details
        </Link>
      </div>
      <p className="text-xs text-ink-muted">You can reopen this from Settings.</p>
    </section>
  );
}
