import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router';
import { GAME_DATA_DOWNLOAD_SIZE } from '@/data5e/downloadSize';
import { usePersistentStorage } from '@/lib/persistentStorage';
import { showsDataBanner, useDataStatus } from '@/stores/dataStatus';
import { onboardingStore, useOnboarding } from '@/stores/onboarding';
import type { OfflineReadiness } from '@/stores/swStatus';
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
  /**
   * Announce changes politely, and atomically so the lead is read with the
   * update and it says what it is about.
   */
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className="flex flex-col gap-1"
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="text-sm font-semibold">{lead}</h3>
        {status}
      </div>
      <div className="flex flex-col gap-1.5 text-xs text-ink-muted">{children}</div>
    </li>
  );
}

const DOWNLOAD_STATUS: Record<Exclude<CompendiumState, 'checking'>, [Tone, string]> = {
  complete: ['good', 'Done'],
  downloading: ['wait', 'In progress'],
  stopped: ['warn', 'Stopped'],
};

/** The offline line's status and the one sentence that goes with it. */
function offlineLine(
  shell: ShellStatus,
  compendium: CompendiumState,
  offline: OfflineReadiness,
): [Tone, string, string] {
  if (offline === 'now')
    return ['good', 'Ready', 'You can open Cast Guidance without a connection.'];
  // Everything is cached, but this tab was loaded before the worker took
  // over, so a screen it has not opened yet would still need the network.
  if (offline === 'next-launch') {
    return [
      'good',
      'Ready next time',
      'Ready to use offline next time you open the app. Reload now to use it offline in this tab.',
    ];
  }
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
  const { shell, compendium, offline, settled } = useOfflineReadiness();
  const bannerShowing = useDataStatus(showsDataBanner);
  const persist = usePersistentStorage();

  // On screen, so the offline notice leaves the news to this card.
  useEffect(() => (dismissed ? undefined : onboardingStore.getState().cardShown()), [dismissed]);

  if (dismissed) return null;

  const download = compendium === 'checking' ? undefined : DOWNLOAD_STATUS[compendium];
  const [offlineTone, offlineLabel, offlineText] = offlineLine(shell, compendium, offline);

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
        <Item
          lead="Game data"
          status={download && <Status tone={download[0]} label={download[1]} />}
        >
          <p>
            A one-time download of about {GAME_DATA_DOWNLOAD_SIZE}, kept on this device.
            {compendium === 'downloading' &&
              bannerShowing &&
              ' The bar at the top shows how far along it is.'}
            {compendium === 'stopped' && ' Use Retry at the top, or try again from Settings.'}
          </p>
        </Item>

        {/* Live, but polite and not role="status": it changes rarely (Not yet
            to Ready), and the roster's undo bar owns the status role. Until
            both sides have answered it shows no state at all and is not yet
            live, so a warm boot neither flashes "Not yet" nor announces on
            every launch. */}
        <Item
          lead="Works offline"
          live={settled}
          status={settled && <Status tone={offlineTone} label={offlineLabel} />}
        >
          {settled && <p>{offlineText}</p>}
        </Item>

        <Item
          lead="Protect your data"
          status={<PersistStatus state={persist.state} ref={persist.statusRef} />}
        >
          <p>Browsers can clear site data when storage runs low or when you clear browsing data.</p>
          {persist.state === 'best-effort' && (
            <>
              <button
                type="button"
                aria-disabled={persist.requesting}
                onClick={() => void persist.request()}
                className="w-fit rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink aria-disabled:opacity-40"
              >
                Ask the browser to keep my data
              </button>
              <p>
                Your browser may ask to allow persistent storage. Choosing Allow keeps your data
                safer.
              </p>
            </>
          )}
          <p>
            {persist.state === 'denied' && `${PERSIST_DENIED_TEXT} `}
            Back up a character any time: open its ⋯ menu and choose Export.
          </p>
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
